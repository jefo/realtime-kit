import { MemoryEventCache } from "../cache/memory";
import { MarketError } from "./errors";
import { StreamQueue, type OverflowPolicy } from "./queue";
import { eventKey, marketKey, normalizeSubscription } from "./subscriptions";
import type {
  ConnectorStatus,
  EventCache,
  ExchangeConnector,
  MarketEvent,
  MarketSubscription,
} from "./types";

export interface MarketHubOptions {
  connector: ExchangeConnector;
  cache?: EventCache;
  /** Per-stream queue size. Default: 256. */
  maxQueuePerStream?: number;
  overflow?: OverflowPolicy;
  onError?: (error: unknown, context: string) => void;
}

export interface MarketHubStats {
  events: number;
  listeners: number;
  keys: number;
  streams: number;
  status: ConnectorStatus;
}

interface Reference {
  subscription: MarketSubscription;
  count: number;
}

/**
 * Owns one connector, reference-counts upstream subscriptions, writes the last
 * event of every key to a cache and fans events out to listeners/streams.
 */
export class MarketHub {
  private readonly connector: ExchangeConnector;
  private readonly cache: EventCache;
  private readonly maxQueue: number;
  private readonly overflow: OverflowPolicy;
  private readonly onError: (error: unknown, context: string) => void;

  private readonly references = new Map<string, Reference>();
  private readonly listeners = new Set<(event: MarketEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectorStatus, detail?: string) => void>();
  private readonly streams = new Set<MarketStream>();

  private abort: AbortController | null = null;
  private started = false;
  private stopping = false;
  private currentStatus: ConnectorStatus = "idle";
  private events = 0;

  constructor(options: MarketHubOptions) {
    this.connector = options.connector;
    this.cache = options.cache ?? new MemoryEventCache();
    this.maxQueue = Math.max(1, options.maxQueuePerStream ?? 256);
    this.overflow = options.overflow ?? "drop-oldest";
    this.onError =
      options.onError ??
      ((error, context) => {
        console.error(`[rtkit/market-ingest] ${context}`, error);
      });
  }

  get status(): ConnectorStatus {
    return this.currentStatus;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.stopping) throw new MarketError("connector_closed", "Hub is stopped.");

    this.abort = new AbortController();
    const context = {
      signal: this.abort.signal,
      emit: (event: MarketEvent) => this.handleEvent(event),
      setStatus: (status: ConnectorStatus, detail?: string) => this.setStatus(status, detail),
    };

