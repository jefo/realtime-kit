import { ProviderError } from "../core/errors";
import { resolutionSeconds } from "../core/resolution";
import type {
  Bar,
  DataProvider,
  HistoryRequest,
  ProviderContext,
  Quote,
  SearchRequest,
  SymbolInfo,
  UdfConfig,
} from "../protocol/types";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BinanceProviderOptions {
  /** `https://api.binance.com` by default. Use `https://fapi.binance.com` for futures. */
  baseUrl?: string;
  fetch?: FetchLike;
  exchange?: string;
  /** Upper bound of bars per request. Default: 20000. */
  maxBars?: number;
  /** Binance klines page size, 1..1000. Default: 1000. */
  pageLimit?: number;
  symbolCacheTtlMs?: number;
  listCacheTtlMs?: number;
  now?: () => number;
}

interface BinanceFilter {
  filterType: string;
  tickSize?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: BinanceFilter[];
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbolInfo[];
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  prevClosePrice: string;
  volume: string;
  priceChange: string;
  priceChangePercent: string;
}

const INTERVALS: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1M",
};

const RESOLUTIONS = Object.keys(INTERVALS);

const QUOTE_ASSETS = [
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "DAI",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "TRY",
  "BRL",
  "ARS",
  "JPY",
  "GBP",
  "AUD",
].sort((a, b) => b.length - a.length);

/**
 * Public Binance REST adapter. No API key required.
 *
 * Covers spot by default. For USD-M futures pass
 * `baseUrl: "https://fapi.binance.com"` (endpoints and filters are compatible
 * enough for charts; check the exchange's current limits before production).
 */
export class BinanceProvider implements DataProvider {
  readonly name = "binance";

  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly exchange: string;
  private readonly maxBars: number;
  private readonly pageLimit: number;
  private readonly symbolTtl: number;
  private readonly listTtl: number;
  private readonly clock: () => number;

  private readonly symbolCache = new Map<
    string,
    { value: BinanceSymbolInfo | null; expires: number }
  >();
  private listCache: { value: BinanceSymbolInfo[]; expires: number } | null = null;

  constructor(options: BinanceProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.binance.com").replace(/\/+$/, "");
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.exchange = options.exchange ?? "BINANCE";
    this.maxBars = Math.max(1, options.maxBars ?? 20_000);
    this.pageLimit = Math.min(1_000, Math.max(1, options.pageLimit ?? 1_000));
    this.symbolTtl = options.symbolCacheTtlMs ?? 10 * 60_000;
    this.listTtl = options.listCacheTtlMs ?? 60 * 60_000;
    this.clock = options.now ?? (() => Date.now());
  }

  getConfig(): Partial<UdfConfig> {
    return {
      supported_resolutions: RESOLUTIONS,
      exchanges: [{ value: this.exchange, name: "Binance", desc: "Binance spot" }],
      symbols_types: [{ name: "Crypto", value: "crypto" }],
    };
  }

  async resolveSymbol(symbol: string, context: ProviderContext): Promise<SymbolInfo | null> {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return null;

    const info = await this.getSymbolInfo(upper, context);
    if (!info || info.status !== "TRADING") return null;
    return this.describe(info);
  }

  async getBars(request: HistoryRequest, context: ProviderContext): Promise<Bar[]> {
    const interval = INTERVALS[request.resolution];
    if (!interval) {
      throw new ProviderError(
        "unsupported_resolution",
        `Binance does not support resolution ${request.resolution}.`,
        400,
      );
    }

    const stepMs = resolutionSeconds(request.resolution) * 1_000;
    const endMs = request.to * 1_000;
    let cursor = request.from * 1_000;
    if (endMs - cursor > this.maxBars * stepMs) {
      cursor = endMs - this.maxBars * stepMs;
    }

    const symbol = request.symbol.trim().toUpperCase();
    const bars: Bar[] = [];

    while (cursor <= endMs && bars.length < this.maxBars) {
      const rows = await this.getJson<unknown[][]>(
        `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}` +
          `&startTime=${cursor}&endTime=${endMs}&limit=${this.pageLimit}`,
        context,
      );

      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const row of rows) {
        const bar = parseKline(row);
        if (!bar) continue;
        const ms = bar.time * 1_000;
        if (ms >= cursor && ms <= endMs) bars.push(bar);
      }

      const last = rows.at(-1);
      const lastCloseTime = Number(last?.[6]);
      if (!Number.isFinite(lastCloseTime) || lastCloseTime < cursor) break;
      cursor = lastCloseTime + 1;
      if (rows.length < this.pageLimit) break;
    }

