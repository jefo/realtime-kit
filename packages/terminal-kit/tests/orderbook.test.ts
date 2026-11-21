import { describe, expect, test } from "bun:test";
import {
  aggregateLevels,
  depthRatio,
  maxLevelSize,
  sortLevels,
  spread,
  totalSize,
} from "../src/lib/orderbook";
import type { OrderBookLevel } from "../src/lib/types";

const bids: OrderBookLevel[] = [
  { price: 99.5, size: 2 },
  { price: 100, size: 5 },
  { price: 99, size: 1 },
];

const asks: OrderBookLevel[] = [
  { price: 101, size: 3 },
  { price: 100.5, size: 4 },
  { price: 102, size: 6 },
];

describe("sortLevels", () => {
  test("sorts bids down and asks up", () => {
    const book = sortLevels(bids, asks);
    expect(book.bids.map((level) => level.price)).toEqual([100, 99.5, 99]);
    expect(book.asks.map((level) => level.price)).toEqual([100.5, 101, 102]);
  });

  test("applies maxRows per side", () => {
    const book = sortLevels(bids, asks, 2);
    expect(book.bids).toHaveLength(2);
    expect(book.asks).toHaveLength(2);
  });
});

describe("depth and size", () => {
  test("finds the maximum level size", () => {
    expect(maxLevelSize([...bids, ...asks])).toBe(6);
    expect(maxLevelSize([])).toBe(0);
  });

  test("computes a clamped depth ratio", () => {
    expect(depthRatio(3, 6)).toBe(0.5);
    expect(depthRatio(10, 6)).toBe(1);
    expect(depthRatio(-1, 6)).toBe(0);
    expect(depthRatio(1, 0)).toBe(0);
  });

  test("sums level sizes", () => {
    expect(totalSize(bids)).toBe(8);
  });
});

describe("spread", () => {
  test("computes absolute, percent and mid", () => {
    const info = spread(sortLevels(bids, asks));
    expect(info.absolute).toBe(0.5);
    expect(info.mid).toBe(100.25);
    expect(info.percent).toBeCloseTo(0.4988, 3);
  });

  test("returns nulls for an empty side", () => {
    expect(spread(sortLevels([], asks))).toEqual({
      absolute: null,
      percent: null,
      mid: null,
    });
  });
});

describe("aggregateLevels", () => {
  test("groups bids by floor and sums size", () => {
    const aggregated = aggregateLevels(
      [
        { price: 100.1, size: 1 },
        { price: 100.4, size: 2 },
        { price: 99.9, size: 3 },
      ],
      0.5,
      "bid",
    );
    expect(aggregated).toEqual([
      { price: 100, size: 3 },
      { price: 99.5, size: 3 },
    ]);
  });

  test("groups asks by ceil", () => {
    const aggregated = aggregateLevels(
      [
        { price: 100.1, size: 1 },
        { price: 100.4, size: 2 },
      ],
      0.5,
      "ask",
    );
    expect(aggregated).toEqual([{ price: 100.5, size: 3 }]);
  });

  test("returns a copy for an invalid tick size", () => {
    const input = [{ price: 1, size: 1 }];
    const output = aggregateLevels(input, 0, "bid");
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
