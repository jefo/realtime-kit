export function sortLevels(bids, asks, maxRows = Number.POSITIVE_INFINITY) {
    return {
        bids: [...bids].sort((a, b) => b.price - a.price).slice(0, maxRows),
        asks: [...asks].sort((a, b) => a.price - b.price).slice(0, maxRows),
    };
}
export function maxLevelSize(levels) {
    let max = 0;
    for (const level of levels) {
        if (Number.isFinite(level.size) && level.size > max)
            max = level.size;
    }
    return max;
}
export function depthRatio(size, maxSize) {
    if (!Number.isFinite(size) || !Number.isFinite(maxSize) || maxSize <= 0)
        return 0;
    return Math.min(1, Math.max(0, size / maxSize));
}
export function spread(book) {
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
export function aggregateLevels(levels, tickSize, side) {
    if (!Number.isFinite(tickSize) || tickSize <= 0) {
        return levels.map((level) => ({ ...level }));
    }
    const buckets = new Map();
    for (const level of levels) {
        if (!Number.isFinite(level.price) || !Number.isFinite(level.size))
            continue;
        const index = side === "bid"
            ? Math.floor(level.price / tickSize)
            : Math.ceil(level.price / tickSize);
        const price = index * tickSize;
        buckets.set(price, (buckets.get(price) ?? 0) + level.size);
    }
    return [...buckets.entries()].map(([price, size]) => ({ price, size }));
}
export function totalSize(levels) {
    return levels.reduce((sum, level) => sum + (Number.isFinite(level.size) ? level.size : 0), 0);
}