    return bars;
  }

  async searchSymbols(request: SearchRequest, context: ProviderContext): Promise<SymbolInfo[]> {
    if (request.type && request.type.toLowerCase() !== "crypto") return [];
    if (request.exchange && request.exchange.toUpperCase() !== this.exchange) return [];

    const all = await this.getAllSymbols(context);
    const needle = request.query.trim().toUpperCase();
    const limit = request.limit ?? 20;

    return all
      .filter((item) => {
        if (!needle) return true;
        return item.symbol.includes(needle) || item.baseAsset.includes(needle);
      })
      .slice(0, limit)
      .map((item) => this.describe(item));
  }

  async getQuotes(symbols: string[], context: ProviderContext): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const query = encodeURIComponent(JSON.stringify(symbols.map((symbol) => symbol.toUpperCase())));
    const payload = await this.getJson<BinanceTicker[] | BinanceTicker>(
      `/api/v3/ticker/24hr?symbols=${query}`,
      context,
    );
    const rows = Array.isArray(payload) ? payload : [payload];

    return rows.map((row) => {
      const { base, quote } = splitSymbol(row.symbol);
      const last = number(row.lastPrice);
      return {
        n: row.symbol,
        s: "ok" as const,
        v: {
          ch: number(row.priceChange),
          chp: number(row.priceChangePercent),
          short_name: base,
          exchange: this.exchange,
          description: quote ? `${base}/${quote}` : base,
          lp: last,
          ask: number(row.askPrice) || last,
          bid: number(row.bidPrice) || last,
          open_price: number(row.openPrice),
          high_price: number(row.highPrice),
          low_price: number(row.lowPrice),
          prev_close_price: number(row.prevClosePrice),
          volume: number(row.volume),
        },
      };
    });
  }

  getServerTime(): number {
    return Math.floor(this.clock() / 1_000);
  }

  private async getSymbolInfo(
    symbol: string,
    context: ProviderContext,
  ): Promise<BinanceSymbolInfo | null> {
    const cached = this.symbolCache.get(symbol);
    if (cached && cached.expires > this.clock()) return cached.value;

    const payload = await this.getJson<BinanceExchangeInfo>(
      `/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
      context,
    );
    const found = payload.symbols?.[0] ?? null;
    this.symbolCache.set(symbol, {
      value: found,
      expires: this.clock() + this.symbolTtl,
    });
    return found;
  }

  private async getAllSymbols(context: ProviderContext): Promise<BinanceSymbolInfo[]> {
    if (this.listCache && this.listCache.expires > this.clock()) {
      return this.listCache.value;
    }

    const payload = await this.getJson<BinanceExchangeInfo>("/api/v3/exchangeInfo", context);
    const symbols = (payload.symbols ?? []).filter((item) => item.status === "TRADING");
    this.listCache = { value: symbols, expires: this.clock() + this.listTtl };
    return symbols;
  }

  private describe(info: BinanceSymbolInfo): SymbolInfo {
    const tickSize =
      info.filters.find((filter) => filter.filterType === "PRICE_FILTER")?.tickSize ?? "0.00000001";

    return {
      name: info.symbol,
      ticker: info.symbol,
      description: `${info.baseAsset}/${info.quoteAsset}`,
      type: "crypto",
      session: "24x7",
      exchange: this.exchange,
      listed_exchange: this.exchange,
      timezone: "Etc/UTC",
      currency_code: info.quoteAsset,
      minmov: 1,
      pricescale: pricescaleFromTick(tickSize),
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: true,
      has_empty_bars: false,
      supported_resolutions: RESOLUTIONS,
      volume_precision: 2,
      data_status: "streaming",
      format: "price",
    };
  }

  private async getJson<T>(path: string, context: ProviderContext): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      signal: context.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        "upstream_error",
        `Binance responded with HTTP ${response.status}: ${body.slice(0, 200)}`,
        502,
      );
    }

    return (await response.json()) as T;
  }
}

function parseKline(row: unknown[]): Bar | null {
  if (!Array.isArray(row) || row.length < 6) return null;

  const time = Math.floor(Number(row[0]) / 1_000);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);

  if (!Number.isFinite(time) || time <= 0) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;

  const bar: Bar = { time, open, high, low, close };
  if (Number.isFinite(volume)) bar.volume = volume;
  return bar;
}

export function pricescaleFromTick(tickSize: string): number {
  const dot = tickSize.indexOf(".");
  if (dot === -1) return 1;
  const decimals = tickSize.slice(dot + 1).replace(/0+$/, "").length;
  return 10 ** Math.min(decimals, 12);
}

export function splitSymbol(symbol: string): { base: string; quote: string } {
  for (const quote of QUOTE_ASSETS) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return { base: symbol.slice(0, -quote.length), quote };
    }
  }
  return { base: symbol, quote: "" };
}

function number(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
