export { canonicalize, normalizeSubscription, subscriptionKey } from "./core/canonical";
export { GatewayError, type GatewayErrorCode } from "./core/errors";
export { SessionStream, SubscriptionGateway } from "./core/gateway";
export { BoundedQueue } from "./core/queue";
export type {
  EventEnvelope,
  GatewayOptions,
  GatewayStats,
  OverflowPolicy,
  ResolvedSubscription,
  SessionCloseReason,
  SessionInfo,
  Subscription,
  TopicHooks,
} from "./core/types";

export { createSubscriptionsHandler, type HandlerOptions } from "./http/handler";
export { createSseResponse, formatSseEvent, type SseOptions } from "./http/sse";

export {
  SubscriptionsClient,
  SubscriptionsClientError,
  type ClientEnvelope,
  type ClientHandler,
  type ClientState,
  type ReconnectOptions,
  type StateListener,
  type SubscriptionsClientOptions,
} from "./client/client";
export { SseParser, type ParsedSseEvent } from "./client/parser";
