import { afterEach, describe, expect, test } from "bun:test";
import {
  BinanceConnector,
  normalizeBinanceMessage,
  type BinanceConnectorOptions,
  type SocketEvent,
  type WebSocketLike,
} from "../src/connectors/binance";
import type { ConnectorContext, ConnectorStatus, MarketEvent } from "../src/core/types";

class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>();

  constructor(
    readonly url: string,
    autoOpen = true,
  ) {
    if (autoOpen) queueMicrotask(() => this.emit("open", {}));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", { code: 1000 });
  }

  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: SocketEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  controls(): Array<{ method: string; params: string[]; id: number }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { method?: string; params?: string[]; id?: number })
      .filter((item): item is { method: string; params: string[]; id: number } =>
        Boolean(item.method && item.params),
      );
  }
}

const connectors: BinanceConnector[] = [];

function setup(options: Partial<BinanceConnectorOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const connector = new BinanceConnector({
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    reconnect: { minDelayMs: 1, maxDelayMs: 5, jitter: 0 },
    ...options,
  });
  connectors.push(connector);

  const events: MarketEvent[] = [];
  const statuses: ConnectorStatus[] = [];
  const context: ConnectorContext = {
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    setStatus: (status) => statuses.push(status),
  };

  return { connector, sockets, events, statuses, context };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  for (const connector of connectors.splice(0)) await connector.disconnect();
});

describe("connection", () => {
  test("opens the futures socket by default", async () => {
    const { connector, sockets, statuses, context } = setup();
    await connector.connect(context);

    expect(sockets[0]?.url).toBe("wss://fstream.binance.com/ws");
    expect(statuses).toEqual(["connecting", "open"]);
    expect(connector.status).toBe("open");
  });

  test("uses the spot socket when configured", async () => {
    const { connector, sockets, context } = setup({ market: "spot" });
    await connector.connect(context);
    expect(sockets[0]?.url).toContain("stream.binance.com");
  });

  test("rejects subscriptions after disconnect", async () => {
    const { connector, context } = setup();
    await connector.connect(context);
    await connector.disconnect();

    await expect(
      connector.subscribe([{ topic: "quote", symbol: "BTCUSDT" }]),
    ).rejects.toMatchObject({ code: "connector_closed" });
  });

  test("times out a socket that never opens", async () => {
    const sockets: FakeSocket[] = [];
    const connector = new BinanceConnector({
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url, false);
        sockets.push(socket);
        return socket;
      },
      connectTimeoutMs: 10,
    });
    connectors.push(connector);

    const context: ConnectorContext = {
      signal: new AbortController().signal,
      emit: () => {},
      setStatus: () => {},
    };

    await expect(connector.connect(context)).rejects.toMatchObject({
      code: "upstream_error",
    });
    expect(sockets).toHaveLength(1);
  });
});

describe("subscriptions", () => {
  test("flushes pre-connect subscriptions on open", async () => {
    const { connector, sockets, context } = setup();
    await connector.subscribe([
      { topic: "quote", symbol: "btcusdt" },
      { topic: "kline", symbol: "BTCUSDT", interval: "1m" },
    ]);
    await connector.connect(context);
    await tick();

    expect(sockets[0]?.controls()).toEqual([
      { method: "SUBSCRIBE", params: ["btcusdt@bookTicker", "btcusdt@kline_1m"], id: 1 },
    ]);
  });

  test("sends SUBSCRIBE and UNSUBSCRIBE dynamically", async () => {
    const { connector, sockets, context } = setup();
    await connector.connect(context);

    await connector.subscribe([
      { topic: "funding", symbol: "BTCUSDT" },
      { topic: "liquidation", symbol: "ETHUSDT" },
    ]);
    await connector.unsubscribe([{ topic: "funding", symbol: "BTCUSDT" }]);

    expect(sockets[0]?.controls()).toEqual([
      {
        method: "SUBSCRIBE",
        params: ["btcusdt@markPrice@1s", "ethusdt@forceOrder"],
        id: 1,
      },
      { method: "UNSUBSCRIBE", params: ["btcusdt@markPrice@1s"], id: 2 },
    ]);
  });

  test("does not duplicate stream subscriptions", async () => {
    const { connector, sockets, context } = setup();
    await connector.connect(context);

    await connector.subscribe([{ topic: "quote", symbol: "BTCUSDT" }]);
    await connector.subscribe([{ topic: "quote", symbol: "BTCUSDT" }]);

    expect(sockets[0]?.controls()).toHaveLength(1);
  });

  test("rejects funding on spot", async () => {
    const { connector, context } = setup({ market: "spot" });
    await connector.connect(context);

    await expect(
      connector.subscribe([{ topic: "funding", symbol: "BTCUSDT" }]),
    ).rejects.toMatchObject({ code: "unsupported_topic" });
  });
});

