import { afterEach, describe, expect, test } from "bun:test";
import { MarketHub } from "../src/core/hub";
import { marketKey } from "../src/core/subscriptions";
import type {
  ConnectorContext,
  ConnectorStatus,
  ExchangeConnector,
  MarketEvent,
  MarketSubscription,
} from "../src/core/types";

class FakeConnector implements ExchangeConnector {
  readonly name = "fake";
  connectCalls = 0;
  disconnectCalls = 0;
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  context: ConnectorContext | null = null;

  async connect(context: ConnectorContext): Promise<void> {
    this.connectCalls += 1;
    this.context = context;
    context.setStatus("open");
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  async subscribe(subscriptions: MarketSubscription[]): Promise<void> {
    this.subscribed.push(...subscriptions.map(marketKey));
  }

  async unsubscribe(subscriptions: MarketSubscription[]): Promise<void> {
    this.unsubscribed.push(...subscriptions.map(marketKey));
  }

  emit(event: MarketEvent): void {
    this.context?.emit(event);
  }

  setStatus(status: ConnectorStatus): void {
    this.context?.setStatus(status);
  }
}

const hubs: MarketHub[] = [];

function make(options: { maxQueuePerStream?: number; overflow?: "drop-oldest" | "disconnect" } = {}) {
  const connector = new FakeConnector();
  const hub = new MarketHub({ connector, onError: () => {}, ...options });
  hubs.push(hub);
  return { connector, hub };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.stop();
});

function quote(symbol = "BTCUSDT", bid = 100): MarketEvent {
  return { type: "quote", exchange: "FAKE", symbol, bid, ask: bid + 1, ts: Date.now() };
}

const BTC: MarketSubscription = { topic: "quote", symbol: "BTCUSDT" };

describe("start and status", () => {
  test("connects and exposes connector status", async () => {
    const { connector, hub } = make();
    const statuses: string[] = [];
    hub.onStatus((status) => statuses.push(status));

    expect(hub.status).toBe("idle");
    await hub.start();

    expect(connector.connectCalls).toBe(1);
    expect(hub.status).toBe("open");
    expect(statuses).toEqual(["open"]);
  });

  test("rejects subscriptions before start", async () => {
    const { hub } = make();
    await expect(hub.subscribe(BTC)).rejects.toMatchObject({ code: "not_connected" });
  });

  test("rejects subscriptions after stop", async () => {
    const { hub } = make();
    await hub.start();
    await hub.stop();
    await expect(hub.subscribe(BTC)).rejects.toMatchObject({ code: "connector_closed" });
  });
});

describe("reference counting", () => {
  test("subscribes upstream once and unsubscribes on the last reference", async () => {
    const { connector, hub } = make();
    await hub.start();

    await hub.subscribe(BTC);
    await hub.subscribe(BTC);
    expect(connector.subscribed).toEqual(["quote:BTCUSDT"]);

    await hub.unsubscribe(BTC);
    expect(connector.unsubscribed).toEqual([]);

    await hub.unsubscribe(BTC);
    expect(connector.unsubscribed).toEqual(["quote:BTCUSDT"]);
  });

  test("deduplicates subscriptions in one call", async () => {
    const { connector, hub } = make();
    await hub.start();
    await hub.subscribe([BTC, { ...BTC }]);
    expect(connector.subscribed).toEqual(["quote:BTCUSDT"]);
  });

  test("keeps a key alive while another stream uses it", async () => {
    const { connector, hub } = make();
    await hub.start();

    const first = await hub.openStream(BTC);
    const second = await hub.openStream(BTC);
    expect(connector.subscribed).toEqual(["quote:BTCUSDT"]);

    await first.close();
    expect(connector.unsubscribed).toEqual([]);

    await second.close();
    expect(connector.unsubscribed).toEqual(["quote:BTCUSDT"]);
  });
});

describe("fan-out and cache", () => {
  test("delivers events to listeners and stores the latest", async () => {
    const { connector, hub } = make();
    const seen: MarketEvent[] = [];
    hub.onEvent((event) => seen.push(event));

    await hub.start();
    await hub.subscribe(BTC);
    connector.emit(quote("BTCUSDT", 42));

    expect(seen).toHaveLength(1);
    expect(await hub.latest(BTC)).toMatchObject({ type: "quote", bid: 42 });
    expect(await hub.latest(marketKey(BTC))).toMatchObject({ type: "quote", bid: 42 });

    const snapshot = await hub.snapshot();
    expect(snapshot.get("quote:BTCUSDT")).toMatchObject({ bid: 42 });
  });

  test("filters a stream by its own subscriptions", async () => {
    const { connector, hub } = make();
    await hub.start();
    await hub.subscribe({ topic: "quote", symbol: "ETHUSDT" });

    const stream = await hub.openStream(BTC);
    connector.emit(quote("BTCUSDT", 1));
    connector.emit(quote("ETHUSDT", 2));

    const received = await stream.next();
    expect(received.done).toBe(false);
    expect(received.value).toMatchObject({ symbol: "BTCUSDT", bid: 1 });

    await stream.close();
  });

  test("drops the oldest event when a stream is slow", async () => {
    const { connector, hub } = make({ maxQueuePerStream: 2 });
    await hub.start();
    const stream = await hub.openStream(BTC);

    for (let i = 1; i <= 5; i += 1) connector.emit(quote("BTCUSDT", i));

    expect(stream.dropped).toBe(3);
    expect((await stream.next()).value).toMatchObject({ bid: 4 });
    expect((await stream.next()).value).toMatchObject({ bid: 5 });

    await stream.close();
  });

  test("ends a stream on disconnect overflow", async () => {
    const { connector, hub } = make({ maxQueuePerStream: 1, overflow: "disconnect" });
    await hub.start();
    const stream = await hub.openStream(BTC);

    connector.emit(quote("BTCUSDT", 1));
    connector.emit(quote("BTCUSDT", 2));

    expect((await stream.next()).value).toMatchObject({ bid: 1 });
    expect((await stream.next()).done).toBe(true);
    expect(await hub.latest(BTC)).toMatchObject({ bid: 2 });
  });
});

describe("shutdown", () => {
  test("closes streams and the connector", async () => {
    const { connector, hub } = make();
    await hub.start();
    const stream = await hub.openStream(BTC);
    connector.emit(quote());

    await hub.stop();

    expect((await stream.next()).done).toBe(true);
    expect(connector.disconnectCalls).toBe(1);
    expect(hub.status).toBe("closed");
    expect(hub.stats().streams).toBe(0);
  });
});

describe("stats", () => {
  test("counts events, keys and streams", async () => {
    const { connector, hub } = make();
    await hub.start();
    const stream = await hub.openStream(BTC);
    connector.emit(quote());

    expect(hub.stats()).toMatchObject({ events: 1, keys: 1, streams: 1, status: "open" });
    expect(stream.overflowed).toBe(false);
  });
});
