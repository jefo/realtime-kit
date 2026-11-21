import type { Column, SortState } from "./types";

export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Stable sort by a column value. Nulls always go last regardless of direction.
 */
export function sortRows<Row>(
  rows: Row[],
  columns: Column<Row>[],
  state: SortState,
): Row[] {
  const key = state.key;
  if (key === null) return rows.slice();

  const column = columns.find((item) => item.key === key);
  const read = (row: Row): unknown =>
    column?.value
      ? column.value(row)
      : (row as Record<string, unknown>)[key];

  const direction = state.direction === "asc" ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aValue = read(a.row);
      const bValue = read(b.row);

      // Keep null/undefined at the bottom in both directions.
      const aEmpty = aValue === null || aValue === undefined;
      const bEmpty = bValue === null || bValue === undefined;
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return a.index - b.index;
        return aEmpty ? 1 : -1;
      }

      const compared = compareValues(aValue, bValue);
      return compared === 0 ? a.index - b.index : compared * direction;
    })
    .map((item) => item.row);
}

/** asc -> desc -> unsorted -> asc */
export function nextSortState(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return { key: null, direction: "asc" };
}

export function ariaSort(state: SortState, key: string): "ascending" | "descending" | "none" {
  if (state.key !== key) return "none";
  return state.direction === "asc" ? "ascending" : "descending";
}