    try {
      await this.connector.connect(context);
      this.started = true;
    } catch (error) {
      this.setStatus("closed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async subscribe(input: MarketSubscription | MarketSubscription[]): Promise<void> {
    this.assertRunning();
    const subscriptions = unique(input);
    const fresh: MarketSubscription[] = [];

    for (const subscription of subscriptions) {
      const key = marketKey(subscription);
      const existing = this.references.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      this.references.set(key, { subscription, count: 1 });
      fresh.push(subscription);
    }

    if (fresh.length === 0) return;
    try {
      await this.connector.subscribe(fresh);
    } catch (error) {
      for (const subscription of fresh) {
        const key = marketKey(subscription);
        const reference = this.references.get(key);
        if (!reference) continue;
        reference.count -= 1;
        if (reference.count <= 0) this.references.delete(key);
      }
      throw error;
    }
  }

  async unsubscribe(input: MarketSubscription | MarketSubscription[]): Promise<void> {
    const subscriptions = unique(input);
    const removed: MarketSubscription[] = [];

    for (const subscription of subscriptions) {
      const key = marketKey(subscription);
      const reference = this.references.get(key);
      if (!reference) continue;
      reference.count -= 1;
      if (reference.count > 0) continue;
      this.references.delete(key);
      removed.push(reference.subscription);
    }

    if (removed.length === 0 || this.stopping) return;
    try {
      await this.connector.unsubscribe(removed);
    } catch (error) {
      this.onError(error, `unsubscribe ${removed.map(marketKey).join(", ")}`);
    }
  }

  onEvent(handler: (event: MarketEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  onStatus(handler: (status: ConnectorStatus, detail?: string) => void): () => void {
    this.statusListeners.add(handler);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  /** Subscribe and return a filtered, backpressured stream. */
  async openStream(input: MarketSubscription | MarketSubscription[]): Promise<MarketStream> {
    const subscriptions = unique(input);
    await this.subscribe(subscriptions);

    const keys = new Set(subscriptions.map(marketKey));
    const queue = new StreamQueue<MarketEvent>(this.maxQueue, this.overflow);

    let stream: MarketStream;
    const listener = (event: MarketEvent) => {
      if (!keys.has(eventKey(event))) return;
      if (queue.push(event) === "closed") void stream.finish();
    };
    this.listeners.add(listener);

    stream = new MarketStream(queue, async () => {
      this.listeners.delete(listener);
      await this.unsubscribe(subscriptions);
      this.streams.delete(stream);
    });

    this.streams.add(stream);
    return stream;
  }

  async latest(subscriptionOrKey: MarketSubscription | string): Promise<MarketEvent | undefined> {
    const key =
      typeof subscriptionOrKey === "string"
        ? subscriptionOrKey
        : marketKey(normalizeSubscription(subscriptionOrKey));
    return this.cache.get(key);
  }

  async snapshot(): Promise<Map<string, MarketEvent>> {
    return this.cache.snapshot();
  }

  stats(): MarketHubStats {
    return {
      events: this.events,
      listeners: this.listeners.size,
      keys: this.references.size,
      streams: this.streams.size,
      status: this.currentStatus,
    };
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.abort?.abort();

    for (const stream of [...this.streams]) {
      await stream.close();
    }

    this.listeners.clear();
    this.references.clear();

    try {
      await this.connector.disconnect();
    } catch (error) {
      this.onError(error, "connector.disconnect");
    }

    await this.cache.close?.().catch(() => undefined);
    this.started = false;
    this.setStatus("closed");
  }

  private handleEvent(event: MarketEvent): void {
    this.events += 1;
    const key = eventKey(event);
    void this.cache.set(key, event).catch((error) => this.onError(error, `cache.set ${key}`));

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onError(error, "listener");
      }
    }
  }

  private setStatus(status: ConnectorStatus, detail?: string): void {
    this.currentStatus = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status, detail);
      } catch (error) {
        this.onError(error, "status listener");
      }
    }
  }

  private assertRunning(): void {
    if (this.stopping) throw new MarketError("connector_closed", "Hub is stopped.");
    if (!this.started) throw new MarketError("not_connected", "Call start() before subscribing.");
  }
}

export class MarketStream implements AsyncIterable<MarketEvent> {
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly queue: StreamQueue<MarketEvent>,
    private readonly onClose: () => Promise<void>,
  ) {}

  get dropped(): number {
    return this.queue.dropped;
  }

  get overflowed(): boolean {
    return this.queue.isOverflowed;
  }

  [Symbol.asyncIterator](): AsyncIterator<MarketEvent> {
    return this;
  }

  next(): Promise<IteratorResult<MarketEvent>> {
    return this.queue.next();
  }

  async return(): Promise<IteratorResult<MarketEvent>> {
    await this.close();
    return { value: undefined, done: true };
  }

  /** Close the stream and drop buffered events. */
  close(): Promise<void> {
    this.queue.close();
    return this.finish();
  }

  /** Detach the listener and unsubscribe, but let the reader drain the queue. */
  finish(): Promise<void> {
    this.closePromise ??= this.onClose();
    return this.closePromise;
  }
}

function unique(input: MarketSubscription | MarketSubscription[]): MarketSubscription[] {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const result: MarketSubscription[] = [];
  for (const item of list) {
    const normalized = normalizeSubscription(item);
    const key = marketKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
