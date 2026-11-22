import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Metric from "../src/lib/Metric.svelte";
import ConnectionBadge from "../src/lib/ConnectionBadge.svelte";

describe("Metric", () => {
  test("formats a numeric value and a delta", () => {
    render(Metric, {
      props: { label: "BTC / USDT", value: 65_000, delta: 1.24, decimals: 2 },
    });

    expect(screen.getByText("BTC / USDT")).toBeTruthy();
    expect(screen.getByText("65,000.00")).toBeTruthy();
    expect(screen.getByText("+1.24%")).toBeTruthy();
  });

  test("marks a negative trend", () => {
    const { container } = render(Metric, {
      props: { label: "ETH", value: 3_200, delta: -0.8 },
    });

    expect(container.querySelector("[data-trend='down']")).toBeTruthy();
  });
});

describe("ConnectionBadge", () => {
  test("renders the status label and latency", () => {
    render(ConnectionBadge, { props: { status: "live", latencyMs: 12.4 } });

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("12 ms")).toBeTruthy();
  });

  test("uses the offline label", () => {
    render(ConnectionBadge, { props: { status: "offline" } });
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});
