import { MarketError } from "./errors";
import type { MarketEvent, MarketSubscription, MarketTopic } from "./types";

const TOPICS: MarketTopic[] = ["quote", "kline", "funding", "liquidation"];
const SYMBOL_PATTERN = /^[A-Z0-9]{2,24}$/;
const INTERVAL_PATTERN = /^[1-9]\d*[mhdwM]$/;

export function normalizeSubscription(input: MarketSubscription): MarketSubscription {
  if (input === null || typeof input !== "object") {
    throw new MarketError("invalid_subscription", "Subscription must be an object.");
  }
  if (!TOPICS.includes(input.topic)) {
    throw new MarketError("unsupported_topic", `Unsupported topic: ${String(input.topic)}`);
  }

  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new MarketError("invalid_subscription", `Invalid symbol: ${String(input.symbol)}`, {
      symbol: input.symbol,
    });
  }

  if (input.topic === "kline") {
    const interval = String(input.interval ?? "").trim();
    if (!INTERVAL_PATTERN.test(interval)) {
      throw new MarketError("invalid_subscription", `Invalid kline interval: ${interval}`, {
        interval,
      });
    }
    return { topic: "kline", symbol, interval };
  }

  return { topic: input.topic, symbol };
}

export function marketKey(subscription: MarketSubscription): string {
  return subscription.topic === "kline"
    ? `kline:${subscription.symbol}:${subscription.interval}`
    : `${subscription.topic}:${subscription.symbol}`;
}

export function eventKey(event: MarketEvent): string {
  return event.type === "kline"
    ? `kline:${event.symbol}:${event.interval}`
    : `${event.type}:${event.symbol}`;
}

export function sameSubscription(a: MarketSubscription, b: MarketSubscription): boolean {
  return marketKey(a) === marketKey(b);
}
