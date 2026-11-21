import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MemoryProvider } from "../src/adapters/memory";
import type { DataProvider } from "../src/protocol/types";
import { createUdfHandler } from "../src/server/handler";

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: createUdfHandler(new MemoryProvider({ now: () => 1_700_000_000_000 }), {
      basePath: "/udf",
      cors: true,
      timeoutMs: 2_000,
    }),
  });
  base = `http://127.0.0.1:${server.port}/udf`;
});

afterAll(async () => {
  await server.stop(true);
});

async function get(path: string): Promise<Response> {
  return fetch(`${base}${path}`);
}

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await get(path);
  return { status: response.status, body: (await response.json()) as T };
}

describe("GET /config", () => {
  test("returns the UDF flags", async () => {
    const { status, body } = await getJson<Record<string, unknown>>("/config");
    expect(status).toBe(200);
    expect(body.supports_search).toBe(true);
    expect(body.supports_group_request).toBe(false);
    expect(body.supports_marks).toBe(false);
    expect(body.supports_timescale_marks).toBe(false);
    expect(body.supports_time).toBe(true);
    expect(Array.isArray(body.supported_resolutions)).toBe(true);
  });
});

describe("GET /symbols", () => {
  test("resolves a known symbol", async () => {
    const { status, body } = await getJson<Record<string, unknown>>("/symbols?symbol=BTCUSDT");
    expect(status).toBe(200);
    expect(body.name).toBe("BTCUSDT");
    expect(body.ticker).toBe("BTCUSDT");
    expect(body.pricescale).toBe(100);
    expect(body.minmov).toBe(1);
    expect(body.session).toBe("24x7");
    expect(body.timezone).toBe("Etc/UTC");
    expect(body.has_intraday).toBe(true);
    expect(body.currency_code).toBe("USDT");
  });

  test("returns 404 for an unknown symbol", async () => {
    const response = await get("/symbols?symbol=NOPE");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { s: string; errmsg: string };
    expect(body.s).toBe("error");
    expect(body.errmsg).toBe("unknown_symbol");
  });

  test("requires a symbol", async () => {
    const response = await get("/symbols");
    expect(response.status).toBe(400);
  });
});

describe("GET /history", () => {
  test("returns aligned OHLCV arrays", async () => {
    const { status, body } = await getJson<{
      s: string;
      t: number[];
      o: number[];
      h: number[];
      l: number[];
      c: number[];
      v: number[];
    }>("/history?symbol=BTCUSDT&resolution=5&from=1700000000&to=1700003600");

    expect(status).toBe(200);
    expect(body.s).toBe("ok");
    expect(body.t.length).toBeGreaterThan(0);
    expect(body.o).toHaveLength(body.t.length);
    expect(body.h).toHaveLength(body.t.length);
    expect(body.l).toHaveLength(body.t.length);
    expect(body.c).toHaveLength(body.t.length);
    expect(body.v).toHaveLength(body.t.length);

    for (let i = 0; i < body.t.length; i += 1) {
      expect(body.t[i]! % 300).toBe(0);
      expect(body.h[i]!).toBeGreaterThanOrEqual(Math.max(body.o[i]!, body.c[i]!));
      expect(body.l[i]!).toBeLessThanOrEqual(Math.min(body.o[i]!, body.c[i]!));
      if (i > 0) expect(body.t[i]!).toBeGreaterThan(body.t[i - 1]!);
    }

    expect(body.t[0]!).toBeGreaterThanOrEqual(1_700_000_000);
    expect(body.t.at(-1)!).toBeLessThanOrEqual(1_700_003_600);
  });

  test("rejects a malformed resolution", async () => {
    const response = await get("/history?symbol=BTCUSDT&resolution=abc&from=1700000000&to=1700003600");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { s: string; errmsg: string };
    expect(body.s).toBe("error");
    expect(body.errmsg).toBe("unsupported_resolution");
  });

  test("returns no_data for an empty provider", async () => {
    const empty: DataProvider = {
      resolveSymbol: () => null,
      getBars: () => [],
    };
    const temporary = Bun.serve({ port: 0, fetch: createUdfHandler(empty) });
    const response = await fetch(`http://127.0.0.1:${temporary.port}/history?symbol=X&resolution=5`);
    expect(await response.json()).toEqual({ s: "no_data" });
    await temporary.stop(true);
  });

  test("passes nextTime through", async () => {
    const empty: DataProvider = {
      resolveSymbol: () => null,
      getBars: () => ({ bars: [], nextTime: 1_700_000_600 }),
    };
    const temporary = Bun.serve({ port: 0, fetch: createUdfHandler(empty) });
    const response = await fetch(`http://127.0.0.1:${temporary.port}/history?symbol=X&resolution=5`);
    expect(await response.json()).toEqual({ s: "no_data", nextTime: 1_700_000_600 });
    await temporary.stop(true);
  });

  test("times out a hanging provider", async () => {
    const hanging: DataProvider = {
      resolveSymbol: () => null,
      getBars: () => new Promise(() => {}),
    };
    const temporary = Bun.serve({
      port: 0,
      fetch: createUdfHandler(hanging, { timeoutMs: 20 }),
    });
    const response = await fetch(`http://127.0.0.1:${temporary.port}/history?symbol=X&resolution=5`);
    expect(response.status).toBe(504);
    expect(((await response.json()) as { errmsg: string }).errmsg).toBe("timeout");
    await temporary.stop(true);
  });
});

describe("GET /time", () => {
  test("returns integer seconds as plain text", async () => {
    const response = await get("/time");
    expect(response.headers.get("content-type")).toContain("text/plain");
    const value = Number(await response.text());
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(1_700_000_000);
  });
});

describe("GET /search", () => {
  test("returns a bare array by default", async () => {
    const { status, body } = await getJson<Array<Record<string, string>>>("/search?query=BTC&limit=5");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.symbol).toBe("BTCUSDT");
    expect(body[0]?.full_name).toBe("MEMORY:BTCUSDT");
    expect(body[0]?.exchange).toBe("MEMORY");
  });

  test("supports the object shape", async () => {
    const temporary = Bun.serve({
      port: 0,
      fetch: createUdfHandler(new MemoryProvider(), { searchShape: "object" }),
    });
    const response = await fetch(`http://127.0.0.1:${temporary.port}/search?query=ETH`);
    const body = (await response.json()) as { symbols: Array<{ symbol: string }> };
    expect(body.symbols[0]?.symbol).toBe("ETHUSDT");
    await temporary.stop(true);
  });
});

describe("GET /quotes", () => {
  test("returns quotes for a comma-separated list", async () => {
    const { status, body } = await getJson<{
      s: string;
      d: Array<{ n: string; s: string; v: { lp: number; short_name: string } }>;
    }>("/quotes?symbols=BTCUSDT,ETHUSDT");
    expect(status).toBe(200);
    expect(body.s).toBe("ok");
    expect(body.d).toHaveLength(2);
    expect(body.d[0]?.n).toBe("BTCUSDT");
    expect(body.d[0]?.s).toBe("ok");
    expect(body.d[0]?.v.lp).toBeGreaterThan(0);
    expect(body.d[0]?.v.short_name).toBe("BTC");
  });

  test("requires symbols", async () => {
    const response = await get("/quotes");
    expect(response.status).toBe(400);
  });
});

describe("HTTP surface", () => {
  test("answers preflight", async () => {
    const response = await fetch(`${base}/config`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("reports health", async () => {
    const { status, body } = await getJson<{ ok: boolean; provider: string }>("/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("memory");
  });

  test("returns 404 outside the base path", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/nope`);
    expect(response.status).toBe(404);
  });
});
