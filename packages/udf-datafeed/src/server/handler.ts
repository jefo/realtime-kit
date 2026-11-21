import { ProviderError, UdfTimeoutError } from "../core/errors";
import { assertResolution, resolutionSeconds } from "../core/resolution";
import { normalizeBars, toHistoryResponse } from "../protocol/normalize";
import type {
  Awaitable,
  DataProvider,
  HistoryRequest,
  ProviderContext,
  SearchItem,
  SearchRequest,
  SymbolInfo,
  UdfConfig,
} from "../protocol/types";

export interface UdfHandlerOptions {
  /** Prefix for all routes, e.g. `/udf`. Default: none. */
  basePath?: string;
  /** CORS origin. `true` means `*`, a string is used as-is, `false` disables it. */
  cors?: boolean | string;
  /** Per-request provider timeout. Default: 15000 ms. */
  timeoutMs?: number;
  /** Hard cap of bars per history response. Default: 50000. */
  maxBars?: number;
  /** Old UDF returns a bare array; newer clients accept `{ symbols }`. */
  searchShape?: "array" | "object";
  now?: () => number;
  onError?: (error: unknown, context: string) => void;
}

const DEFAULT_RESOLUTIONS = ["1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W", "1M"];

export function createUdfHandler(
  provider: DataProvider,
  options: UdfHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const base = normalizeBase(options.basePath);
  const headers = corsHeaders(options.cors);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBars = options.maxBars ?? 50_000;
  const searchShape = options.searchShape ?? "array";
  const now = options.now ?? Date.now;
  const logError =
    options.onError ??
    ((error, context) => {
      console.error(`[rtkit/udf-datafeed] ${context}`, error);
    });

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      return json({ s: "error", errmsg: "not_found" }, 404, headers);
    }

    const path = base ? url.pathname.slice(base.length) || "/" : url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return json({ s: "error", errmsg: "method_not_allowed" }, 405, headers);
    }

    const controller = new AbortController();
    if (request.signal.aborted) controller.abort();
    const onAbort = () => controller.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    const context: ProviderContext = { signal: controller.signal };

    const call = <T>(fn: () => Awaitable<T>): Promise<T> =>
      withTimeout(Promise.resolve().then(fn), timeoutMs, controller);

    try {
      if (path === "/config") {
        const custom = provider.getConfig ? await call(() => provider.getConfig!(context)) : {};
        const config: UdfConfig = {
          supports_search: Boolean(provider.searchSymbols),
          supports_group_request: false,
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: true,
          supported_resolutions: DEFAULT_RESOLUTIONS,
          ...custom,
        };
        config.supports_search = Boolean(provider.searchSymbols) && (custom.supports_search ?? true);
        return json(config, 200, headers);
      }

      if (path === "/time") {
        const seconds = provider.getServerTime
          ? await call(() => provider.getServerTime!(context))
          : now() / 1000;
        return text(String(Math.floor(seconds)), headers);
      }

      if (path === "/symbols") {
        const symbol = required(url.searchParams, "symbol");
        const info = await call(() => provider.resolveSymbol(symbol, context));
        if (!info) return json({ s: "error", errmsg: "unknown_symbol" }, 404, headers);
        return json({ ...info, name: info.name || symbol }, 200, headers);
      }

      if (path === "/history") {
        const symbol = required(url.searchParams, "symbol");
        const resolution = assertResolution(required(url.searchParams, "resolution"));
        const to = intParam(url.searchParams, "to") ?? Math.floor(now() / 1000);
        const from = intParam(url.searchParams, "from") ?? to - resolutionSeconds(resolution) * 300;
        const countback = intParam(url.searchParams, "countback");

        if (from < 0 || to <= 0 || from > to) {
          throw new ProviderError("invalid_request", "`from` and `to` must satisfy 0 <= from <= to.", 400);
        }

        const requestBody: HistoryRequest = { symbol, resolution, from, to };
        if (countback !== undefined && countback > 0) requestBody.countback = countback;

        const result = await call(() => provider.getBars(requestBody, context));
        const parsed = Array.isArray(result) ? { bars: result } : result;

        if (parsed.noData || parsed.bars.length === 0) {
          return json(
            parsed.nextTime === undefined
              ? { s: "no_data" }
              : { s: "no_data", nextTime: parsed.nextTime },
            200,
            headers,
          );
        }

        const bars = normalizeBars(parsed.bars, maxBars).filter(
          (bar) => bar.time >= from && bar.time <= to,
        );

        if (bars.length === 0) {
          return json(
            parsed.nextTime === undefined
              ? { s: "no_data" }
              : { s: "no_data", nextTime: parsed.nextTime },
            200,
            headers,
          );
        }

        return json(toHistoryResponse(bars, parsed.nextTime), 200, headers);
      }

      if (path === "/search") {
        const query = url.searchParams.get("query") ?? "";
        const type = url.searchParams.get("type") || undefined;
        const exchange = url.searchParams.get("exchange") || undefined;
        const limit = clamp(intParam(url.searchParams, "limit") ?? 20, 1, 100);

        const requestBody: SearchRequest = { query, limit };
        if (type !== undefined) requestBody.type = type;
        if (exchange !== undefined) requestBody.exchange = exchange;

        const found = provider.searchSymbols
          ? await call(() => provider.searchSymbols!(requestBody, context))
          : [];

        const items = found.slice(0, limit).map(toSearchItem);
        return json(searchShape === "object" ? { symbols: items } : items, 200, headers);
      }

      if (path === "/quotes") {
        const symbols = parseSymbols(url.searchParams.get("symbols"));
        if (symbols.length === 0) {
          throw new ProviderError("invalid_request", "`symbols` is required.", 400);
        }
        if (!provider.getQuotes) {
          return json({ s: "error", errmsg: "quotes_not_supported" }, 200, headers);
        }
        const quotes = await call(() => provider.getQuotes!(symbols, context));
        return json({ s: "ok", d: quotes }, 200, headers);
      }

      if (path === "/health") {
        return json(
          {
            ok: true,
            provider: provider.name ?? "custom",
            time: Math.floor(now() / 1000),
            maxBars,
          },
          200,
          headers,
        );
      }

      return json({ s: "error", errmsg: "not_found" }, 404, headers);
    } catch (error) {
      if (error instanceof ProviderError) {
        return json(
          { s: "error", errmsg: error.code, message: error.message },
          error.status,
          headers,
        );
      }
      if (error instanceof UdfTimeoutError) {
        return json({ s: "error", errmsg: "timeout", message: error.message }, 504, headers);
      }
      logError(error, `request failed: ${path}`);
      return json({ s: "error", errmsg: "internal_error" }, 502, headers);
    } finally {
      request.signal.removeEventListener("abort", onAbort);
    }
  };
}

function toSearchItem(info: SymbolInfo): SearchItem {
  const ticker = String(info.ticker ?? info.name);
  const exchange = String(info.exchange ?? info.listed_exchange ?? "");
  return {
    symbol: ticker,
    full_name: exchange ? `${exchange}:${info.name}` : info.name,
    description: String(info.description ?? info.name),
    exchange,
    ticker,
    type: String(info.type ?? ""),
  };
}

function parseSymbols(raw: string | null): string[] {
  if (!raw) return [];
  const value = raw.trim();
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to comma parsing.
    }
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new UdfTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) throw new ProviderError("invalid_request", `\`${name}\` is required.`, 400);
  return value;
}

function intParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ProviderError("invalid_request", `\`${name}\` must be a number.`, 400);
  }
  return Math.trunc(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeBase(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  const withSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withSlash.replace(/\/+$/, "");
}

function corsHeaders(origin: boolean | string | undefined): Record<string, string> {
  if (origin === false) return {};
  const value = origin === undefined || origin === true ? "*" : origin;
  return {
    "access-control-allow-origin": value,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
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

function text(data: string, headers: Record<string, string>): Response {
  return new Response(data, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
