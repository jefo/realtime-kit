import { describe, expect, test } from "bun:test";
import {
  formatCompact,
  formatDelta,
  formatDuration,
  formatInteger,
  formatPercent,
  formatPrice,
  formatSigned,
  formatTime,
} from "../src/lib/format";

describe("formatPrice", () => {
  test("uses fixed decimals and grouping", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(0.123456, 6)).toBe("0.123456");
  });

  test("handles non-finite values", () => {
    expect(formatPrice(Number.NaN)).toBe("—");
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCompact", () => {
  test("shortens large numbers", () => {
    expect(formatCompact(1_234)).toBe("1.2K");
    expect(formatCompact(2_500_000)).toBe("2.5M");
  });

  test("keeps small numbers readable", () => {
    expect(formatCompact(12.5)).toBe("12.50");
    expect(formatCompact(999)).toBe("999");
  });
});

describe("percent and delta", () => {
  test("adds a sign for positive values", () => {
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-1.234)).toBe("-1.23%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(1.234, 2, false)).toBe("1.23%");
  });

  test("renders delta arrows", () => {
    expect(formatDelta(1.2)).toBe("▲ +1.20%");
    expect(formatDelta(-1.2)).toBe("▼ -1.20%");
    expect(formatDelta(0)).toBe("• 0.00%");
  });

  test("formats signed numbers", () => {
    expect(formatSigned(2)).toBe("+2.00");
    expect(formatSigned(-2)).toBe("-2.00");
  });
});

describe("formatTime", () => {
  test("formats UTC time with optional seconds", () => {
    const date = Date.UTC(2024, 0, 1, 12, 34, 56);
    expect(formatTime(date)).toBe("12:34");
    expect(formatTime(date, { seconds: true })).toBe("12:34:56");
  });
});

describe("formatDuration", () => {
  test("picks a readable unit", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1_500)).toBe("1.5 s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
  });
});

describe("formatInteger", () => {
  test("groups thousands", () => {
    expect(formatInteger(1_234_567)).toBe("1,234,567");
  });
});
