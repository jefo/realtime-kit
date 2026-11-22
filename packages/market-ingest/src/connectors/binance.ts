import { MarketError } from "../core/errors";
import { normalizeSubscription } from "../core/subscriptions";
import type {
  ConnectorContext,
  ConnectorStatus,
  ExchangeConnector,
  FundingEvent,
  KlineEvent,
  LiquidationEvent,
  MarketEvent,
  MarketSubscription,
  QuoteEvent,
} from "../core/types";

export interface SocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
  message?: string;
}

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: SocketEvent) => void): void;
  removeEventListener?(type: string, listener: (event: SocketEvent) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ReconnectOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
}

export interface BinanceConnectorOptions {
  /** `futures` (default) enables funding and liquidation streams. */
  market?: "spot" | "futures";
  wsUrl?: string;
  webSocketFactory?: WebSocketFactory;
  /** Reject a socket that does not open in time. Default: 10000 ms. */
  connectTimeoutMs?: number;
  reconnect?: ReconnectOptions;
  now?: () => number;
  onError?: (error: unknown, context: string) => void;
}

const DEFAULTS: Required<ReconnectOptions> = {
  minDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 1.8,
  jitter: 0.2,
};

const FUTURES_WS = "wss://fstream.binance.com/ws";
const SPOT_WS = "wss://stream.binance.com:9443/ws";

/**
 * Binance market-data connector.
 *
 * Uses one WebSocket with dynamic SUBSCRIBE/UNSUBSCRIBE and normalizes
 * bookTicker, kline, markPrice and forceOrder payloads into `MarketEvent`.
 * Binance's protocol-level ping is answered by the runtime; no manual pong is
 * required for the public market streams.
 */
export class BinanceConnector implements ExchangeConnector {
  readonly name = "binance";

  private readonly market: "spot" | "futures";
  private readonly wsUrl: string;
  private readonly factory: WebSocketFactory;
  private readonly reconnectOptions: Required<ReconnectOptions>;
  private readonly clock: () => number;
  private readonly connectTimeoutMs: number;
  private readonly onError: (error: unknown, context: string) => void;

  private readonly streams = new Set<string>();
  private context: ConnectorContext | null = null;
  private socket: WebSocketLike | null = null;
  private isOpen = false;
  private stopped = false;
  private openedOnce = false;
  private attempt = 0;
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: Error | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private pendingResolve: (() => void) | null = null;

  constructor(options: BinanceConnectorOptions = {}) {
    this.market = options.market ?? "futures";
    this.wsUrl = options.wsUrl ?? (this.market === "futures" ? FUTURES_WS : SPOT_WS);
    this.factory =
      options.webSocketFactory ??
      ((url) => {
        if (typeof WebSocket === "undefined") {
          throw new MarketError(
            "unsupported_runtime",
            "No global WebSocket. Pass `webSocketFactory` (for example the `ws` package) or use Node 22+.",
          );
        }
        return new WebSocket(url) as unknown as WebSocketLike;
      });
    this.connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? 10_000);
    this.reconnectOptions = { ...DEFAULTS, ...(options.reconnect ?? {}) };
    this.clock = options.now ?? Date.now;
    this.onError =
      options.onError ??
      ((error, context) => {
        console.error(`[rtkit/market-ingest] ${context}`, error);
      });
  }

  async connect(context: ConnectorContext): Promise<void> {
    this.context = context;
    this.stopped = false;
    this.attempt = 0;
    await this.open();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearReconnect();
    this.clearConnectTimer();
    this.pendingReject?.(new MarketError("connector_closed", "Connector disconnected."));
    this.pendingReject = null;
    this.pendingResolve = null;
    this.isOpen = false;
    this.socket?.close(1000, "client");
    this.socket = null;
    this.context?.setStatus("closed");
    this.context = null;
  }

  async subscribe(subscriptions: MarketSubscription[]): Promise<void> {
    this.assertUsable();
    const added: string[] = [];
    for (const input of subscriptions) {
      const stream = this.streamName(normalizeSubscription(input));
      if (this.streams.has(stream)) continue;
      this.streams.add(stream);
      added.push(stream);
    }
    if (added.length > 0 && this.isOpen) this.sendControl("SUBSCRIBE", added);
  }

  async unsubscribe(subscriptions: MarketSubscription[]): Promise<void> {
    const removed: string[] = [];
    for (const input of subscriptions) {
      const stream = this.streamName(normalizeSubscription(input));
      if (!this.streams.delete(stream)) continue;
      removed.push(stream);
    }
    if (removed.length > 0 && this.isOpen) this.sendControl("UNSUBSCRIBE", removed);
  }

  get status(): ConnectorStatus {
    if (this.stopped) return "closed";
    return this.isOpen ? "open" : "connecting";
  }

  private open(): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new MarketError("connector_closed", "Connector is stopped."));
    }

    this.context?.setStatus(this.attempt === 0 ? "connecting" : "reconnecting", this.lastError?.message);
    const socket = this.factory(this.wsUrl);
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.connectTimer = setTimeout(() => {
        if (this.pendingReject !== reject) return;
        this.pendingReject = null;
        this.pendingResolve = null;

        const error = new MarketError(
          "upstream_error",
          `Binance WebSocket did not open within ${this.connectTimeoutMs} ms.`,
        );
        this.lastError = error;
        try {
          socket.close(4000, "connect timeout");
        } catch {
          // The socket may already be gone.
        }
        reject(error);
      }, this.connectTimeoutMs);

      socket.addEventListener("open", () => {
        this.clearConnectTimer();
        this.isOpen = true;
        this.openedOnce = true;
        this.attempt = 0;
        this.nextId = 1;
        this.lastError = null;
        this.context?.setStatus("open");
        this.flush();
        this.pendingResolve?.();
        this.pendingResolve = null;
        this.pendingReject = null;
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener("close", () => {
        this.handleClose();
      });

      socket.addEventListener("error", (event) => {
        this.lastError = new Error(event.message ?? "Binance WebSocket error");
      });
    });
  }

  private handleClose(): void {
    this.clearConnectTimer();
    this.isOpen = false;
    this.socket = null;

    const reject = this.pendingReject;
    this.pendingReject = null;
    this.pendingResolve = null;

    if (this.stopped) {
      this.context?.setStatus("closed");
      return;
    }

    if (!this.openedOnce && reject) {
      reject(new MarketError("upstream_error", "Binance WebSocket closed before opening."));
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;

    this.attempt += 1;
    const delay = this.backoff(this.attempt);
    this.context?.setStatus("reconnecting", this.lastError?.message);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private flush(): void {
    if (!this.isOpen || this.streams.size === 0) return;
    this.sendControl("SUBSCRIBE", [...this.streams]);
  }

  private sendControl(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]): void {
    this.send({ method, params, id: this.nextId++ });
  }

  private send(payload: unknown): void {
    if (!this.socket || !this.isOpen) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      this.onError(error, "socket.send");
    }
  }

  private handleMessage(raw: unknown): void {
    if (raw === undefined || raw === null) return;

    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else if (ArrayBuffer.isView(raw)) text = new TextDecoder().decode(raw);
    else text = String(raw);

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }

    const event = normalizeBinanceMessage(payload, "BINANCE", this.clock());
    if (event) this.context?.emit(event);
  }

  private streamName(subscription: MarketSubscription): string {
    const symbol = subscription.symbol.toLowerCase();
    switch (subscription.topic) {
      case "quote":
        return `${symbol}@bookTicker`;
      case "kline":
        return `${symbol}@kline_${subscription.interval}`;
      case "funding":
        if (this.market !== "futures") {
          throw new MarketError("unsupported_topic", "Funding streams are only available on futures.");
        }
        return `${symbol}@markPrice@1s`;
      case "liquidation":
        if (this.market !== "futures") {
          throw new MarketError(
            "unsupported_topic",
            "Liquidation streams are only available on futures.",
          );
        }
        return `${symbol}@forceOrder`;
      default:
        throw new MarketError("unsupported_topic", `Unsupported topic: ${String(subscription.topic)}`);
    }
  }

  private assertUsable(): void {
    if (this.stopped) throw new MarketError("connector_closed", "Connector is stopped.");
  }

  private backoff(attempt: number): number {
    const raw = Math.min(
      this.reconnectOptions.maxDelayMs,
      this.reconnectOptions.minDelayMs * Math.pow(this.reconnectOptions.factor, attempt - 1),
    );
    const jitter = raw * this.reconnectOptions.jitter * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(raw + jitter));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
}

