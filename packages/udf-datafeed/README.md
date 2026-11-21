# @rtkit/udf-datafeed

**Bring your own data. Keep the chart.**

UDF (Universal Data Feed) is the HTTP protocol behind TradingView-compatible
charts: `config`, `symbols`, `history`, `time`, `search`, `quotes`. Every
project that connects its own data to a chart re-implements the same six
endpoints and gets the edge cases wrong: timestamps in milliseconds, duplicate
bars, `no_data` vs `error`, pagination, timeouts.

This package is the server and the adapter seam. You implement one
`DataProvider`; the protocol is handled.

- Framework-agnostic fetch handler (Bun, Node 18+, any runtime with `Request`).
- `MemoryProvider` for demos and tests, `BinanceProvider` for real data.
- Normalizes bars: seconds, ascending, unique, finite OHLC.
- Per-request timeout and abort propagation.
- Search in both shapes: bare array (classic UDF) or `{ symbols }`.
- No charting library bundled, no vendor code.

## Quick start

```ts
import { createUdfHandler, MemoryProvider } from "@rtkit/udf-datafeed";

const provider = new MemoryProvider();
const handler = createUdfHandler(provider, { basePath: "/udf", cors: true });

Bun.serve({ port: 8585, fetch: handler });
```

```bash
curl -s localhost:8585/udf/config
curl -s "localhost:8585/udf/symbols?symbol=BTCUSDT"
curl -s "localhost:8585/udf/history?symbol=BTCUSDT&resolution=60&from=1700000000&to=1700086400"
curl -s "localhost:8585/udf/quotes?symbols=BTCUSDT,ETHUSDT"
```

Run the bundled demo:

```bash
bun run example:udf
# open http://localhost:8585 — a candlestick chart on the demo feed
```

Point any UDF-compatible chart at `http://localhost:8585/udf`.

## Provider contract

```ts
interface DataProvider {
  name?: string;

  getConfig?(ctx: { signal: AbortSignal }): Awaitable<Partial<UdfConfig>>;

  resolveSymbol(
    symbol: string,
    ctx: { signal: AbortSignal },
  ): Awaitable<SymbolInfo | null>;

  getBars(
    request: {
      symbol: string;
      resolution: string;
      from: number; // seconds
      to: number;   // seconds
      countback?: number;
    },
    ctx: { signal: AbortSignal },
  ): Awaitable<Bar[] | { bars: Bar[]; noData?: boolean; nextTime?: number }>;

  searchSymbols?(request: SearchRequest, ctx): Awaitable<SymbolInfo[]>;
  getQuotes?(symbols: string[], ctx): Awaitable<Quote[]>;
  getServerTime?(ctx): Awaitable<number>; // seconds
}
```

Only `resolveSymbol` and `getBars` are required. `supports_search` is derived
from whether `searchSymbols` exists.

The adapter does not need to be perfect: the handler sorts bars, drops
duplicates, converts nothing (it expects seconds) and caps the response at
`maxBars`.

## Endpoints

| Method | Path | Response |
|---|---|---|
| `GET` | `/config` | `UdfConfig` |
| `GET` | `/symbols?symbol=` | `SymbolInfo` or `404 { s: "error", errmsg: "unknown_symbol" }` |
| `GET` | `/history?symbol=&resolution=&from=&to=&countback=` | `{ s: "ok", t, o, h, l, c, v? }`, `{ s: "no_data", nextTime? }` or `{ s: "error", errmsg }` |
| `GET` | `/time` | integer seconds as `text/plain` |
| `GET` | `/search?query=&type=&exchange=&limit=` | `SearchItem[]` (default) or `{ symbols: SearchItem[] }` |
| `GET` | `/quotes?symbols=a,b` | `{ s: "ok", d: Quote[] }` |
| `GET` | `/health` | `{ ok, provider, time, maxBars }` |

History responses follow UDF: timestamps in **seconds**, ascending, unique.
`v` is omitted when no bar has volume.

## Binance adapter

```ts
import { BinanceProvider, createUdfHandler } from "@rtkit/udf-datafeed";

const provider = new BinanceProvider({
  // baseUrl: "https://fapi.binance.com", // USD-M futures
  maxBars: 20_000,
  pageLimit: 1_000, // Binance maximum
});

Bun.serve({ port: 8586, fetch: createUdfHandler(provider, { basePath: "/udf" }) });
```

- Symbol metadata comes from `/api/v3/exchangeInfo`; `tickSize` becomes
  `pricescale`.
- History uses `/api/v3/klines` and follows pagination up to `maxBars`. Huge
  ranges are clamped to the most recent `maxBars`.
- Search scans a cached `exchangeInfo` list (one request per hour by default).
- Quotes use `/api/v3/ticker/24hr`; `symbols` is sent as a JSON array.
- No API key is required for public market data.

Production notes:

- Public endpoints are rate-limited per IP. Put the handler behind your own
  cache/proxy and do not expose it directly to the internet.
- For futures, check whether the symbol universe and filters match spot.
- `maxBars` protects the process from 10-year requests; raise it deliberately.

## Normalization rules

`normalizeBars` guarantees:

- `time` is an integer Unix timestamp in seconds;
- bars are sorted ascending and de-duplicated by time (last wins);
- `open`, `high`, `low`, `close` are finite numbers;
- `volume` is kept only when finite;
- the response is capped at `maxBars` (the most recent bars survive).

## Options

| Option | Default | Meaning |
|---|---|---|
| `basePath` | none | Mount prefix, e.g. `/udf` |
| `cors` | `*` | `true`, an origin string, or `false` |
| `timeoutMs` | `15000` | Per-request provider timeout |
| `maxBars` | `50000` | Hard cap per history response |
| `searchShape` | `"array"` | `"array"` or `"object"` |
| `now` | `Date.now` | Clock for `/time` and default `to` |
| `onError` | `console.error` | Internal error sink |

## Errors

| Situation | HTTP | Body |
|---|---|---|
| Unknown symbol | 404 | `{ s: "error", errmsg: "unknown_symbol" }` |
| Bad request | 400 | `{ s: "error", errmsg: "invalid_request" }` |
| Unsupported resolution | 400 | `{ s: "error", errmsg: "unsupported_resolution" }` |
| Provider timeout | 504 | `{ s: "error", errmsg: "timeout" }` |
| Upstream/provider failure | 502 | `{ s: "error", errmsg: "internal_error" }` |
| No bars | 200 | `{ s: "no_data" }` |

TradingView's UDF client reads the body, not the status code, so the `s` field
is always populated.

## Tests

```bash
bun test        # protocol conformance, normalization, memory and Binance adapters
bun run typecheck
bun run build
```

## Roadmap

- Optional in-memory TTL cache for bars.
- Symbol groups (`supports_group_request`).
- Marks and timescale marks.
- Elysia / Fastify adapters.
- Conformance CLI: point it at any UDF URL.

## License

MIT. UDF is a public protocol; this package contains no TradingView code and
does not require their charting library.
