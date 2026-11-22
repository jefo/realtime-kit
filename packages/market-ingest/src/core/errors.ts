export type MarketErrorCode =
  | "unsupported_topic"
  | "invalid_subscription"
  | "not_connected"
  | "connector_closed"
  | "unsupported_runtime"
  | "upstream_error";

export class MarketError extends Error {
  constructor(
    readonly code: MarketErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MarketError";
  }
}
