import { GatewayError } from "./errors";
import type { ResolvedSubscription, Subscription } from "./types";

const TOPIC_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function assertTopic(topic: unknown): asserts topic is string {
  if (typeof topic !== "string" || !TOPIC_PATTERN.test(topic)) {
    throw new GatewayError(
      "INVALID_TOPIC",
      "Topic must be 1-64 chars: letters, digits, dot, underscore or dash, starting with a letter or digit.",
      { topic },
    );
  }
}

/**
 * Deterministic JSON: object keys are sorted recursively, so the same
 * subscription always produces the same key regardless of key order.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new GatewayError("INVALID_PARAMS", "Only finite numbers are allowed in params.");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(",")}}`;
    }
    default:
      throw new GatewayError("INVALID_PARAMS", `Unsupported value type in params: ${typeof value}.`);
  }
}

export function subscriptionKey(topic: string, params?: Record<string, unknown>): string {
  assertTopic(topic);
  return `${topic}:${canonicalize(params ?? {})}`;
}

export function normalizeSubscription(input: Subscription): ResolvedSubscription {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayError("INVALID_PARAMS", "Subscription must be an object with a topic.");
  }

  assertTopic(input.topic);

  const params = input.params ?? {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new GatewayError("INVALID_PARAMS", "Subscription params must be an object.", {
      topic: input.topic,
    });
  }

  const copy = { ...params } as Record<string, unknown>;
  return {
    topic: input.topic,
    params: copy,
    key: `${input.topic}:${canonicalize(copy)}`,
  };
}
