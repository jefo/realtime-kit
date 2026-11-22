<script lang="ts" generics="Row">
  import type { Snippet } from "svelte";
  import { ariaSort, nextSortState, sortRows } from "./table";
  import type { Column, SortState } from "./types";

  export interface Props<Row> {
    rows: Row[];
    columns: Column<Row>[];
    /** Stable identity for rows. Strongly recommended when rows reorder. */
    rowKey?: (row: Row, index: number) => string | number;
    selectedKey?: string | number | null;
    onRowClick?: (row: Row) => void;
    caption?: string;
    empty?: Snippet;
    loading?: boolean;
    density?: "compact" | "comfortable";
    maxHeight?: string;
    stickyHeader?: boolean;
    /** Controlled sort state. When omitted, the table sorts internally. */
    sort?: SortState;
    onSortChange?: (state: SortState) => void;
    /** Render rows as-is; use with `onSortChange` for server-side sorting. */
    manualSort?: boolean;
  }

  let {
    rows,
    columns,
    rowKey,
    selectedKey = null,
    onRowClick,
    caption,
    empty,
    loading = false,
    density = "compact",
    maxHeight = "100%",
    stickyHeader = true,
    sort,
    onSortChange,
    manualSort = false,
  }: Props<Row> = $props();

  let internalSort = $state<SortState>({ key: null, direction: "asc" });
  const activeSort = $derived(sort ?? internalSort);
  const sortedRows = $derived(
    manualSort ? rows : sortRows(rows, columns, activeSort),
  );

  function keyFor(row: Row, index: number): string | number {
    return rowKey ? rowKey(row, index) : index;
  }

  function readValue(column: Column<Row>, row: Row): unknown {
    return column.value
      ? column.value(row)
      : (row as Record<string, unknown>)[column.key];
  }

  function display(column: Column<Row>, row: Row): string {
    const value = readValue(column, row);
    if (column.format) return column.format(value, row);
    return value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  }

  function alignStyle(column: Column<Row>): string {
    const align = column.align ?? "left";
    if (align === "right") return "flex-end";
    if (align === "center") return "center";
    return "flex-start";
  }

  function onKeydown(event: KeyboardEvent, row: Row): void {
    if (!onRowClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowClick(row);
    }
  }

  function toggleSort(column: Column<Row>): void {
    const next = nextSortState(activeSort, column.key);
    if (sort === undefined) internalSort = next;
    onSortChange?.(next);
  }
</script>

<div
  class="rtk-table-wrap"
  class:rtk-table-loading={loading}
  style:max-height={maxHeight}
>
  <table class="rtk-table" data-density={density}>
    {#if caption}
      <caption>{caption}</caption>
    {/if}

    <thead class:sticky={stickyHeader}>
      <tr>
        {#each columns as column (column.key)}
          <th
            scope="col"
            style:width={column.width}
            style:text-align={column.align ?? "left"}
            aria-sort={ariaSort(activeSort, column.key)}
          >
            {#if column.sortable !== false}
              <button
                type="button"
                class="rtk-sort-button"
                style:justify-content={alignStyle(column)}
                onclick={() => toggleSort(column)}
              >
                <span>{column.header}</span>
                <span
                  class="rtk-sort-mark"
                  class:active={activeSort.key === column.key}
                  aria-hidden="true"
                >
                  {activeSort.key === column.key
                    ? activeSort.direction === "asc"
                      ? "▲"
                      : "▼"
                    : "↕"}
                </span>
              </button>
            {:else}
              {column.header}
            {/if}
          </th>
        {/each}
      </tr>
    </thead>

    <tbody>
      {#if loading && sortedRows.length === 0}
        <tr>
          <td class="rtk-table-empty" colspan={columns.length}>Loading…</td>
        </tr>
      {:else if sortedRows.length === 0}
        <tr>
          <td class="rtk-table-empty" colspan={columns.length}>
            {#if empty}
              {@render empty()}
            {:else}
              No data
            {/if}
          </td>
        </tr>
      {:else}
        {#each sortedRows as row, index (keyFor(row, index))}
          {@const key = keyFor(row, index)}
          {@const clickable = onRowClick !== undefined}
          <tr
            class:selected={selectedKey === key}
            class:clickable
            tabindex={clickable ? 0 : undefined}
            aria-selected={selectedKey === null ? undefined : selectedKey === key}
            onclick={() => onRowClick?.(row)}
            onkeydown={(event) => onKeydown(event, row)}
          >
            {#each columns as column (column.key)}
              {@const value = readValue(column, row)}
              <td
                style:text-align={column.align ?? "left"}
                class={column.cellClass?.(value, row) ?? ""}
              >
                {#if column.cell}
                  {@render column.cell(row, column)}
                {:else}
                  {display(column, row)}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .rtk-table-wrap {
    overflow: auto;
    border: 1px solid var(--rtk-border, #232b35);
    border-radius: var(--rtk-radius, 10px);
    background: var(--rtk-panel, #11161c);
  }

  .rtk-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
    font-size: var(--rtk-font-size, 12px);
  }

  caption {
    padding: 10px 12px;
    color: var(--rtk-muted, #8b95a3);
    text-align: left;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  th {
    padding: var(--rtk-row-pad, 6px 10px);
    background: var(--rtk-panel-2, #161c24);
    border-bottom: 1px solid var(--rtk-border, #232b35);
    color: var(--rtk-muted, #8b95a3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  thead.sticky th {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  td {
    padding: var(--rtk-row-pad, 6px 10px);
    border-bottom: 1px solid var(--rtk-border, #232b35);
    color: var(--rtk-text, #e6e9ee);
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr.clickable {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--rtk-hover, rgba(255, 255, 255, 0.035));
  }

  tbody tr.selected {
    background: var(--rtk-selected, rgba(212, 175, 55, 0.1));
    box-shadow: inset 2px 0 0 var(--rtk-accent, #d4af37);
  }

  tbody tr:focus-visible {
    outline: 2px solid var(--rtk-accent, #d4af37);
    outline-offset: -2px;
  }

  .rtk-sort-button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }

  .rtk-sort-button:hover {
    color: var(--rtk-text, #e6e9ee);
  }

  .rtk-sort-button:focus-visible {
    border-radius: 2px;
    outline: 2px solid var(--rtk-accent, #d4af37);
    outline-offset: 2px;
  }

  .rtk-sort-mark {
    font-size: 8px;
    opacity: 0.35;
  }

  .rtk-sort-mark.active {
    color: var(--rtk-accent, #d4af37);
    opacity: 1;
  }

  .rtk-table-empty {
    padding: 28px 12px;
    color: var(--rtk-muted, #8b95a3);
    text-align: center;
  }

  .rtk-table-loading {
    opacity: 0.72;
  }
</style>
