# @rtkit/subscriptions

**One EventSource per tab, not per widget.**

A dashboard with ten live widgets usually opens ten streams, duplicates
subscriptions, and never tells the upstream when nobody is watching anymore.
This package turns that into one session:

- a client sends a set of subscriptions once and gets a single SSE stream;
- the gateway fans out events to every session that asked for them;
- the upstream starts on the first subscriber and stops on the last one;
- slow clients hit a bounded queue instead of eating memory.

No framework, no database, no exchange SDK. It runs on Bun, Node 18+ and any
runtime with Web `Request`/`Response` and `ReadableStream`.

## Install

```bash
bun add @rtkit/subscriptions
```

> Not published to npm yet. Inside this repo the package is available through
> the workspace; for external projects use `bun link` or install from git.

## Quick start

### Server

```ts
import { createSubscriptionsHandler, SubscriptionGateway } from "@rtkit/subscriptions";

const gateway = new SubscriptionGateway({ sessionTtlMs: 30_000 });

gateway.registerTopic("ticker", {
  onFirstSubscriber(sub) {
    const symbol = String(sub.params.symbol);
    const timer = setInterval(() => {
      gateway.publish("ticker", { symbol }, { symbol, price: Math.random() * 100 });
    }, 500);
    timers.set(sub.key, timer);
  },
  onLastSubscriber(sub) {
    clearInterval(timers.get(sub.key));
    timers.delete(sub.key);
  },
});

Bun.serve({
  port: 8787,
  fetch: createSubscriptionsHandler(gateway, { cors: true }),
});
```

```bash
curl -s localhost:8787/health
# {"ok":true,"sessions":0,"attached":0,...}
```

### Client

```ts
import { SubscriptionsClient } from "@rtkit/subscriptions";

const client = new SubscriptionsClient({ url: "http://localhost:8787" });

client.on({ topic: "ticker", params: { symbol: "BTCUSDT" } }, (event) => {
  console.log(event.data);
});

await client.subscribe([
  { topic: "ticker", params: { symbol: "BTCUSDT" } },
  { topic: "ticker", params: { symbol: "ETHUSDT" } },
]);
```

The client reconnects with exponential backoff and re-creates the session. It
does not replay missed events — see [Delivery semantics](#delivery-semantics).

Run the bundled demo:

```bash
bun run example:server
bun run example:client
```

## How it works

```
producer ──publish(topic, params)──► gateway
                                      │  exact-match key = topic + canonical params
                                      ├─► session A queue ─► SSE stream ─► browser
                                      └─► session B queue ─► SSE stream ─► browser
```

A subscription is `{ topic, params }`. The key is deterministic:

```ts
subscriptionKey("ticker", { symbol: "BTC", market: "futures" });
// ticker:{"market":"futures","symbol":"BTC"}
```

Key order does not matter. Two sessions with the same key share one upstream
stream; a session with different params gets a different key.

## HTTP API

| Method | Path | Body | Result |
|---|---|---|---|
| `POST` | `/subscribe` | `{ subscriptions: [...] }` or an array | `{ id, subscriptions, createdAt }` |
| `GET` | `/events/:id` | — | `text/event-stream` |
| `DELETE` | `/sessions/:id` | — | `204` |
| `GET` | `/health` | — | stats |

A stream frame:

```
id: 12
event: ticker
data: {"key":"ticker:{\"symbol\":\"BTC\"}","topic":"ticker","data":{"price":42}}
```

`id` is monotonic within a session. `event` is the topic (so plain
`EventSource` consumers can listen by topic). `data.key` tells typed clients
which exact subscription fired.

`GET /events/:id` is a bearer capability: whoever has the ID can attach.
Session IDs are UUIDs, but put the gateway behind your auth proxy and issue
short TTLs for untrusted clients.

## Lifecycle hooks

```ts
gateway.registerTopic("orderbook", {
  async onFirstSubscriber(sub) {
    await exchange.subscribe(sub.params.symbol);
  },
  async onLastSubscriber(sub) {
    await exchange.unsubscribe(sub.params.symbol);
  },
});
```

- `onFirstSubscriber` fires once when the key goes from 0 to 1 sessions.
- `onLastSubscriber` fires once when it goes back to 0.
- If `onFirstSubscriber` throws, the session is rolled back and the request
  fails with `TOPIC_HOOK_FAILED` (HTTP 502).
- Hooks may be async. They are awaited before the session is returned.

Set `requireRegisteredTopics: true` to reject subscriptions for topics without
hooks.

## Backpressure

Each session has a bounded queue (`maxQueuePerSession`, default 256).

| Situation | Behavior |
|---|---|
| Reader is waiting | Event is delivered directly, never queued |
| Burst below the limit | Queued in order |
| Full queue, `drop-oldest` | Oldest event dropped, `dropped` counter grows |
| Full queue, `disconnect` | Pending events drain, then the stream ends and the session closes |
| Session detached (tab closed) | Events are counted as `missed`, not queued |
| No subscribers | `publish()` returns `0` and does nothing |

This keeps memory flat under a slow or paused consumer. For a trading terminal,
dropping the oldest tick is usually better than disconnecting the user;
`disconnect` is for streams where a gap is unacceptable.

Events published **before** the client opens `/events/:id` are buffered, so a
publish right after `POST /subscribe` is not lost.

## Options

| Option | Default | Meaning |
|---|---|---|
| `sessionTtlMs` | `30_000` | Grace period for reconnects after the stream closes |
| `maxSubscriptionsPerSession` | `64` | Hard cap, returns `TOO_MANY_SUBSCRIPTIONS` |
| `maxQueuePerSession` | `256` | Per-session event buffer |
| `overflow` | `"drop-oldest"` | `"drop-oldest"` or `"disconnect"` |
| `requireRegisteredTopics` | `false` | Reject topics without hooks |
| `sweepIntervalMs` | derived | How often expired sessions are collected |
| `idFactory` | UUID | Custom session IDs |
| `onError` | `console.error` | Hook/transport error sink |

Handler options: `basePath`, `cors`, `heartbeatMs` (default 15000),
`retryMs` (default 3000), `onError`.

## Delivery semantics

- **At-most-once.** There is no replay buffer. A reconnecting client gets a new
  session and only future events.
- Ordering is guaranteed per session via the monotonic `id`.
- Heartbeats are SSE comments (`: heartbeat <ts>`), not events.
- A `Last-Event-ID` header is accepted by clients but not replayed yet.

If you need gap-free delivery, add a replay log keyed by `(session, id)` — it is
on the roadmap, not in 0.1.

## Production notes

- Put the handler behind your auth layer; the session ID is a capability.
- Keep `heartbeatMs` below your proxy's idle timeout.
- `x-accel-buffering: no` is set for nginx; disable response buffering.
- One process fans out in memory. For multiple instances, publish through Redis
  pub/sub or NATS and keep the gateway stateless per connection.
- JSON payloads are passed through as-is; validate them at the producer.

## Tests

```bash
bun test        # 43 tests: canonical keys, fan-out, lifecycle, backpressure, HTTP, client
bun run typecheck
bun run build   # ESM + .d.ts
```

## Roadmap

- `Last-Event-ID` replay buffer.
- Auth hook (`authorize(session, request)`).
- Elysia / Fastify adapters.
- Prometheus metrics.
- Cross-instance fan-out via Redis.

## License

MIT
