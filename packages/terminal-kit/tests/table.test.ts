import { describe, expect, test } from "bun:test";
import { ariaSort, compareValues, nextSortState, sortRows } from "../src/lib/table";
import type { Column } from "../src/lib/types";

interface Row {
  symbol: string;
  price: number | null;
  volume: number;
}

const columns: Column<Row>[] = [
  { key: "symbol", header: "Symbol" },
  { key: "price", header: "Price" },
  { key: "volume", header: "Volume" },
];

const rows: Row[] = [
  { symbol: "ETH", price: 3200, volume: 10 },
  { symbol: "BTC", price: 65000, volume: 5 },
  { symbol: "SOL", price: null, volume: 20 },
  { symbol: "ARB", price: 1.2, volume: 5 },
];

describe("compareValues", () => {
  test("orders numbers, strings and booleans", () => {
    expect(compareValues(1, 2)).toBeLessThan(0);
    expect(compareValues("a", "b")).toBeLessThan(0);
    expect(compareValues(true, false)).toBeGreaterThan(0);
    expect(compareValues(null, 1)).toBeGreaterThan(0);
  });

  test("uses numeric string comparison", () => {
    expect(compareValues("item2", "item10")).toBeLessThan(0);
  });
});

describe("sortRows", () => {
  test("returns a copy when unsorted", () => {
    const sorted = sortRows(rows, columns, { key: null, direction: "asc" });
    expect(sorted).toEqual(rows);
    expect(sorted).not.toBe(rows);
  });

  test("sorts ascending and descending", () => {
    const asc = sortRows(rows, columns, { key: "price", direction: "asc" });
    expect(asc.map((row) => row.symbol)).toEqual(["ARB", "ETH", "BTC", "SOL"]);

    const desc = sortRows(rows, columns, { key: "price", direction: "desc" });
    expect(desc.map((row) => row.symbol)).toEqual(["BTC", "ETH", "ARB", "SOL"]);
  });

  test("keeps nulls at the bottom in both directions", () => {
    const asc = sortRows(rows, columns, { key: "price", direction: "asc" });
    expect(asc.at(-1)?.symbol).toBe("SOL");

    const desc = sortRows(rows, columns, { key: "price", direction: "desc" });
    expect(desc.at(-1)?.symbol).toBe("SOL");
  });

  test("is stable for equal values", () => {
    const sorted = sortRows(rows, columns, { key: "volume", direction: "asc" });
    expect(sorted.map((row) => row.symbol)).toEqual(["BTC", "ARB", "ETH", "SOL"]);
  });

  test("uses a custom value accessor", () => {
    const custom: Column<Row>[] = [
      { key: "symbol", header: "Symbol" },
      { key: "price", header: "Price", value: (row) => row.price ?? 0 },
    ];
    const sorted = sortRows(rows, custom, { key: "price", direction: "asc" });
    expect(sorted[0]?.symbol).toBe("SOL");
  });
});

describe("nextSortState", () => {
  test("cycles asc, desc, none", () => {
    expect(nextSortState({ key: null, direction: "asc" }, "price")).toEqual({
      key: "price",
      direction: "asc",
    });
    expect(nextSortState({ key: "price", direction: "asc" }, "price")).toEqual({
      key: "price",
      direction: "desc",
    });
    expect(nextSortState({ key: "price", direction: "desc" }, "price")).toEqual({
      key: null,
      direction: "asc",
    });
  });

  test("switches columns from ascending", () => {
    expect(nextSortState({ key: "price", direction: "desc" }, "volume")).toEqual({
      key: "volume",
      direction: "asc",
    });
  });
});

describe("ariaSort", () => {
  test("maps sort state to ARIA", () => {
    expect(ariaSort({ key: "price", direction: "asc" }, "price")).toBe("ascending");
    expect(ariaSort({ key: "price", direction: "desc" }, "price")).toBe("descending");
    expect(ariaSort({ key: "price", direction: "asc" }, "volume")).toBe("none");
  });
});
