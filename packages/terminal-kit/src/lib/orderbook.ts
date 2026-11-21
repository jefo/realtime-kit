import type { OrderBookLevel } from "./types";

export interface SortedBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export function sortLevels(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  maxRows = Number.POSITIVE_INFINITY,
): SortedBook {
  return {
    bids: [...bids].sort((a, b) => b.price - a.price).slice(0, maxRows),
    asks: [...asks].sort((a, b) => a.price - b.price).slice(0, maxRows),
  };
}

export function maxLevelSize(levels: OrderBookLevel[]): number {
  let max = 0;
  for (const level of levels) {
    if (Number.isFinite(level.size) && level.size > max) max = level.size;
  }
  return max;
}

export function depthRatio(size: number, maxSize: number): number {
  if (!Number.isFinite(size) || !Number.isFinite(maxSize) || maxSize <= 0) return 0;
  return Math.min(1, Math.max(0, size / maxSize));
}

export interface SpreadInfo {
  absolute: number | null;
  percent: number | null;
  mid: number | null;
}

export function spread(book: SortedBook): SpreadInfo {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid === undefined || bestAsk === undefined) {
    return { absolute: null, percent: null, mid: null };
  }

  const mid = (bestBid + bestAsk) / 2;
  const absolute = bestAsk - bestBid;
  return {
    absolute,
    percent: mid === 0 ? null : (absolute / mid) * 100,
    mid,
  };
}

/**
 * Group price levels into buckets of `tickSize`. Bids round down, asks round up,
 * so the spread never collapses because of aggregation.
 */
export function aggregateLevels(
  levels: OrderBookLevel[],
  tickSize: number,
  side: "bid" | "ask",
): OrderBookLevel[] {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return levels.map((level) => ({ ...level }));
  }

  const buckets = new Map<number, number>();
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    const index =
      side === "bid"
        ? Math.floor(level.price / tickSize)
        : Math.ceil(level.price / tickSize);
    const price = index * tickSize;
    buckets.set(price, (buckets.get(price) ?? 0) + level.size);
  }

  return [...buckets.entries()].map(([price, size]) => ({ price, size }));
}

export function totalSize(levels: OrderBookLevel[]): number {
  return levels.reduce((sum, level) => sum + (Number.isFinite(level.size) ? level.size : 0), 0);
}
