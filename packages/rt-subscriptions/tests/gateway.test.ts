import { afterEach, describe, expect, test } from "bun:test";
import { GatewayError } from "../src/core/errors";
import { SessionStream, SubscriptionGateway } from "../src/core/gateway";
import type { EventEnvelope, GatewayOptions } from "../src/core/types";

const gateways: SubscriptionGateway[] = [];

function make(options: GatewayOptions = {}): SubscriptionGateway {
  const gateway = new SubscriptionGateway({ sessionTtlMs: 0, onError: () => {}, ...options });
  gateways.push(gateway);
  return gateway;
}

async function next(stream: SessionStream): Promise<EventEnvelope> {
  const result = await stream.next();
  if (result.done) throw new Error("stream ended unexpectedly");
  return result.value;
}

afterEach(async () => {
  for (const gateway of gateways.splice(0)) {
    await gateway.stop();
  }
});

describe("fan-out", () => {
  test("delivers the same event to two sessions", async () => {
    const gateway = make();
    const sub = { topic: "ticker", params: { symbol: "BTC" } };

    const a = await gateway.createSession([sub]);
    const b = await gateway.createSession([sub]);
    const streamA = gateway.open(a.id);
    const streamB = gateway.open(b.id);

    expect(gateway.publish("ticker", { symbol: "BTC" }, { price: 1 })).toBe(2);

    expect((await next(streamA)).data).toEqual({ price: 1 });
    expect((await next(streamB)).data).toEqual({ price: 1 });
  });

  test("does not leak events between different params", async () => {
    const gateway = make();
    const btc = await gateway.createSession([{ topic: "ticker", params: { symbol: "BTC" } }]);
    const eth = await gateway.createSession([{ topic: "ticker", params: { symbol: "ETH" } }]);
    const btcStream = gateway.open(btc.id);
    const ethStream = gateway.open(eth.id);

    gateway.publish("ticker", { symbol: "BTC" }, { price: 1 });

    expect((await next(btcStream)).data).toEqual({ price: 1 });
    expect(ethStream.dropped).toBe(0);
    expect(gateway.publish("ticker", { symbol: "XRP" }, { price: 2 })).toBe(0);
  });

  test("buffers events published before the stream is opened", async () => {
    const gateway = make();
    const session = await gateway.createSession([{ topic: "ticker" }]);

    gateway.publish("ticker", {}, { n: 1 });
    gateway.publish("ticker", {}, { n: 2 });

    const stream = gateway.open(session.id);
    expect((await next(stream)).data).toEqual({ n: 1 });
    expect((await next(stream)).data).toEqual({ n: 2 });
  });
});

describe("sessions", () => {
  test("deduplicates identical subscriptions", async () => {
    const gateway = make();
    const session = await gateway.createSession([
      { topic: "ticker", params: { symbol: "BTC" } },
      { topic: "ticker", params: { symbol: "BTC" } },
    ]);
    expect(session.subscriptions).toHaveLength(1);
  });

  test("enforces maxSubscriptionsPerSession", async () => {
    const gateway = make({ maxSubscriptionsPerSession: 1 });
    expect(
      gateway.createSession([
        { topic: "a" },
        { topic: "b" },
      ]),
    ).rejects.toMatchObject({ code: "TOO_MANY_SUBSCRIPTIONS" });
  });

  test("rejects empty subscription lists", async () => {
    const gateway = make();
    await expect(gateway.createSession([])).rejects.toBeInstanceOf(GatewayError);
  });

  test("returns an unknown session error", () => {
    const gateway = make();
    expect(() => gateway.open("missing")).toThrow(GatewayError);
  });

  test("re-attaching replaces the old reader", async () => {
    const gateway = make({ sessionTtlMs: 10_000 });
    const session = await gateway.createSession([{ topic: "ticker" }]);
    const first = gateway.open(session.id);
    const second = gateway.open(session.id);

    const ended = await first.next();
    expect(ended.done).toBe(true);

    gateway.publish("ticker", {}, { n: 1 });
    expect((await next(second)).data).toEqual({ n: 1 });
  });
});

