# Realtime Kit

Reusable real-time primitives, extracted from a production crypto terminal and
rebuilt as standalone packages.

| Package | Status | What it does |
|---|---|---|
| [`@rtkit/subscriptions`](packages/rt-subscriptions) | **0.1.0** | Multiplexed SSE subscriptions, bounded queues, lifecycle hooks, typed client |
| [`@rtkit/udf-datafeed`](packages/udf-datafeed) | **0.1.0** | UDF server, provider contract, memory and Binance adapters |
| [`@rtkit/market-ingest`](packages/market-ingest) | **0.1.0** | Normalized events, exchange connectors, refcounted streams, memory/Redis cache |
| `terminal-kit` | planned | Svelte components for data-heavy terminals |

## Why

Most "real-time dashboard" code starts as one stream per widget and ends as a
memory leak with reconnect storms. These packages encode the parts that were
actually hard:

- fan-out and multiplexing instead of duplicate upstream connections;
- bounded queues with an explicit overflow policy;
- upstream lifecycle tied to subscriber count;
- typed client with reconnect and session re-creation.

No exchange SDKs, no charting library, no vendor lock-in. Data sources are
adapters.

## Commands

```bash
bun install
bun test
bun run typecheck
bun run build

bun run example:server   # http://localhost:8787
bun run example:client
bun run example:udf      # http://localhost:8585, candlestick demo
bun run example:bridge   # http://localhost:8790, Binance WS -> SSE
```

## Principles

- **Small surface.** Each package solves one boundary and exposes one contract.
- **No hidden dependencies.** Core packages run on Web standards.
- **Explicit failure.** Limits, overflow and lifecycle errors are observable.
- **Tests on boundaries**, not on markup.

## Docs

- [Architecture](docs/architecture.md) — package boundaries, deployment, scaling.
- [Demo script](docs/demo-script.md) — six-minute walkthrough (RU).
- [Release](RELEASE.md) — GitHub, npm scope, publish checklist.
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
