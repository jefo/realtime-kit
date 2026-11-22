import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import DataTable from "../src/lib/DataTable.svelte";
import type { Column, SortState } from "../src/lib/types";

interface Row {
  symbol: string;
  price: number;
}

const rows: Row[] = [
  { symbol: "BTC", price: 2 },
  { symbol: "ARB", price: 1 },
];

const columns: Column<Row>[] = [
  { key: "symbol", header: "Symbol" },
  { key: "price", header: "Price", align: "right" },
];

// `DataTable` is generic; testing-library cannot infer `Row` through `render`.
const Table = DataTable as any;

describe("DataTable", () => {
  test("renders rows and an empty state", () => {
    render(Table, { props: { rows, columns } });
    expect(screen.getByText("BTC")).toBeTruthy();
    expect(screen.getByText("ARB")).toBeTruthy();

    render(Table, { props: { rows: [], columns } });
    expect(screen.getByText("No data")).toBeTruthy();
  });

  test("sorts rows on header click", async () => {
    render(Table, { props: { rows, columns } });

    await fireEvent.click(screen.getByRole("button", { name: /price/i }));

    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0] as HTMLElement).getByText("ARB")).toBeTruthy();
  });

  test("reports controlled sort changes", async () => {
    const changes: SortState[] = [];
    render(Table, {
      props: {
        rows,
        columns,
        sort: { key: null, direction: "asc" },
        onSortChange: (state: SortState) => changes.push(state),
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /price/i }));
    expect(changes).toEqual([{ key: "price", direction: "asc" }]);
  });

  test("marks the selected row", () => {
    render(Table, {
      props: { rows, columns, rowKey: (row: Row) => row.symbol, selectedKey: "ARB" },
    });

    const selected = screen.getByText("ARB").closest("tr");
    expect(selected?.getAttribute("aria-selected")).toBe("true");
  });
});
