import { describe, expect, test } from "bun:test";
import { MemoryEventCache } from "../src/cache/memory";
import { RedisEventCache, type RedisLike } from "../src/cache/redis";
import type { MarketEvent } from "../src/core/types";

function quote(price = 1): MarketEvent {
  return {
    type: "quote",
    exchange: "FAKE",
    symbol: "BTCUSDT",
    bid: price,
    ask: price + 1,
    ts: 1_700_000_000_000,
  };
}

class FakeRedis implements RedisLike {
  readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.map.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<unknown> {
    for (const key of keys) this.map.delete(key);
    return keys.length;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    return [...this.map.keys()].filter((key) => regex.test(key));
  }
}

describe("MemoryEventCache", () => {
  test("stores and reads events", async () => {
    const cache = new MemoryEventCache();
    await cache.set("quote:BTCUSDT", quote(1));
    expect(await cache.get("quote:BTCUSDT")).toMatchObject({ bid: 1 });
  });

  test("expires entries after the TTL", async () => {
    let clock = 1_000;
    const cache = new MemoryEventCache({ ttlMs: 100, now: () => clock });

    await cache.set("a", quote());
    expect(await cache.get("a")).toBeDefined();

    clock += 101;
    expect(await cache.get("a")).toBeUndefined();
  });

  test("evicts the oldest entry above maxEntries", async () => {
    const cache = new MemoryEventCache({ maxEntries: 2 });
    await cache.set("a", quote(1));
    await cache.set("b", quote(2));
    await cache.set("c", quote(3));

    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBeDefined();
    expect(await cache.get("c")).toBeDefined();
  });

  test("updates the LRU position on write", async () => {
    const cache = new MemoryEventCache({ maxEntries: 2 });
    await cache.set("a", quote(1));
    await cache.set("b", quote(2));
    await cache.set("a", quote(3));
    await cache.set("c", quote(4));

    expect(await cache.get("a")).toMatchObject({ bid: 3 });
    expect(await cache.get("b")).toBeUndefined();
  });

  test("snapshots live entries and drops expired ones", async () => {
    let clock = 1_000;
    const cache = new MemoryEventCache({ ttlMs: 100, now: () => clock });
    await cache.set("a", quote(1));
    clock += 50;
    await cache.set("b", quote(2));
    clock += 60;

    const snapshot = await cache.snapshot();
    expect(snapshot.has("a")).toBe(false);
    expect(snapshot.get("b")).toMatchObject({ bid: 2 });
  });
});

describe("RedisEventCache", () => {
  test("uses a prefix and round-trips JSON", async () => {
    const redis = new FakeRedis();
    const cache = new RedisEventCache(redis, { prefix: "test:", ttlMs: 1_000 });

    await cache.set("quote:BTCUSDT", quote(7));
    expect(redis.map.has("test:quote:BTCUSDT")).toBe(true);
    expect(await cache.get("quote:BTCUSDT")).toMatchObject({ bid: 7 });
  });

  test("deletes a key", async () => {
    const redis = new FakeRedis();
    const cache = new RedisEventCache(redis);
    await cache.set("a", quote());
    await cache.delete("a");
    expect(await cache.get("a")).toBeUndefined();
  });

  test("snapshots all prefixed keys and skips malformed values", async () => {
    const redis = new FakeRedis();
    const cache = new RedisEventCache(redis, { prefix: "rt:" });
    await cache.set("a", quote(1));
    await cache.set("b", quote(2));
    redis.map.set("rt:bad", "{not json");
    redis.map.set("other:key", JSON.stringify(quote(3)));

    const snapshot = await cache.snapshot();
    expect(snapshot.get("a")).toMatchObject({ bid: 1 });
    expect(snapshot.get("b")).toMatchObject({ bid: 2 });
    expect(snapshot.has("bad")).toBe(false);
    expect(snapshot.has("other:key")).toBe(false);
  });

  test("supports a custom TTL writer", async () => {
    const redis = new FakeRedis();
    const calls: Array<[string, number]> = [];
    const cache = new RedisEventCache(redis, {
      ttlMs: 500,
      setTtl: async (key, value, ttl) => {
        calls.push([key, ttl]);
        redis.map.set(key, value);
        return "OK";
      },
    });

    await cache.set("a", quote());
    expect(calls).toEqual([["rtkit:market:a", 500]]);
  });
});
