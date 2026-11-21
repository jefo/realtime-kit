import { normalizeSubscription, subscriptionKey } from "./canonical";
import { GatewayError } from "./errors";
import { BoundedQueue } from "./queue";
import type {
  EventEnvelope,
  GatewayOptions,
  GatewayStats,
  ResolvedSubscription,
  SessionCloseReason,
  SessionInfo,
  Subscription,
  TopicHooks,
} from "./types";

interface SessionState {
  id: string;
  subscriptions: ResolvedSubscription[];
  keys: Set<string>;
  createdAt: number;
  attached: boolean;
  detachedAt: number | null;
  queue: BoundedQueue<EventEnvelope> | null;
  seq: number;
  missed: number;
}

const DEFAULT_MAX_SUBSCRIPTIONS = 64;
const DEFAULT_MAX_QUEUE = 256;
const DEFAULT_QUEUE_TTL_MS = 30_000;

function defaultId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Transport-agnostic subscription gateway.
 *
 * A session owns a set of exact-match subscriptions. Producers publish by key;
 * the gateway fans out to every attached session and buffers a bounded number
 * of events for sessions that subscribed but have not opened their stream yet.
 */
export class SubscriptionGateway {
  private readonly sessions = new Map<string, SessionState>();
  private readonly subscribers = new Map<string, Set<string>>();
  private readonly topics = new Map<string, TopicHooks>();

  private readonly ttlMs: number;
  private readonly maxSubscriptions: number;
  private readonly maxQueue: number;
  private readonly overflow: "drop-oldest" | "disconnect";
  private readonly requireRegisteredTopics: boolean;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly onError: (error: unknown, context: string) => void;

  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;

  private publishedCount = 0;
  private droppedCount = 0;
  private missedCount = 0;

