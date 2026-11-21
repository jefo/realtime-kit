import { subscriptionKey } from "../core/canonical";
import type { EventEnvelope, SessionInfo, Subscription } from "../core/types";
import { SseParser } from "./parser";

export type ClientState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReconnectOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** Fraction of the delay added as random jitter, 0..1. Default: 0.2. */
  jitter?: number;
}

export interface SubscriptionsClientOptions {
  /** Base URL of the gateway, e.g. `http://localhost:8787`. */
  url: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  reconnect?: boolean | ReconnectOptions;
}

export interface ClientEnvelope<T = unknown> extends EventEnvelope<T> {
  receivedAt: number;
}

export type ClientHandler<T = unknown> = (event: ClientEnvelope<T>) => void;
export type StateListener = (state: ClientState, error: Error | null) => void;

export class SubscriptionsClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SubscriptionsClientError";
  }
}

const DEFAULT_RECONNECT: Required<ReconnectOptions> = {
  minDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 1.8,
  jitter: 0.2,
};

export class SubscriptionsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly reconnect: Required<ReconnectOptions> | null;

  private subscriptions: Subscription[] = [];
  private sessionId: string | null = null;
  private abort: AbortController | null = null;
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: Error | null = null;
  private currentState: ClientState = "idle";

  private readonly handlers = new Map<string, Set<ClientHandler>>();
  private readonly anyHandlers = new Set<ClientHandler>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(options: SubscriptionsClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.headers = options.headers ?? {};

    const reconnect = options.reconnect ?? true;
    this.reconnect =
      reconnect === false
        ? null
        : { ...DEFAULT_RECONNECT, ...(typeof reconnect === "object" ? reconnect : {}) };
  }

  get state(): ClientState {
    return this.currentState;
  }

  get id(): string | null {
    return this.sessionId;
  }

  get error(): Error | null {
    return this.lastError;
  }

  on(sub: Subscription, handler: ClientHandler): () => void {
    return this.onKey(subscriptionKey(sub.topic, sub.params), handler);
  }

  onKey(key: string, handler: ClientHandler): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(key);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(key);
    };
  }

  onAny(handler: ClientHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Create a session and open its stream. Resolves once the HTTP response for
   * `/events/:id` is open, so a publish right after `await subscribe()` is
   * guaranteed to find an attached reader.
   */
  async subscribe(subscriptions: Subscription[]): Promise<SessionInfo> {
    if (subscriptions.length === 0) {
      throw new Error("At least one subscription is required.");
    }
    this.subscriptions = subscriptions.map((sub) => ({ ...sub }));
    this.closedByUser = false;
    this.attempt = 0;
    return this.start();
  }

  close(): void {
    if (this.closedByUser) return;
    this.closedByUser = true;
    this.clearReconnect();
    this.abort?.abort();
    this.abort = null;

    const id = this.sessionId;
    this.sessionId = null;
    if (id) {
      void this.fetchImpl(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.headers,
      }).catch(() => undefined);
    }
    this.setState("closed", null);
  }

  private async start(): Promise<SessionInfo> {
    this.clearReconnect();
    this.abort?.abort();

    const controller = new AbortController();
    this.abort = controller;
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting", this.lastError);

    const created = await this.fetchImpl(`${this.baseUrl}/subscribe`, {
      method: "POST",
      headers: { ...this.headers, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ subscriptions: this.subscriptions }),
      signal: controller.signal,
    });

    if (!created.ok) {
      throw await toClientError(created);
    }

    const info = (await created.json()) as SessionInfo;
    if (!info || typeof info.id !== "string") {
      throw new SubscriptionsClientError("Gateway returned no session id.", created.status, "");
    }
    this.sessionId = info.id;

    const stream = await this.fetchImpl(`${this.baseUrl}/events/${encodeURIComponent(info.id)}`, {
      headers: { ...this.headers, accept: "text/event-stream" },
      signal: controller.signal,
    });

    if (!stream.ok || !stream.body) {
      throw await toClientError(stream);
    }

    this.attempt = 0;
    this.lastError = null;
    this.setState("open", null);
    void this.readLoop(stream.body, controller);

    return info;
  }

  private async readLoop(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    try {
      while (!this.closedByUser) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          this.dispatch(event.id, event.event, event.data);
        }
      }
    } catch (error) {
      if (!this.closedByUser) this.lastError = toError(error);
    } finally {
      if (!this.closedByUser && this.abort === controller) {
        this.scheduleReconnect();
      }
    }
  }

  private dispatch(id: string | undefined, event: string | undefined, raw: string): void {
    let payload: { key?: unknown; topic?: unknown; data?: unknown };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }

    if (!payload || typeof payload.key !== "string") return;

    const envelope: ClientEnvelope = {
      id: Number(id ?? 0),
      key: payload.key,
      topic: typeof payload.topic === "string" ? payload.topic : (event ?? ""),
      data: payload.data,
      receivedAt: Date.now(),
    };

    for (const handler of this.handlers.get(envelope.key) ?? []) {
      this.callHandler(handler, envelope);
    }
    for (const handler of this.anyHandlers) {
      this.callHandler(handler, envelope);
    }
  }

  private callHandler(handler: ClientHandler, envelope: ClientEnvelope): void {
    try {
      handler(envelope);
    } catch (error) {
      this.lastError = toError(error);
      console.error("[rtkit/subscriptions] client handler failed", error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnect || this.closedByUser) {
      this.setState("closed", this.lastError);
      return;
    }

    this.attempt += 1;
    const delay = this.backoff(this.attempt);
    this.setState("reconnecting", this.lastError);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch((error) => {
        if (this.closedByUser) return;
        this.lastError = toError(error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private backoff(attempt: number): number {
    if (!this.reconnect) return 0;
    const raw = Math.min(
      this.reconnect.maxDelayMs,
      this.reconnect.minDelayMs * Math.pow(this.reconnect.factor, attempt - 1),
    );
    const jitter = raw * this.reconnect.jitter * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(raw + jitter));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ClientState, error: Error | null): void {
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state, error);
      } catch {
        // A broken observer must not break the client.
      }
    }
  }
}

async function toClientError(response: Response): Promise<SubscriptionsClientError> {
  const body = await response.text().catch(() => "");
  return new SubscriptionsClientError(
    `Gateway responded with HTTP ${response.status}.`,
    response.status,
    body,
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
