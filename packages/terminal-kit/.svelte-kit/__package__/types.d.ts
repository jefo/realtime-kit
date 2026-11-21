import type { Snippet } from "svelte";
export type SortDirection = "asc" | "desc";
export interface SortState {
    key: string | null;
    direction: SortDirection;
}
export interface Column<Row> {
    key: string;
    header: string;
    align?: "left" | "right" | "center";
    width?: string;
    sortable?: boolean;
    /** Extract a value for sorting and default rendering. */
    value?: (row: Row) => unknown;
    /** Format the extracted value as text. */
    format?: (value: unknown, row: Row) => string;
    /** Apply a class to the cell based on the value. */
    cellClass?: (value: unknown, row: Row) => string | undefined;
    /** Full custom cell. Takes precedence over `format`. */
    cell?: Snippet<[Row, Column<Row>]>;
}
export interface OrderBookLevel {
    price: number;
    size: number;
}
export type ConnectionStatus = "live" | "connecting" | "reconnecting" | "offline";
