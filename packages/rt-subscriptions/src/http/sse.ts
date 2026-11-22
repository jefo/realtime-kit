import type { SessionStream } from "../core/gateway";
import type { EventEnvelope } from "../core/types";

export interface SseOptions {
  /** Interval between `: heartbeat` comments. Default: 15000 ms. */
  heartbeatMs?: number;
  /** Reconnect delay hint sent to EventSource. Default: 3000 ms. */
  retryMs?: number;
  /** Extra response headers, e.g. CORS. */
  headers?: Record<string, string>;
}

export function formatSseEvent(envelope: EventEnvelope): string {
  const payload = JSON.stringify({
    key: envelope.key,
    topic: envelope.topic,
    data: envelope.data ?? null,
  });
  return `id: ${envelope.id}\nevent: ${envelope.topic}\ndata: ${payload}\n\n`;
}

/**
 * Wrap a session stream into a `text/event-stream` Response.
 *
 * Heartbeats are emitted while there are no events, so proxies do not kill an
 * idle connection. The reader is pull-based: a slow client blocks on the
 * session's bounded queue instead of buffering the whole process.
 */
export function createSseResponse(stream: SessionStream, options: SseOptions = {}): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = Math.max(1, options.heartbeatMs ?? 15_000);
  const retryMs = Math.max(0, options.retryMs ?? 3_000);

  let pending: Promise<IteratorResult<EventEnvelope>> | null = null;
  let finished = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));
    },

    async pull(controller) {
      if (finished) return;
      pending ??= stream.next();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = new Promise<"heartbeat">((resolve) => {
        timer = setTimeout(() => resolve("heartbeat"), heartbeatMs);
      });

      const outcome = await Promise.race([
        pending.then((result) => ({ kind: "event" as const, result })),
        heartbeat.then(() => ({ kind: "heartbeat" as const })),
      ]);

      if (timer !== undefined) clearTimeout(timer);
      if (finished) return;

      if (outcome.kind === "heartbeat") {
        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        return;
      }

      pending = null;
      if (outcome.result.done) {
        finished = true;
        controller.close();
        return;
      }

      try {
        controller.enqueue(encoder.encode(formatSseEvent(outcome.result.value)));
      } catch {
        finished = true;
        void stream.close();
      }
    },

    cancel() {
      finished = true;
      void stream.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...options.headers,
    },
  });
}
