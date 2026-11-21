import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SubscriptionGateway } from "../src/core/gateway";
import { createSubscriptionsHandler } from "../src/http/handler";

let gateway: SubscriptionGateway;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  gateway = new SubscriptionGateway({ sessionTtlMs: 0, onError: () => {} });
  server = Bun.serve({
    port: 0,
    fetch: createSubscriptionsHandler(gateway, { cors: true, heartbeatMs: 1_000 }),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop(true);
  await gateway.stop();
});

async function subscribe(subs: unknown): Promise<Response> {
  return fetch(`${base}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscriptions: subs }),
  });
}

async function readDataEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for an SSE event.")), timeoutMs),
      ),
    ]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes("data:")) return text;
  }

  throw new Error(`No data event received. Got: ${JSON.stringify(text)}`);
}

describe("POST /subscribe", () => {
  test("creates a session", async () => {
    const response = await subscribe([{ topic: "ticker", params: { symbol: "BTC" } }]);
    expect(response.status).toBe(200);

    const info = (await response.json()) as { id: string; subscriptions: unknown[] };
    expect(typeof info.id).toBe("string");
    expect(info.subscriptions).toHaveLength(1);

    await fetch(`${base}/sessions/${info.id}`, { method: "DELETE" });
  });

  test("accepts a bare array", async () => {
    const response = await fetch(`${base}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ topic: "ticker" }]),
    });
    expect(response.status).toBe(200);

    const info = (await response.json()) as { id: string };
    await fetch(`${base}/sessions/${info.id}`, { method: "DELETE" });
  });

  test("rejects an invalid body", async () => {
    const response = await fetch(`${base}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  test("rejects a missing subscriptions array", async () => {
    const response = await fetch(`${base}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /events/:id", () => {
  test("streams a published event with topic and key", async () => {
    const response = await subscribe([{ topic: "ticker", params: { symbol: "BTC" } }]);
    const info = (await response.json()) as { id: string };

    const abort = new AbortController();
    const stream = await fetch(`${base}/events/${info.id}`, { signal: abort.signal });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.body).not.toBeNull();

    const reader = stream.body!.getReader();
    gateway.publish("ticker", { symbol: "BTC" }, { price: 42 });

    const text = await readDataEvent(reader);
    expect(text).toContain("event: ticker");
    expect(text).toContain('"price":42');
    expect(text).toContain('"key":"ticker:{');
    expect(text).toContain("id: 1");

    abort.abort();
    await reader.cancel().catch(() => undefined);
  });

  test("returns 404 for an unknown session", async () => {
    const response = await fetch(`${base}/events/does-not-exist`);
    expect(response.status).toBe(404);
  });
});

describe("DELETE /sessions/:id", () => {
  test("closes the session and ends the stream", async () => {
    const response = await subscribe([{ topic: "ticker" }]);
    const info = (await response.json()) as { id: string };

    const stream = await fetch(`${base}/events/${info.id}`);
    const reader = stream.body!.getReader();

    const deleted = await fetch(`${base}/sessions/${info.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);

    let ended = false;
    for (let i = 0; i < 5 && !ended; i += 1) {
      const chunk = await reader.read();
      ended = chunk.done;
    }
    expect(ended).toBe(true);

    const again = await fetch(`${base}/events/${info.id}`);
    expect(again.status).toBe(404);
  });

  test("returns 404 for an unknown session", async () => {
    const response = await fetch(`${base}/sessions/missing`, { method: "DELETE" });
    expect(response.status).toBe(404);
  });
});

describe("health and CORS", () => {
  test("reports stats", async () => {
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as { ok: boolean; sessions: number };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.sessions).toBe("number");
  });

  test("answers preflight", async () => {
    const response = await fetch(`${base}/subscribe`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
