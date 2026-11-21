export type SupportedResolution = string;
export type Awaitable<T> = T | Promise<T>;

export interface UdfConfig {
  supports_search: boolean;
  supports_group_request: boolean;
  supports_marks: boolean;
  supports_timescale_marks: boolean;
  supports_time: boolean;
  supported_resolutions?: SupportedResolution[];
  exchanges?: Array<{ value: string; name: string; desc: string }>;
  symbols_types?: Array<{ name: string; value: string }>;
}

export interface SymbolInfo {
  name: string;
  ticker?: string;
  description?: string;
  type?: string;
  session?: string;
  exchange?: string;
  listed_exchange?: string;
  timezone?: string;
  currency_code?: string;
  minmov?: number;
  pricescale?: number;
  has_intraday?: boolean;
  has_daily?: boolean;
  has_weekly_and_monthly?: boolean;
  has_empty_bars?: boolean;
  supported_resolutions?: SupportedResolution[];
  volume_precision?: number;
  data_status?: "streaming" | "endofday" | "delayed_streaming" | "pulsed";
  format?: "price" | "volume";
  [key: string]: unknown;
}

export interface Bar {
  /** Unix timestamp in seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface BarsResult {
  bars: Bar[];
  nextTime?: number;
  noData?: boolean;
}

export interface HistoryRequest {
  symbol: string;
  resolution: SupportedResolution;
  /** Unix seconds, inclusive. */
  from: number;
  /** Unix seconds, inclusive. */
  to: number;
  countback?: number;
}

export interface SearchRequest {
  query: string;
  type?: string;
  exchange?: string;
  limit?: number;
}

export interface SearchItem {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: string;
}

export interface QuoteValue {
  ch: number;
  chp: number;
  short_name: string;
  exchange: string;
  description: string;
  lp: number;
  ask: number;
  bid: number;
  open_price: number;
  high_price: number;
  low_price: number;
  prev_close_price: number;
  volume: number;
}

export interface Quote {
  n: string;
  s: "ok" | "error";
  v: QuoteValue;
}

export interface HistoryOkResponse {
  s: "ok";
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v?: number[];
}

export interface HistoryNoDataResponse {
  s: "no_data";
  nextTime?: number;
}

export interface UdfErrorResponse {
  s: "error";
  errmsg: string;
}

export type HistoryResponse = HistoryOkResponse | HistoryNoDataResponse | UdfErrorResponse;

export interface QuotesResponse {
  s: "ok" | "error";
  d?: Quote[];
  errmsg?: string;
}

export interface ProviderContext {
  signal: AbortSignal;
}

export interface DataProvider {
  /** Used in health output. */
  readonly name?: string;
  getConfig?(context: ProviderContext): Awaitable<Partial<UdfConfig>>;
  resolveSymbol(symbol: string, context: ProviderContext): Awaitable<SymbolInfo | null>;
  getBars(request: HistoryRequest, context: ProviderContext): Awaitable<Bar[] | BarsResult>;
  searchSymbols?(request: SearchRequest, context: ProviderContext): Awaitable<SymbolInfo[]>;
  getQuotes?(symbols: string[], context: ProviderContext): Awaitable<Quote[]>;
  /** Unix seconds. Defaults to the handler clock. */
  getServerTime?(context: ProviderContext): Awaitable<number>;
}
