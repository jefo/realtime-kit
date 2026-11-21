import type { Column, SortState } from "./types";
export declare function compareValues(a: unknown, b: unknown): number;
/**
 * Stable sort by a column value. Nulls always go last regardless of direction.
 */
export declare function sortRows<Row>(rows: Row[], columns: Column<Row>[], state: SortState): Row[];
/** asc -> desc -> unsorted -> asc */
export declare function nextSortState(current: SortState, key: string): SortState;
export declare function ariaSort(state: SortState, key: string): "ascending" | "descending" | "none";
