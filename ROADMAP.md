# Roadmap

Scope: small, composable primitives for real-time market terminals. Not a
trading bot, not a charting library, not a hosted product.

## 0.1 — current

- [x] Normalized market events and Binance connector.
- [x] Multiplexed SSE sessions with bounded queues and lifecycle hooks.
- [x] UDF datafeed server with provider adapters.
- [x] Svelte 5 table, order book, sparkline, metric and status components.
- [x] Core tests, component tests, consumer smoke build.

## 0.2 — hardening

- [ ] More connectors: Bybit, OKX, Coinbase.
- [ ] `Last-Event-ID` replay buffer (opt-in).
- [ ] Auth hook for sessions (`authorize(session, request)`).
- [ ] SSR render tests and an axe accessibility pass.
- [ ] Controlled pagination / virtualization for `DataTable`.
- [ ] Rate-limit-aware caching for the Binance REST provider.
- [ ] Metrics: events/sec, queue depth, reconnects.

## 0.3 — distribution

- [ ] Cross-instance fan-out via Redis pub/sub or NATS.
- [ ] Elysia / Fastify / Hono adapters.
- [ ] A hosted demo and a docs site.
- [ ] Per-package changelogs and a release cadence.
- [ ] Benchmarks with reproducible scripts.

## Non-goals

- Billing, subscriptions, account management.
- A proprietary charting library or a TradingView clone.
- Custody, order execution, or exchange API keys.
- "One framework to rule them all."

Priorities may change with feedback. Open a discussion or an issue with a
concrete use case.
