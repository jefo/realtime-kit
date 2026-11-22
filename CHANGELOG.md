# Changelog

## 0.1.0 — 2026-11-21

First public release of the four packages.

### `@rtkit/subscriptions`

- Multiplexed SSE sessions with deterministic subscription keys.
- Bounded per-session queues with `drop-oldest` and `disconnect` policies.
- `onFirstSubscriber` / `onLastSubscriber` lifecycle hooks with rollback.
- Pre-attach buffering, heartbeats, CORS and health endpoint.
- Typed client with exponential-backoff reconnect and session re-creation.
- Lifecycle transitions are serialized per key; concurrent subscribers cannot
  double-start or double-stop an upstream.
- Request body limit (64 KiB by default) and CORS disabled by default.
- Framework-agnostic fetch handler; tested on Bun and Node-compatible Web APIs.

### `@rtkit/udf-datafeed`

- UDF server: `config`, `symbols`, `history`, `time`, `search`, `quotes`, `health`.
- `DataProvider` contract with per-request timeout and abort propagation.
- Bar normalization: seconds, ascending, unique, finite OHLC, capped.
- Both search response shapes: bare array and `{ symbols }`.
- `MemoryProvider` and public `BinanceProvider` (spot, optional futures).
- Demo candlestick page on `lightweight-charts`.

### `@rtkit/market-ingest`

- Normalized `quote | kline | funding | liquidation` events.
- `MarketHub` with reference-counted subscriptions and fan-out.
- Bounded `openStream()` with `drop-oldest` and `disconnect` policies.
- `MemoryEventCache` (TTL + eviction) and `RedisEventCache`.
- `BinanceConnector` with dynamic subscribe/unsubscribe and reconnect.
- Connect timeout (default 10 s) and an explicit error when no global WebSocket
  is available.
- End-to-end example: Binance WS → normalized events → SSE → browser.

### `@rtkit/terminal-kit`

- Svelte 5 components: `ThemeProvider`, `DataTable`, `OrderBook`, `Sparkline`,
  `Metric`, `ConnectionBadge`.
- Dark/light themes and compact/comfortable density via CSS tokens.
- Sortable typed table with stable ordering, nulls last and keyboard activation.
- Controlled sorting (`sort` + `onSortChange` + `manualSort`) for server-side
  data.
- Order-book math: sorting, depth ratios, spread, tick aggregation.
- Native table semantics for the order book; selected rows expose
  `aria-selected`.
- 30 unit tests and 14 component tests (Vitest + Testing Library + jsdom).
- Runnable terminal dashboard built with Vite.
