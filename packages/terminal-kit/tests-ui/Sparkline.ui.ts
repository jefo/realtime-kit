import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Sparkline from "../src/lib/Sparkline.svelte";

describe("Sparkline", () => {
  test("renders an accessible svg path without NaN", () => {
    const { container } = render(Sparkline, {
      props: { values: [1, 2, 3, 2.5], label: "BTC price" },
    });

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("BTC price");
    expect(container.innerHTML).not.toContain("NaN");
  });

  test("handles a flat series", () => {
    const { container } = render(Sparkline, { props: { values: [5, 5, 5] } });
    expect(container.querySelector("path")).toBeTruthy();
    expect(container.innerHTML).not.toContain("NaN");
  });

  test("renders the empty state", () => {
    render(Sparkline, { props: { values: [], label: "price" } });
    expect(screen.getByRole("img", { name: /no data/i })).toBeTruthy();
  });
});
