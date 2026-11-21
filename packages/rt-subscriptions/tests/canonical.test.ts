import { describe, expect, test } from "bun:test";
import { canonicalize, normalizeSubscription, subscriptionKey } from "../src/core/canonical";
import { GatewayError } from "../src/core/errors";

describe("canonicalize", () => {
  test("sorts object keys recursively", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  test("keeps array order", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  test("drops undefined keys", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }));
  });

  test("rejects non-finite numbers", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow(GatewayError);
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(GatewayError);
  });
});

describe("subscriptionKey", () => {
  test("is stable regardless of key order", () => {
    const one = subscriptionKey("ticker", { symbol: "BTCUSDT", market: "futures" });
    const two = subscriptionKey("ticker", { market: "futures", symbol: "BTCUSDT" });
    expect(one).toBe(two);
  });

  test("separates different params", () => {
    expect(subscriptionKey("ticker", { symbol: "BTC" })).not.toBe(
      subscriptionKey("ticker", { symbol: "ETH" }),
    );
  });

  test("rejects invalid topics", () => {
    expect(() => subscriptionKey("bad topic")).toThrow(GatewayError);
    expect(() => subscriptionKey("")).toThrow(GatewayError);
    expect(() => subscriptionKey("-leading")).toThrow(GatewayError);
    expect(() => subscriptionKey("a".repeat(65))).toThrow(GatewayError);
  });

  test("accepts dotted and dashed topics", () => {
    expect(subscriptionKey("market.trade-v2")).toBe('market.trade-v2:{}');
  });
});

describe("normalizeSubscription", () => {
  test("defaults params to an empty object", () => {
    const sub = normalizeSubscription({ topic: "ticker" });
    expect(sub.params).toEqual({});
    expect(sub.key).toBe("ticker:{}");
  });

  test("rejects array params", () => {
    expect(() =>
      normalizeSubscription({ topic: "ticker", params: [] as unknown as Record<string, unknown> }),
    ).toThrow(GatewayError);
  });
});