describe("lifecycle hooks", () => {
  test("fires onFirstSubscriber and onLastSubscriber once", async () => {
    const gateway = make();
    const events: string[] = [];
    gateway.registerTopic("ticker", {
      onFirstSubscriber: (sub) => {
        events.push(`first:${sub.key}`);
      },
      onLastSubscriber: (sub) => {
        events.push(`last:${sub.key}`);
      },
    });

    const sub = { topic: "ticker", params: { symbol: "BTC" } };
    const a = await gateway.createSession([sub]);
    const b = await gateway.createSession([sub]);
    const streamA = gateway.open(a.id);
    gateway.open(b.id);

    await streamA.close();
    expect(events).toEqual(["first:ticker:{\"symbol\":\"BTC\"}"]);

    await gateway.closeSession(b.id);
    expect(events).toEqual(["first:ticker:{\"symbol\":\"BTC\"}", "last:ticker:{\"symbol\":\"BTC\"}"]);
  });

  test("rolls back subscriptions when onFirstSubscriber throws", async () => {
    const gateway = make();
    let last = 0;
    gateway.registerTopic("broken", {
      onFirstSubscriber: () => {
        throw new Error("upstream down");
      },
      onLastSubscriber: () => {
        last += 1;
      },
    });

    await expect(gateway.createSession([{ topic: "broken" }])).rejects.toMatchObject({
      code: "TOPIC_HOOK_FAILED",
    });
    expect(gateway.stats().subscriptions).toBe(0);
    expect(last).toBe(0);
  });

  test("serializes concurrent creates and retries a failed first hook", async () => {
    const gateway = make();
    let calls = 0;
    gateway.registerTopic("ticker", {
      onFirstSubscriber: async () => {
        calls += 1;
        if (calls === 1) throw new Error("upstream down");
      },
    });

    const first = gateway.createSession([{ topic: "ticker" }]);
    const second = gateway.createSession([{ topic: "ticker" }]);

    await expect(first).rejects.toMatchObject({ code: "TOPIC_HOOK_FAILED" });
    const session = await second;

    expect(calls).toBe(2);
    expect(gateway.stats().sessions).toBe(1);
    await gateway.closeSession(session.id);
  });

  test("fires onFirstSubscriber once for concurrent creates", async () => {
    const gateway = make();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gateway.registerTopic("ticker", {
      onFirstSubscriber: async () => {
        calls += 1;
        await gate;
      },
    });

    const first = gateway.createSession([{ topic: "ticker" }]);
    const second = gateway.createSession([{ topic: "ticker" }]);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(gateway.stats().sessions).toBe(2);

    await gateway.closeSession(a.id);
    await gateway.closeSession(b.id);
  });
});

describe("backpressure", () => {
  test("drops the oldest event when the queue is full", async () => {
    const gateway = make({ maxQueuePerSession: 2, overflow: "drop-oldest" });
    const session = await gateway.createSession([{ topic: "ticker" }]);
    const stream = gateway.open(session.id);

    for (let i = 1; i <= 5; i += 1) {
      gateway.publish("ticker", {}, { i });
    }

    expect(stream.dropped).toBe(3);
    expect((await next(stream)).data).toEqual({ i: 4 });
    expect((await next(stream)).data).toEqual({ i: 5 });
    expect(gateway.stats().dropped).toBe(3);
  });

  test("closes the session when overflow policy is disconnect", async () => {
    const gateway = make({ maxQueuePerSession: 1, overflow: "disconnect" });
    const session = await gateway.createSession([{ topic: "ticker" }]);
    const stream = gateway.open(session.id);

    gateway.publish("ticker", {}, { i: 1 });
    gateway.publish("ticker", {}, { i: 2 });

    expect((await next(stream)).data).toEqual({ i: 1 });
    expect((await stream.next()).done).toBe(true);
    expect(gateway.stats().sessions).toBe(0);
  });
});

describe("session expiry", () => {
  test("removes a detached session after the TTL", async () => {
    let clock = 1_000;
    const gateway = make({ sessionTtlMs: 100, now: () => clock });

    const session = await gateway.createSession([{ topic: "ticker" }]);
    const stream = gateway.open(session.id);
    await stream.close();

    expect(gateway.stats().sessions).toBe(1);
    clock += 101;
    expect(await gateway.sweep()).toBe(1);
    expect(gateway.stats().sessions).toBe(0);
  });

  test("closes immediately when TTL is zero", async () => {
    const gateway = make({ sessionTtlMs: 0 });
    const session = await gateway.createSession([{ topic: "ticker" }]);
    const stream = gateway.open(session.id);
    await stream.close();
    expect(gateway.stats().sessions).toBe(0);
  });
});

describe("stats", () => {
  test("counts sessions, subscriptions and published events", async () => {
    const gateway = make();
    const a = await gateway.createSession([{ topic: "ticker" }, { topic: "book" }]);
    gateway.open(a.id);
    gateway.publish("ticker", {}, { n: 1 });

    expect(gateway.stats()).toMatchObject({
      sessions: 1,
      attached: 1,
      subscriptions: 2,
      published: 1,
      dropped: 0,
    });
  });
});
