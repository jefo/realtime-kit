export type GatewayErrorCode =
  | "INVALID_TOPIC"
  | "INVALID_PARAMS"
  | "INVALID_BODY"
  | "EMPTY_SUBSCRIPTIONS"
  | "TOO_MANY_SUBSCRIPTIONS"
  | "UNKNOWN_SESSION"
  | "TOPIC_HOOK_FAILED";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: GatewayErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