  constructor(options: GatewayOptions = {}) {
    this.ttlMs = Math.max(0, options.sessionTtlMs ?? DEFAULT_QUEUE_TTL_MS);
    this.maxSubscriptions = options.maxSubscriptionsPerSession ?? DEFAULT_MAX_SUBSCRIPTIONS;
    this.maxQueue = options.maxQueuePerSession ?? DEFAULT_MAX_QUEUE;
    this.overflow = options.overflow ?? "drop-oldest";
    this.requireRegisteredTopics = options.requireRegisteredTopics ?? false;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? defaultId;
    this.onError =
      options.onError ??
      ((error, context) => {
        console.error(`[rtkit/subscriptions] ${context}`, error);
      });

    const interval = Math.max(250, options.sweepIntervalMs ?? Math.min(5_000, Math.max(1_000, this.ttlMs)));
    this.timer = setInterval(() => {
      void this.sweep();
    }, interval);
    (this.timer as { unref?: () => void }).unref?.();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  registerTopic(topic: string, hooks: TopicHooks): () => void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(topic)) {
      throw new GatewayError("INVALID_TOPIC", `Invalid topic: ${topic}`);
    }
    this.topics.set(topic, hooks);
    return () => {
      if (this.topics.get(topic) === hooks) this.topics.delete(topic);
    };
  }

  async createSession(input: Subscription | Subscription[]): Promise<SessionInfo> {
    if (this.stopped) throw new Error("SubscriptionGateway is stopped.");

    const raw = Array.isArray(input) ? input : [input];
    if (raw.length === 0) {
      throw new GatewayError("EMPTY_SUBSCRIPTIONS", "At least one subscription is required.");
    }
    if (raw.length > this.maxSubscriptions) {
      throw new GatewayError(
        "TOO_MANY_SUBSCRIPTIONS",
        `A session can hold at most ${this.maxSubscriptions} subscriptions.`,
        { requested: raw.length, limit: this.maxSubscriptions },
      );
    }

    const seen = new Set<string>();
    const subscriptions: ResolvedSubscription[] = [];
    for (const item of raw) {
      const sub = normalizeSubscription(item);
      if (this.requireRegisteredTopics && !this.topics.has(sub.topic)) {
        throw new GatewayError("INVALID_TOPIC", `Topic is not registered: ${sub.topic}`, {
          topic: sub.topic,
        });
      }
      if (seen.has(sub.key)) continue;
      seen.add(sub.key);
      subscriptions.push(sub);
    }

    const id = this.idFactory();
    const keys = new Set(subscriptions.map((sub) => sub.key));

    const firsts: ResolvedSubscription[] = [];
    for (const sub of subscriptions) {
      let set = this.subscribers.get(sub.key);
      if (!set) {
        set = new Set();
        this.subscribers.set(sub.key, set);
      }
      if (set.size === 0) firsts.push(sub);
      set.add(id);
    }

    const started: ResolvedSubscription[] = [];
    try {
      for (const sub of firsts) {
        const hook = this.topics.get(sub.topic)?.onFirstSubscriber;
        if (!hook) continue;
        await hook(sub);
        started.push(sub);
      }
    } catch (error) {
      this.rollbackSubscription(id, subscriptions);
      for (const sub of started.reverse()) {
        const hook = this.topics.get(sub.topic)?.onLastSubscriber;
        if (hook) await this.safeHook(hook, sub, `onLastSubscriber rollback (${sub.key})`);
      }
      throw new GatewayError("TOPIC_HOOK_FAILED", `onFirstSubscriber failed for "${firsts.at(-1)?.key}".`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const state: SessionState = {
      id,
      subscriptions,
      keys,
      createdAt: this.now(),
      attached: false,
      detachedAt: null,
      queue: new BoundedQueue<EventEnvelope>(this.maxQueue, this.overflow),
      seq: 0,
      missed: 0,
    };
    this.sessions.set(id, state);

    return { id, subscriptions, createdAt: state.createdAt };
  }

  /**
   * Attach a reader. Events published between `createSession` and this call
   * are buffered up to `maxQueuePerSession`.
   */
  open(sessionId: string): SessionStream {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new GatewayError("UNKNOWN_SESSION", `Unknown session: ${sessionId}`);
    }
    if (state.attached) {
      // A reconnect may arrive before the server notices the old stream is gone.
      // Close the old reader and attach a fresh one instead of rejecting.
      state.queue?.close();
    }

    const queue =
      !state.attached && state.queue && !state.queue.isClosed
        ? state.queue
        : new BoundedQueue<EventEnvelope>(this.maxQueue, this.overflow);

    state.queue = queue;
    state.attached = true;
    state.detachedAt = null;

    return new SessionStream(this, sessionId, queue);
  }

  publish(key: string, data: unknown): number;
  publish(topic: string, params: Record<string, unknown> | undefined, data: unknown): number;
  publish(first: string, second: unknown, third?: unknown): number {
    const byKey = arguments.length < 3;
    const key = byKey ? first : subscriptionKey(first, second as Record<string, unknown> | undefined);
    const data = byKey ? second : third;
    const topic = byKey ? key.slice(0, Math.max(0, key.indexOf(":"))) : first;

    const subscriberIds = this.subscribers.get(key);
    if (!subscriberIds || subscriberIds.size === 0) return 0;

    let delivered = 0;
    for (const id of subscriberIds) {
      const state = this.sessions.get(id);
      if (!state) continue;

      const queue = state.queue;
      if (!queue || queue.isClosed) {
        state.missed += 1;
        this.missedCount += 1;
        continue;
      }

      const envelope: EventEnvelope = {
        id: ++state.seq,
        key,
        topic,
        data,
      };
      const result = queue.push(envelope);
      this.publishedCount += 1;

      if (result === "overflow") {
        this.droppedCount += 1;
        delivered += 1;
      } else if (result === "closed") {
        this.droppedCount += 1;
        void this.closeSession(id, "overflow");
      } else {
        delivered += 1;
      }
    }
    return delivered;
  }

  /** Mark a stream as closed but keep the session for `sessionTtlMs`. */
  async detach(sessionId: string, queue: BoundedQueue<EventEnvelope>): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.queue !== queue) return;

    state.attached = false;
    state.queue = null;
    state.detachedAt = this.now();
    queue.close();

    if (this.ttlMs === 0) {
      await this.closeSession(sessionId, "client");
    }
  }

  async closeSession(sessionId: string, reason: SessionCloseReason = "client"): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;

    this.sessions.delete(sessionId);
    state.queue?.close();

    for (const sub of state.subscriptions) {
      const set = this.subscribers.get(sub.key);
      if (!set) continue;
      set.delete(sessionId);
      if (set.size > 0) continue;
      this.subscribers.delete(sub.key);
      const hook = this.topics.get(sub.topic)?.onLastSubscriber;
      if (hook) await this.safeHook(hook, sub, `onLastSubscriber (${sub.key}, ${reason})`);
    }

    return true;
  }

  async sweep(): Promise<number> {
    if (this.ttlMs === 0) return 0;
    const now = this.now();
    let closed = 0;
    for (const state of [...this.sessions.values()]) {
      if (state.attached || state.detachedAt === null) continue;
      if (now - state.detachedAt < this.ttlMs) continue;
      if (await this.closeSession(state.id, "expired")) closed += 1;
    }
    return closed;
  }

  stats(): GatewayStats {
    let subscriptions = 0;
    for (const set of this.subscribers.values()) subscriptions += set.size;

    let queued = 0;
    let attached = 0;
    for (const state of this.sessions.values()) {
      if (state.attached) attached += 1;
      queued += state.queue?.size ?? 0;
    }

    return {
      sessions: this.sessions.size,
      attached,
      subscriptions,
      queued,
      dropped: this.droppedCount,
      missed: this.missedCount,
      published: this.publishedCount,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const id of [...this.sessions.keys()]) {
      await this.closeSession(id, "shutdown");
    }
  }

  private rollbackSubscription(id: string, subscriptions: ResolvedSubscription[]): void {
    for (const sub of subscriptions) {
      const set = this.subscribers.get(sub.key);
      if (!set) continue;
      set.delete(id);
      if (set.size === 0) this.subscribers.delete(sub.key);
    }
  }

  private async safeHook(
    hook: (sub: ResolvedSubscription) => void | Promise<void>,
    sub: ResolvedSubscription,
    context: string,
  ): Promise<void> {
    try {
      await hook(sub);
    } catch (error) {
      this.onError(error, context);
    }
  }
}

export class SessionStream implements AsyncIterable<EventEnvelope> {
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly gateway: SubscriptionGateway,
    readonly sessionId: string,
    private readonly queue: BoundedQueue<EventEnvelope>,
  ) {}

  get dropped(): number {
    return this.queue.dropped;
  }

  get overflowed(): boolean {
    return this.queue.isOverflowed;
  }

  [Symbol.asyncIterator](): AsyncIterator<EventEnvelope> {
    return this;
  }

  next(): Promise<IteratorResult<EventEnvelope>> {
    return this.queue.next();
  }

  async return(): Promise<IteratorResult<EventEnvelope>> {
    await this.close();
    return { value: undefined, done: true };
  }

  close(): Promise<void> {
    this.closePromise ??= this.gateway.detach(this.sessionId, this.queue);
    return this.closePromise;
  }
}
