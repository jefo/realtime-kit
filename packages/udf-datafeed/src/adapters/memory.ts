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

export interface MemorySymbol {
  base: string;
  quote: string;
  /** Anchor price used by the deterministic bar generator. */
  price: number;
  /** 100 means two decimal places. */
  pricescale: number;
}

export interface MemoryProviderOptions {
  symbols?: Record<string, MemorySymbol>;
  exchange?: string;
  maxBars?: number;
  now?: () => number;
}

const DEFAULT_SYMBOLS: Record<string, MemorySymbol> = {
  BTCUSDT: { base: "BTC", quote: "USDT", price: 65_000, pricescale: 100 },
  ETHUSDT: { base: "ETH", quote: "USDT", price: 3_200, pricescale: 100 },
  SOLUSDT: { base: "SOL", quote: "USDT", price: 150, pricescale: 100 },
};

const RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W"];

/**
 * Deterministic in-memory provider. Useful for demos, tests and as a reference
 * implementation of the DataProvider contract.
 */
export class MemoryProvider implements DataProvider {
  readonly name = "memory";

  private readonly symbols: Record<string, MemorySymbol>;
  private readonly exchange: string;
  private readonly maxBars: number;
  private readonly clock: () => number;

  constructor(options: MemoryProviderOptions = {}) {
    this.symbols = options.symbols ?? DEFAULT_SYMBOLS;
    this.exchange = options.exchange ?? "MEMORY";
    this.maxBars = options.maxBars ?? 5_000;
    this.clock = options.now ?? (() => Date.now());
  }

  getConfig(): Partial<UdfConfig> {
    return {
      supported_resolutions: RESOLUTIONS,
      exchanges: [{ value: this.exchange, name: this.exchange, desc: "In-memory demo feed" }],
      symbols_types: [{ name: "Crypto", value: "crypto" }],
    };
  }

  resolveSymbol(symbol: string, _context: ProviderContext): SymbolInfo | null {
    const meta = this.symbols[symbol.toUpperCase()];
    if (!meta) return null;
    return this.describe(symbol.toUpperCase(), meta);
  }

  getBars(request: HistoryRequest, _context: ProviderContext): Bar[] {
    const symbol = request.symbol.toUpperCase();
    const meta = this.symbols[symbol];
    if (!meta) throw new ProviderError("unknown_symbol", `Unknown symbol: ${symbol}`, 404);

    const step = resolutionSeconds(request.resolution);
    const end = Math.floor(request.to / step) * step;
    const start = Math.ceil(request.from / step) * step;
    if (end < start) return [];

    const first = Math.max(start, end - (this.maxBars - 1) * step);
    const bars: Bar[] = [];
    for (let time = first; time <= end; time += step) {
      bars.push(this.barAt(symbol, meta, time));
    }
    return bars;
  }

  searchSymbols(request: SearchRequest, _context: ProviderContext): SymbolInfo[] {
    if (request.exchange && request.exchange !== this.exchange) return [];
    if (request.type && request.type !== "crypto") return [];

    const needle = request.query.trim().toUpperCase();
    return Object.entries(this.symbols)
      .filter(([symbol, meta]) => {
        if (!needle) return true;
        return symbol.includes(needle) || meta.base.includes(needle) || meta.quote.includes(needle);
      })
      .slice(0, request.limit ?? 20)
      .map(([symbol, meta]) => this.describe(symbol, meta));
  }

  getQuotes(symbols: string[], context: ProviderContext): Quote[] {
    const now = Math.floor(this.clock() / 1000);
    return symbols.map((input) => {
      const symbol = input.toUpperCase();
      const meta = this.symbols[symbol];
      if (!meta) throw new ProviderError("unknown_symbol", `Unknown symbol: ${symbol}`, 404);

      const day = this.getBars({ symbol, resolution: "60", from: now - 86_400, to: now }, context);
      const last = day.at(-1);
      const first = day[0];
      if (!last || !first) {
        return {
          n: symbol,
          s: "error" as const,
          v: {
            ch: 0,
            chp: 0,
            short_name: meta.base,
            exchange: this.exchange,
            description: `${meta.base}/${meta.quote}`,
            lp: meta.price,
            ask: meta.price,
            bid: meta.price,
            open_price: meta.price,
            high_price: meta.price,
            low_price: meta.price,
            prev_close_price: meta.price,
            volume: 0,
          },
        };
      }

      const change = last.close - first.open;
      return {
        n: symbol,
        s: "ok" as const,
        v: {
          ch: round(change, meta.pricescale),
          chp: first.open === 0 ? 0 : round((change / first.open) * 100, 100),
          short_name: meta.base,
          exchange: this.exchange,
          description: `${meta.base}/${meta.quote}`,
          lp: last.close,
          ask: round(last.close * 1.0001, meta.pricescale),
          bid: round(last.close * 0.9999, meta.pricescale),
          open_price: first.open,
          high_price: Math.max(...day.map((bar) => bar.high)),
          low_price: Math.min(...day.map((bar) => bar.low)),
          prev_close_price: first.open,
          volume: round(day.reduce((sum, bar) => sum + (bar.volume ?? 0), 0), 100),
        },
      };
    });
  }

  getServerTime(): number {
    return Math.floor(this.clock() / 1000);
  }

  private describe(symbol: string, meta: MemorySymbol): SymbolInfo {
    return {
      name: symbol,
      ticker: symbol,
      description: `${meta.base}/${meta.quote}`,
      type: "crypto",
      session: "24x7",
      exchange: this.exchange,
      listed_exchange: this.exchange,
      timezone: "Etc/UTC",
      currency_code: meta.quote,
      minmov: 1,
      pricescale: meta.pricescale,
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

  private barAt(symbol: string, meta: MemorySymbol, time: number): Bar {
    const seed = hash(`${symbol}:${time}`) | 1;
    const noise = (salt: number) => rand(seed ^ salt) - 0.5;
    const trend = Math.sin(time / 86_400) * 0.03;

    const open = meta.price * (1 + trend + noise(1) * 0.01);
    const close = meta.price * (1 + trend + noise(2) * 0.01);
    const high = Math.max(open, close) * (1 + Math.abs(noise(3)) * 0.004);
    const low = Math.min(open, close) * (1 - Math.abs(noise(4)) * 0.004);

    return {
      time,
      open: round(open, meta.pricescale),
      high: round(high, meta.pricescale),
      low: round(low, meta.pricescale),
      close: round(close, meta.pricescale),
      volume: round(100 + Math.abs(noise(5)) * 900, 100),
    };
  }
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function rand(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4_294_967_296;
}

function round(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}
