# @rtkit/market-ingest

> Part of [Realtime Kit](https://github.com/jefo/realtime-kit) — small, tested
> building blocks for real-time market terminals.

**One event shape for the exchanges you connect.**

Every exchange ships its own WebSocket payloads, its own symbol names and its
own idea of what a liquidation looks like. Downstream code should not care.
This package normalizes market data into four events, reference-counts upstream
subscriptions and keeps the latest snapshot in a cache. Binance is the first
bundled connector; the interfaces are ready for more.

- `quote | kline | funding | liquidation` — one union, one key.
- Reference counting: the upstream stream starts on the first subscriber and
  stops on the last one.
- Backpressured `openStream()` for consumers that can fall behind.
- Cache: in-memory by default, Redis optional.
- Binance connector with dynamic `SUBSCRIBE`/`UNSUBSCRIBE` and reconnect.
- No exchange SDK, no Redis dependency, no framework.

## Install

Not on npm yet; the package name and scope will be finalized before the first
publish.

```bash
git clone https://github.com/jefo/realtime-kit
cd realtime-kit
bun install
```

For a local consumer, run `bun link` from `packages/market-ingest`.

## Quick start

```ts
import { BinanceConnector, MarketHub } from "@rtkit/market-ingest";

const hub = new MarketHub({
  connector: new BinanceConnector({ market: "futures" }),
});

await hub.start();

await hub.subscribe([
  { topic: "quote", symbol: "BTCUSDT" },
  { topic: "kline", symbol: "BTCUSDT", interval: "1m" },
]);

const stream = await hub.openStream({ topic: "quote", symbol: "ETHUSDT" });
for await (const event of stream) {
  console.log(event.type, event.symbol, event);
}
```

The latest value per key is cached:

```ts
await hub.latest({ topic: "quote", symbol: "BTCUSDT" });
await hub.snapshot(); // Map<"quote:BTCUSDT", MarketEvent>
```

## Events

```ts
type MarketEvent =
  | { type: "quote"; exchange; symbol; bid; ask; bidSize?; askSize?; ts }
  | { type: "kline"; exchange; symbol; interval; openTime; closeTime;
      open; high; low; close; volume; closed; ts }
  | { type: "funding"; exchange; symbol; fundingRate; markPrice?;
      nextFundingTime?; ts }
  | { type: "liquidation"; exchange; symbol; side: "long" | "short";
      price; quantity; usd; ts };
```

`ts` and bar times are milliseconds. Symbols are uppercase. Keys:

```
quote:BTCUSDT
kline:BTCUSDT:1m
funding:BTCUSDT
liquidation:BTCUSDT
```

## Connector contract

```ts
interface ExchangeConnector {
  readonly name: string;
  connect(ctx: {
    signal: AbortSignal;
    emit(event: MarketEvent): void;
    setStatus(status: ConnectorStatus, detail?: string): void;
  }): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(subscriptions: MarketSubscription[]): Promise<void>;
  unsubscribe(subscriptions: MarketSubscription[]): Promise<void>;
}
```

An adapter only maps raw payloads to `MarketEvent`, keeps its socket alive and
calls `emit`. The hub handles fan-out, refcounts and caching. See
`MemoryConnector`-style fakes in the tests for a 30-line reference.

## Reference counting

```ts
await hub.subscribe(quoteBtc); // upstream: subscribe quote:BTCUSDT
await hub.subscribe(quoteBtc); // no second upstream subscription
await hub.unsubscribe(quoteBtc); // still subscribed upstream
await hub.unsubscribe(quoteBtc); // upstream: unsubscribe
```

Two UI widgets on the same symbol share one upstream stream. When the last one
closes, the exchange stream stops.

## Streams and backpressure

`hub.onEvent()` is a synchronous firehose for gateways and writers.
`hub.openStream(subs)` returns a filtered async iterator with a bounded queue:

| Situation | Behavior |
|---|---|
| Reader is waiting | Event is delivered directly |
| Queue below the limit | Queued in order |
| Full, `drop-oldest` | Oldest event dropped, `stream.dropped` grows |
| Full, `disconnect` | Pending events drain, then the stream ends |
| Stream closed | Listener removed, refcount released |

`maxQueuePerStream` defaults to 256.

## Cache

```ts
import { MarketHub, MemoryEventCache } from "@rtkit/market-ingest";
new MarketHub({ connector, cache: new MemoryEventCache({ ttlMs: 30_000, maxEntries: 5_000 }) });
```

`MemoryEventCache` is an LRU-ish map with TTL. It is per-process.

For several instances, mirror the cache in Redis:

```ts
import { RedisEventCache } from "@rtkit/market-ingest";

const cache = new RedisEventCache(redis, { prefix: "market:", ttlMs: 60_000 });
```

`RedisLike` matches `node-redis` v4 (`set(key, value, { PX })`). For ioredis or
another client, pass `setTtl`:

```ts
new RedisEventCache(redis, {
  setTtl: (key, value, ttl) => redis.set(key, value, "PX", ttl),
});
```

`snapshot()` uses `KEYS`; for a large keyspace use a dedicated index or SCAN.

## Binance connector

```ts
new BinanceConnector({
  market: "futures",           // default; "spot" disables funding/liquidation
  wsUrl: "wss://fstream.binance.com/ws",
  reconnect: { minDelayMs: 500, maxDelayMs: 15_000, jitter: 0.2 },
});
```

| Topic | Stream |
|---|---|
| `quote` | `<symbol>@bookTicker` |
| `kline` | `<symbol>@kline_<interval>` |
| `funding` | `<symbol>@markPrice@1s` |
| `liquidation` | `<symbol>@forceOrder` |

- One WebSocket, dynamic `SUBSCRIBE` / `UNSUBSCRIBE`.
- Active streams are restored after reconnect.
- Funding and liquidation are futures-only; spot throws `unsupported_topic`.
- A silent socket is rejected after `connectTimeoutMs` (default 10 s) instead of
  hanging `connect()`.
- The runtime answers Binance's protocol ping; no manual pong.
- `normalizeBinanceMessage()` is exported for custom transports.
- Node 22+ has a global `WebSocket`. On Node 18–20, pass `webSocketFactory`
  (for example the `ws` package).

## Bridge to SSE

```ts
const hub = new MarketHub({ connector: new BinanceConnector() });
const gateway = new SubscriptionGateway();

gateway.registerTopic("quote", {
  onFirstSubscriber: (sub) => hub.subscribe({ topic: "quote", symbol: String(sub.params.symbol) }),
  onLastSubscriber: (sub) => hub.unsubscribe({ topic: "quote", symbol: String(sub.params.symbol) }),
});

hub.onEvent((event) => gateway.publish(event.type, { symbol: event.symbol }, event));
```

A complete server is in `examples/bridge-server.ts`:

```bash
bun run example:bridge
# POST http://localhost:8790/rt/subscribe
# GET  http://localhost:8790/rt/events/<id>
```

This is the full pipeline: Binance WS → normalized events → SSE → browser.

## Options

| Option | Default | Meaning |
|---|---|---|
| `cache` | `MemoryEventCache` | Snapshot store |
| `maxQueuePerStream` | `256` | Per-stream buffer |
| `overflow` | `"drop-oldest"` | `"drop-oldest"` or `"disconnect"` |
| `onError` | `console.error` | Error sink |

Connector options: `market`, `wsUrl`, `webSocketFactory`, `connectTimeoutMs`
(default `10000`), `reconnect`, `now`, `onError`.

## Limitations

- Binance is the only bundled connector.
- Subscriptions are exact-match; no wildcards.
- No replay buffer; events are at-most-once.
- Authentication is out of scope; put the bridge behind your own gateway.
- Node 18–20 need a WebSocket factory for the default connector.
- The Binance REST provider does not implement rate limiting; use a cache/proxy
  in production.

## Tests

```bash
bun test        # 38 tests: refcounts, fan-out, cache, backpressure, Binance mapping, reconnect
bun run typecheck
bun run build
```

## Roadmap

- Trade and order-book topics.
- Bybit / OKX / Coinbase connectors.
- Multi-connector fan-in with priority.
- Optional Redis pub/sub fan-out between instances.
- Metrics (events/sec, lag, reconnects).

## License

MIT
