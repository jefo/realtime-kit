export type MarketTopic = "quote" | "kline" | "funding" | "liquidation";

export interface MarketSubscription {
  topic: MarketTopic;
  symbol: string;
  /** Required for `kline`, e.g. `1m`, `1h`, `1d`. */
  interval?: string;
}

interface BaseEvent {
  exchange: string;
  symbol: string;
  /** Milliseconds. */
  ts: number;
}

export interface QuoteEvent extends BaseEvent {
  type: "quote";
  bid: number;
  ask: number;
  bidSize?: number;
  askSize?: number;
}

export interface KlineEvent extends BaseEvent {
  type: "kline";
  interval: string;
  /** Milliseconds. */
  openTime: number;
  /** Milliseconds. */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface FundingEvent extends BaseEvent {
  type: "funding";
  fundingRate: number;
  markPrice?: number;
  nextFundingTime?: number;
}

export interface LiquidationEvent extends BaseEvent {
  type: "liquidation";
  side: "long" | "short";
  price: number;
  quantity: number;
  usd: number;
}

export type MarketEvent = QuoteEvent | KlineEvent | FundingEvent | LiquidationEvent;

export type ConnectorStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface ConnectorContext {
  signal: AbortSignal;
  emit: (event: MarketEvent) => void;
  setStatus: (status: ConnectorStatus, detail?: string) => void;
}

export interface ExchangeConnector {
  readonly name: string;
  connect(context: ConnectorContext): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(subscriptions: MarketSubscription[]): Promise<void>;
  unsubscribe(subscriptions: MarketSubscription[]): Promise<void>;
}

export interface EventCache {
  get(key: string): Promise<MarketEvent | undefined>;
  set(key: string, event: MarketEvent): Promise<void>;
  delete(key: string): Promise<void>;
  snapshot(): Promise<Map<string, MarketEvent>>;
  close?(): Promise<void>;
}

export interface StreamStats {
  events: number;
  dropped: number;
}
