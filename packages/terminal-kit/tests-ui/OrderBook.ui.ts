import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/svelte";
import OrderBook from "../src/lib/OrderBook.svelte";

describe("OrderBook", () => {
  test("renders a semantic table with levels", () => {
    render(OrderBook, {
      props: {
        bids: [{ price: 99, size: 1 }],
        asks: [{ price: 101, size: 2 }],
        title: "BTC book",
      },
    });

    expect(screen.getByRole("table", { name: /BTC book levels/i })).toBeTruthy();
    expect(screen.getByText("99.00")).toBeTruthy();
    expect(screen.getByText("101.00")).toBeTruthy();
    expect(screen.getByText("1.00")).toBeTruthy();
    expect(screen.getByText("2.00")).toBeTruthy();
  });

  test("renders an explicit empty state", () => {
    render(OrderBook, { props: { bids: [], asks: [], title: "Empty" } });
    expect(screen.getByText("No book")).toBeTruthy();
  });

  test("aggregates levels by tick size", () => {
    render(OrderBook, {
      props: {
        bids: [
          { price: 100.1, size: 1 },
          { price: 100.4, size: 2 },
        ],
        asks: [],
        tickSize: 0.5,
        title: "Aggregated",
      },
    });

    expect(screen.getByText("100.00", { selector: ".rtk-book-value" })).toBeTruthy();
    expect(screen.getByText("3.00", { selector: ".rtk-book-size" })).toBeTruthy();
  });
});
