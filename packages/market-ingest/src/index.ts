export { MarketError, type MarketErrorCode } from "./core/errors";
export { MarketHub, MarketStream, type MarketHubOptions, type MarketHubStats } from "./core/hub";
export { StreamQueue, type OverflowPolicy, type PushResult } from "./core/queue";
export {
  eventKey,
  marketKey,
  normalizeSubscription,
  sameSubscription,
} from "./core/subscriptions";
export type {
  ConnectorContext,
  ConnectorStatus,
  EventCache,
  ExchangeConnector,
  FundingEvent,
  KlineEvent,
  LiquidationEvent,
  MarketEvent,
  MarketSubscription,
  MarketTopic,
  QuoteEvent,
  StreamStats,
} from "./core/types";

export { MemoryEventCache, type MemoryEventCacheOptions } from "./cache/memory";
export {
  RedisEventCache,
  type RedisEventCacheOptions,
  type RedisLike,
} from "./cache/redis";

export {
  BinanceConnector,
  normalizeBinanceMessage,
  type BinanceConnectorOptions,
  type ReconnectOptions,
  type SocketEvent,
  type WebSocketFactory,
  type WebSocketLike,
} from "./connectors/binance";
