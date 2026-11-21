import type { OrderBookLevel } from "./types";
export interface SortedBook {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}
export declare function sortLevels(bids: OrderBookLevel[], asks: OrderBookLevel[], maxRows?: number): SortedBook;
export declare function maxLevelSize(levels: OrderBookLevel[]): number;
export declare function depthRatio(size: number, maxSize: number): number;
export interface SpreadInfo {
    absolute: number | null;
    percent: number | null;
    mid: number | null;
}
export declare function spread(book: SortedBook): SpreadInfo;
/**
 * Group price levels into buckets of `tickSize`. Bids round down, asks round up,
 * so the spread never collapses because of aggregation.
 */
export declare function aggregateLevels(levels: OrderBookLevel[], tickSize: number, side: "bid" | "ask"): OrderBookLevel[];
export declare function totalSize(levels: OrderBookLevel[]): number;
