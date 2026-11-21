import { describe, expect, test } from "bun:test";
import {
  BinanceProvider,
  pricescaleFromTick,
  splitSymbol,
  type FetchLike,
} from "../src/adapters/binance";

const signal = new AbortController().signal;
const context = { signal };

const BTC = {
  symbol: "BTCUSDT",
  status: "TRADING",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  filters: [{ filterType: "PRICE_FILTER", tickSize: "0.01000000" }],
};

const ETHBTC = {
  symbol: "ETHBTC",
  status: "TRADING",
  baseAsset: "ETH",
  quoteAsset: "BTC",
  filters: [{ filterType: "PRICE_FILTER", tickSize: "0.00000100" }],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("helpers", () => {
  test("converts tick size to pricescale", () => {
    expect(pricescaleFromTick("0.01000000")).toBe(100);
    expect(pricescaleFromTick("0.00000100")).toBe(1_000_000);
    expect(pricescaleFromTick("1.00000000")).toBe(1);
    expect(pricescaleFromTick("0.1")).toBe(10);
  });

  test("splits symbols by the longest quote asset", () => {
    expect(splitSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitSymbol("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(splitSymbol("USDTTRY")).toEqual({ base: "USDT", quote: "TRY" });
    expect(splitSymbol("WEIRD")).toEqual({ base: "WEIRD", quote: "" });
  });
});

describe("BinanceProvider", () => {
  test("resolves symbol metadata and caches it", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/v3/exchangeInfo?symbol=BTCUSDT")) {
        return json({ symbols: [BTC] });
      }
      return json({}, 404);
    };

    const provider = new BinanceProvider({ fetch: fetcher, now: () => 1_000 });
    const info = await provider.resolveSymbol("btcusdt", context);

    expect(info?.name).toBe("BTCUSDT");
    expect(info?.description).toBe("BTC/USDT");
    expect(info?.pricescale).toBe(100);
    expect(info?.exchange).toBe("BINANCE");
    expect(info?.currency_code).toBe("USDT");

    await provider.resolveSymbol("BTCUSDT", context);
    expect(calls).toHaveLength(1);
  });

  test("returns null for a non-trading symbol", async () => {
    const fetcher: FetchLike = async () =>
      json({ symbols: [{ ...BTC, status: "BREAK" }] });
    const provider = new BinanceProvider({ fetch: fetcher });
    expect(await provider.resolveSymbol("BTCUSDT", context)).toBeNull();
  });

  test("maps klines and follows pagination", async () => {
    let klineCalls = 0;
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (!url.includes("/api/v3/klines")) return json({}, 404);
      klineCalls += 1;
      if (klineCalls === 1) {
        return json([
          [1_700_000_000_000, "100", "110", "90", "105", "10", 1_700_000_059_999],
          [1_700_000_060_000, "105", "115", "95", "110", "12", 1_700_000_119_999],
        ]);
      }
      return json([]);
    };

    const provider = new BinanceProvider({ fetch: fetcher, pageLimit: 2 });
    const bars = await provider.getBars(
      { symbol: "BTCUSDT", resolution: "1", from: 1_700_000_000, to: 1_700_000_200 },
      context,
    );

    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      time: 1_700_000_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 10,
    });
    expect(klineCalls).toBe(2);
  });

  test("clamps a huge range to maxBars", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (input) => {
      calls.push(String(input));
      return json([]);
    };

    const provider = new BinanceProvider({ fetch: fetcher, maxBars: 2 });
    await provider.getBars(
      { symbol: "BTCUSDT", resolution: "1", from: 1_700_000_000, to: 1_700_001_000 },
      context,
    );

    expect(calls[0]).toContain("startTime=1700000880000");
  });

  test("searches the cached symbol list", async () => {
    let listCalls = 0;
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v3/exchangeInfo")) {
        listCalls += 1;
        return json({ symbols: [BTC, ETHBTC] });
      }
      return json({}, 404);
    };

    const provider = new BinanceProvider({ fetch: fetcher });
    const found = await provider.searchSymbols({ query: "ETH", limit: 10 }, context);
    expect(found.map((item) => item.name)).toEqual(["ETHBTC"]);

    await provider.searchSymbols({ query: "BTC", limit: 10 }, context);
    expect(listCalls).toBe(1);
  });

  test("maps quotes", async () => {
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/ticker/24hr")) {
        return json([
          {
            symbol: "BTCUSDT",
            lastPrice: "65000.50",
            bidPrice: "65000.00",
            askPrice: "65001.00",
            openPrice: "64000.00",
            highPrice: "66000.00",
            lowPrice: "63000.00",
            prevClosePrice: "63900.00",
            volume: "1234.5",
            priceChange: "1000.50",
            priceChangePercent: "1.56",
          },
        ]);
      }
      return json({}, 404);
    };

    const provider = new BinanceProvider({ fetch: fetcher });
    const quotes = await provider.getQuotes(["BTCUSDT"], context);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.n).toBe("BTCUSDT");
    expect(quotes[0]?.s).toBe("ok");
    expect(quotes[0]?.v.lp).toBe(65_000.5);
    expect(quotes[0]?.v.short_name).toBe("BTC");
    expect(quotes[0]?.v.chp).toBe(1.56);
  });

  test("rejects an unsupported resolution without a request", async () => {
    const fetcher: FetchLike = async () => {
      throw new Error("should not be called");
    };
    const provider = new BinanceProvider({ fetch: fetcher });

    await expect(
      provider.getBars({ symbol: "BTCUSDT", resolution: "7", from: 1, to: 2 }, context),
    ).rejects.toMatchObject({ code: "unsupported_resolution" });
  });

  test("wraps upstream errors", async () => {
    const fetcher: FetchLike = async () => json({ msg: "boom" }, 500);
    const provider = new BinanceProvider({ fetch: fetcher });

    await expect(provider.resolveSymbol("BTCUSDT", context)).rejects.toMatchObject({
      code: "upstream_error",
      status: 502,
    });
  });
});
