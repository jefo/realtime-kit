import { afterEach, describe, expect, test } from "bun:test";
import { SubscriptionsClient } from "../src/client/client";
import { SseParser } from "../src/client/parser";
import { SubscriptionGateway } from "../src/core/gateway";
import { subscriptionKey } from "../src/core/canonical";
import type { ClientEnvelope } from "../src/client/client";
import { createSubscriptionsHandler } from "../src/http/handler";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function startServer(): { gateway: SubscriptionGateway; url: string } {
  const gateway = new SubscriptionGateway({ sessionTtlMs: 0, onError: () => {} });
  const server = Bun.serve({
    port: 0,
    fetch: createSubscriptionsHandler(gateway, { cors: true, heartbeatMs: 1_000 }),
  });
  const url = `http://127.0.0.1:${server.port}`;

  cleanups.push(async () => {
    await server.stop(true);
    await gateway.stop();
  });

  return { gateway, url };
}

function withTimeout<T>(promise: Promise<T>, ms = 2_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for an event.")), ms),
    ),
  ]);
}

describe("SseParser", () => {
  test("parses an event split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push("id: 7\nevent: tic")).toEqual([]);
    expect(parser.push('ker\ndata: {"a":1}\n\n')).toEqual([
      { id: "7", event: "ticker", data: '{"a":1}' },
    ]);
  });

  test("handles CRLF split between chunks", () => {
    const parser = new SseParser();
    expect(parser.push("id: 1\r")).toEqual([]);
    expect(parser.push("\ndata: hello\r\n\r\n")).toEqual([
      { id: "1", data: "hello" },
    ]);
  });

  test("joins multi-line data and ignores comments", () => {
    const parser = new SseParser();
    const events = parser.push(": heartbeat 1\n\nevent: x\ndata: a\ndata: b\n\n");
    expect(events).toEqual([{ event: "x", data: "a\nb" }]);
  });

  test("keeps an incomplete block", () => {
    const parser = new SseParser();
    expect(parser.push("event: x\ndata: partial")).toEqual([]);
    expect(parser.pending).toBe("event: x\ndata: partial");
  });
});

describe("SubscriptionsClient", () => {
  test("receives events for a matching subscription", async () => {
    const { gateway, url } = startServer();
    const client = new SubscriptionsClient({ url, reconnect: false });
    cleanups.push(() => client.close());

    const sub = { topic: "ticker", params: { symbol: "BTC" } };
    const received = new Promise<ClientEnvelope>((resolve) => client.on(sub, resolve));

    const info = await client.subscribe([sub]);
    expect(client.id).toBe(info.id);
    expect(client.state).toBe("open");

    gateway.publish("ticker", { symbol: "BTC" }, { price: 7 });

    const event = await withTimeout(received);
    expect(event.key).toBe(subscriptionKey("ticker", { symbol: "BTC" }));
    expect(event.topic).toBe("ticker");
    expect(event.data).toEqual({ price: 7 });
    expect(event.id).toBe(1);
  });

  test("passes every event to onAny", async () => {
    const { gateway, url } = startServer();
    const client = new SubscriptionsClient({ url, reconnect: false });
    cleanups.push(() => client.close());

    const seen: string[] = [];
    client.onAny((event) => seen.push(event.key));

    await client.subscribe([
      { topic: "a" },
      { topic: "b" },
    ]);

    gateway.publish("a", {}, { n: 1 });
    gateway.publish("b", {}, { n: 2 });

    await withTimeout(
      new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (seen.length === 2) {
            clearInterval(timer);
            resolve();
          }
        }, 10);
      }),
    );

    expect(seen).toEqual(["a:{}", "b:{}"]);
  });

  test("reports state transitions", async () => {
    const { url } = startServer();
    const client = new SubscriptionsClient({ url, reconnect: false });
    cleanups.push(() => client.close());

    const states: string[] = [];
    client.onState((state) => states.push(state));

    await client.subscribe([{ topic: "ticker" }]);
    client.close();

    expect(states).toEqual(["connecting", "open", "closed"]);
  });

  test("surfaces an HTTP error", async () => {
    const { url } = startServer();
    const client = new SubscriptionsClient({ url, reconnect: false });
    cleanups.push(() => client.close());

    await expect(client.subscribe([])).rejects.toThrow("At least one subscription");
  });
});