/**
 * Normalize a Binance market-data payload. Exported for tests and for custom
 * connectors that reuse the mapper.
 */
export function normalizeBinanceMessage(
  input: unknown,
  exchange = "BINANCE",
  now = Date.now(),
): MarketEvent | null {
  if (input === null || typeof input !== "object") return null;

  let payload = input as Record<string, unknown>;
  if (payload.data && typeof payload.data === "object") {
    payload = payload.data as Record<string, unknown>;
  }

  const eventType = typeof payload.e === "string" ? payload.e : "";
  const symbol = typeof payload.s === "string" ? payload.s.toUpperCase() : "";

  if (eventType === "kline" && payload.k && typeof payload.k === "object") {
    const k = payload.k as Record<string, unknown>;
    const open = number(k.o);
    const high = number(k.h);
    const low = number(k.l);
    const close = number(k.c);
    if (!symbol || ![open, high, low, close].every(Number.isFinite)) return null;

    const event: KlineEvent = {
      type: "kline",
      exchange,
      symbol,
      interval: String(k.i),
      openTime: number(k.t),
      closeTime: number(k.T),
      open,
      high,
      low,
      close,
      volume: number(k.v),
      closed: Boolean(k.x),
      ts: number(payload.E, now),
    };
    return event;
  }

  if (eventType === "markPriceUpdate" || eventType === "markPrice") {
    if (!symbol) return null;
    const fundingRate = number(payload.r);
    if (!Number.isFinite(fundingRate)) return null;

    const event: FundingEvent = {
      type: "funding",
      exchange,
      symbol,
      fundingRate,
      markPrice: number(payload.p),
      nextFundingTime: number(payload.T),
      ts: number(payload.E, now),
    };
    return event;
  }

  if (eventType === "forceOrder" && payload.o && typeof payload.o === "object") {
    const order = payload.o as Record<string, unknown>;
    const orderSymbol =
      typeof order.s === "string" ? order.s.toUpperCase() : symbol;
    if (!orderSymbol) return null;

    const price = number(order.ap) || number(order.p);
    const quantity = number(order.q);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return null;

    const event: LiquidationEvent = {
      type: "liquidation",
      exchange,
      symbol: orderSymbol,
      side: order.S === "SELL" ? "long" : "short",
      price,
      quantity,
      usd: price * quantity,
      ts: number(payload.E, number(order.T, now)),
    };
    return event;
  }

  if (
    eventType === "bookTicker" ||
    (eventType === "" && typeof payload.b === "string" && typeof payload.a === "string")
  ) {
    if (!symbol) return null;
    const bid = number(payload.b);
    const ask = number(payload.a);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;

    const event: QuoteEvent = {
      type: "quote",
      exchange,
      symbol,
      bid,
      ask,
      bidSize: number(payload.B),
      askSize: number(payload.A),
      ts: number(payload.E, number(payload.T, now)),
    };
    return event;
  }

  return null;
}

function number(value: unknown, fallback = Number.NaN): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
