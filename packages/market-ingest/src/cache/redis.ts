import type { EventCache, MarketEvent } from "../core/types";

/**
 * Minimal surface of a Redis client. It matches `node-redis` v4:
 * `set(key, value, { PX: ttl })`. For ioredis, pass a small adapter or use
 * `setTtl`.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

export interface RedisEventCacheOptions {
  prefix?: string;
  ttlMs?: number;
  /** Override the SET call for clients with a different TTL signature. */
  setTtl?: (key: string, value: string, ttlMs: number) => Promise<unknown>;
}

export class RedisEventCache implements EventCache {
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly setTtl: (key: string, value: string, ttlMs: number) => Promise<unknown>;

  constructor(
    private readonly redis: RedisLike,
    options: RedisEventCacheOptions = {},
  ) {
    this.prefix = options.prefix ?? "rtkit:market:";
    this.ttlMs = Math.max(0, options.ttlMs ?? 60_000);
    this.setTtl =
      options.setTtl ??
      ((key, value, ttlMs) =>
        ttlMs > 0
          ? this.redis.set(key, value, { PX: ttlMs })
          : this.redis.set(key, value));
  }

  async get(key: string): Promise<MarketEvent | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as MarketEvent;
    } catch {
      return undefined;
    }
  }

  async set(key: string, event: MarketEvent): Promise<void> {
    await this.setTtl(this.prefix + key, JSON.stringify(event), this.ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }

  async snapshot(): Promise<Map<string, MarketEvent>> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    const result = new Map<string, MarketEvent>();
    if (keys.length === 0) return result;

    const values = await Promise.all(keys.map((key) => this.redis.get(key)));
    keys.forEach((key, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        result.set(key.slice(this.prefix.length), JSON.parse(raw) as MarketEvent);
      } catch {
        // Skip malformed entries.
      }
    });
    return result;
  }
}
