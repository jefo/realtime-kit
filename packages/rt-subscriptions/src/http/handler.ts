import { GatewayError } from "../core/errors";
import type { SubscriptionGateway } from "../core/gateway";
import type { Subscription } from "../core/types";
import { createSseResponse } from "./sse";

export interface HandlerOptions {
  /** Prefix for all routes, e.g. `/rt`. Default: none. */
  basePath?: string;
  /**
   * CORS origin. `true` means `*`, a string is used as-is, `false` disables
   * CORS headers. Default: `*`.
   */
  cors?: boolean | string;
  heartbeatMs?: number;
  retryMs?: number;
  onError?: (error: unknown, context: string) => void;
}

const STATUS_BY_CODE: Record<string, number> = {
  UNKNOWN_SESSION: 404,
  TOO_MANY_SUBSCRIPTIONS: 422,
  TOPIC_HOOK_FAILED: 502,
};

function corsHeaders(origin: boolean | string | undefined): Record<string, string> {
  if (origin === false) return {};
  const value = origin === undefined || origin === true ? "*" : origin;
  return {
    "access-control-allow-origin": value,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, last-event-id",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function normalizeBase(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  const withSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withSlash.replace(/\/+$/, "");
}

/**
 * Create a framework-agnostic fetch handler:
 *
 *   POST   {base}/subscribe        { subscriptions: [...] } -> { id, subscriptions }
 *   GET    {base}/events/:id       text/event-stream
 *   DELETE {base}/sessions/:id     204
 *   GET    {base}/health           stats
 */
export function createSubscriptionsHandler(
  gateway: SubscriptionGateway,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const base = normalizeBase(options.basePath);
  const headers = corsHeaders(options.cors);
  const logError =
    options.onError ??
    ((error, context) => {
      console.error(`[rtkit/subscriptions] ${context}`, error);
    });

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404, headers);
    }

    const path = base ? url.pathname.slice(base.length) || "/" : url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (request.method === "POST" && path === "/subscribe") {
        const body = await readJson(request);
        const raw = Array.isArray(body)
          ? body
          : (body as { subscriptions?: unknown } | null)?.subscriptions;

        if (!Array.isArray(raw)) {
          throw new GatewayError(
            "INVALID_BODY",
            "Body must be an array or an object with a subscriptions array.",
          );
        }

        const info = await gateway.createSession(raw as Subscription[]);
        return json(info, 200, headers);
      }

      if (request.method === "GET" && path === "/health") {
        return json({ ok: !gateway.isStopped, ...gateway.stats() }, 200, headers);
      }

      const events = /^\/events\/([^/]+)\/?$/.exec(path);
      if (request.method === "GET" && events) {
        const id = decodeURIComponent(events[1] as string);
        const stream = gateway.open(id);
        const response = createSseResponse(stream, {
          heartbeatMs: options.heartbeatMs,
          retryMs: options.retryMs,
          headers,
        });

        const abort = () => {
          void stream.close();
        };
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });

        return response;
      }

      const sessions = /^\/sessions\/([^/]+)\/?$/.exec(path);
      if (request.method === "DELETE" && sessions) {
        const id = decodeURIComponent(sessions[1] as string);
        const closed = await gateway.closeSession(id, "client");
        return closed
          ? new Response(null, { status: 204, headers })
          : json({ error: { code: "UNKNOWN_SESSION", message: `Unknown session: ${id}` } }, 404, headers);
      }

      return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404, headers);
    } catch (error) {
      if (error instanceof GatewayError) {
        return json(
          { error: { code: error.code, message: error.message, details: error.details } },
          STATUS_BY_CODE[error.code] ?? 400,
          headers,
        );
      }
      logError(error, "request failed");
      return json({ error: { code: "INTERNAL", message: "Internal error" } }, 500, headers);
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new GatewayError("INVALID_BODY", "Body must be valid JSON.");
  }
}