describe("message normalization", () => {
  test("normalizes bookTicker without an event type", () => {
    const event = normalizeBinanceMessage(
      { s: "BTCUSDT", b: "100.1", B: "2", a: "100.2", A: "3" },
      "BINANCE",
      1_700_000_000_000,
    );
    expect(event).toMatchObject({
      type: "quote",
      symbol: "BTCUSDT",
      bid: 100.1,
      ask: 100.2,
      bidSize: 2,
      askSize: 3,
      ts: 1_700_000_000_000,
    });
  });

  test("normalizes a kline", () => {
    const event = normalizeBinanceMessage({
      e: "kline",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      k: {
        t: 1_699_999_940_000,
        T: 1_700_000_039_999,
        i: "1m",
        o: "100",
        h: "110",
        l: "90",
        c: "105",
        v: "12.5",
        x: false,
      },
    });
    expect(event).toMatchObject({
      type: "kline",
      symbol: "BTCUSDT",
      interval: "1m",
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 12.5,
      closed: false,
    });
  });

  test("normalizes funding", () => {
    const event = normalizeBinanceMessage({
      e: "markPriceUpdate",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      p: "65000",
      r: "0.0001",
      T: 1_700_028_800_000,
    });
    expect(event).toMatchObject({
      type: "funding",
      symbol: "BTCUSDT",
      fundingRate: 0.0001,
      markPrice: 65_000,
      nextFundingTime: 1_700_028_800_000,
    });
  });

  test("maps a SELL force order to a long liquidation", () => {
    const event = normalizeBinanceMessage({
      e: "forceOrder",
      E: 1_700_000_000_000,
      o: { s: "BTCUSDT", S: "SELL", q: "2", p: "100", ap: "101", T: 1_699_999_999_000 },
    });
    expect(event).toMatchObject({
      type: "liquidation",
      side: "long",
      price: 101,
      quantity: 2,
      usd: 202,
    });
  });

  test("unwraps combined streams", () => {
    const event = normalizeBinanceMessage({
      stream: "btcusdt@bookTicker",
      data: { s: "BTCUSDT", b: "1", a: "2" },
    });
    expect(event).toMatchObject({ type: "quote", symbol: "BTCUSDT" });
  });

  test("ignores unknown payloads", () => {
    expect(normalizeBinanceMessage({ e: "aggTrade", s: "BTCUSDT" })).toBeNull();
    expect(normalizeBinanceMessage("nope")).toBeNull();
  });

  test("dispatches socket messages", async () => {
    const { connector, sockets, events, context } = setup();
    await connector.connect(context);

    sockets[0]?.emit("message", {
      data: JSON.stringify({ s: "BTCUSDT", b: "10", a: "11" }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "quote", symbol: "BTCUSDT" });
  });
});

describe("reconnect", () => {
  test("reopens the socket and restores subscriptions", async () => {
    const { connector, sockets, statuses, context } = setup();
    await connector.subscribe([{ topic: "quote", symbol: "BTCUSDT" }]);
    await connector.connect(context);
    expect(sockets).toHaveLength(1);

    sockets[0]?.close();
    await tick(30);

    expect(sockets).toHaveLength(2);
    expect(statuses).toContain("reconnecting");
    expect(sockets[1]?.controls()).toEqual([
      { method: "SUBSCRIBE", params: ["btcusdt@bookTicker"], id: 1 },
    ]);
  });

  test("stops reconnecting after disconnect", async () => {
    const { connector, sockets, context, statuses } = setup();
    await connector.connect(context);
    await connector.disconnect();

    sockets[0]?.close();
    await tick(20);

    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe("closed");
  });
});
