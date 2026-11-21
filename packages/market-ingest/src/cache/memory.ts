import type { EventCache, MarketEvent } from "../core/types";

export interface MemoryEventCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface Entry {
  event: MarketEvent;
  expiresAt: number;
}

export class MemoryEventCache implements EventCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: MemoryEventCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 1_000);
    this.ttlMs = Math.max(0, options.ttlMs ?? 60_000);
    this.clock = options.now ?? Date.now;
  }

  async get(key: string): Promise<MarketEvent | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.event;
  }

  async set(key: string, event: MarketEvent): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { event, expiresAt: this.clock() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async snapshot(): Promise<Map<string, MarketEvent>> {
    const now = this.clock();
    const result = new Map<string, MarketEvent>();
    for (const [key, entry] of this.entries) {
      if (this.ttlMs > 0 && entry.expiresAt <= now) {
        this.entries.delete(key);
        continue;
      }
      result.set(key, entry.event);
    }
    return result;
  }

  async close(): Promise<void> {
    this.entries.clear();
  }
}
