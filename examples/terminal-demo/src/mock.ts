import type { OrderBookLevel } from "@rtkit/terminal-kit";

export interface Market {
  symbol: string;
  base: string;
  price: number;
  change: number;
  funding: number;
  volume: number;
  openInterest: number;
  decimals: number;
}

const SEED: Array<[symbol: string, price: number, decimals: number, change: number]> = [
  ["BTCUSDT", 65_000, 2, 1.24],
  ["ETHUSDT", 3_200, 2, 0.82],
  ["SOLUSDT", 150, 2, -1.36],
  ["ARBUSDT", 1.2, 4, 2.18],
  ["DOGEUSDT", 0.12, 5, -0.74],
  ["LINKUSDT", 14.5, 3, 3.42],
  ["AVAXUSDT", 35, 3, -2.11],
  ["TONUSDT", 5.2, 4, 1.02],
];

export function createMarkets(): Market[] {
  return SEED.map(([symbol, price, decimals, change]) => ({
    symbol,
    base: symbol.replace(/USDT$/, ""),
    price,
    decimals,
    change,
    funding: (Math.random() - 0.5) * 0.02,
    volume: 120_000_000 + Math.random() * 880_000_000,
    openInterest: 20_000_000 + Math.random() * 180_000_000,
  }));
}

export function nextMarkets(markets: Market[]): Market[] {
  return markets.map((market) => {
    const drift = (Math.random() - 0.5) * 0.0022;
    const price = Math.max(0.0001, market.price * (1 + drift));
    return {
      ...market,
      price,
      change: clamp(market.change + drift * 120, -12, 12),
      funding: clamp(market.funding + (Math.random() - 0.5) * 0.0008, -0.05, 0.05),
      volume: market.volume * (1 + (Math.random() - 0.5) * 0.01),
      openInterest: market.openInterest * (1 + (Math.random() - 0.5) * 0.006),
    };
  });
}

export function makeSeries(price: number, points = 72): number[] {
  const values: number[] = [];
  let value = 1;
  for (let index = 0; index < points; index += 1) {
    value *= 1 + (Math.random() - 0.5) * 0.003;
    values.push(value);
  }

  // Scale the walk so the last point is exactly the current price.
  const factor = price / value;
  return values.map((point) => point * factor);
}

export function makeBook(
  mid: number,
  rows = 12,
  tickSize = tickSizeFor(mid),
): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
  const half = tickSize * 1.5;
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let index = 0; index < rows; index += 1) {
    const distance = half + index * tickSize;
    bids.push({
      price: round(mid - distance),
      size: round(0.4 + Math.random() * 8, 2),
    });
    asks.push({
      price: round(mid + distance),
      size: round(0.4 + Math.random() * 8, 2),
    });
  }

  return { bids, asks };
}

export function tickSizeFor(price: number): number {
  if (price >= 10_000) return 1;
  if (price >= 1_000) return 0.5;
  if (price >= 100) return 0.05;
  if (price >= 1) return 0.001;
  return 0.00001;
}

function round(value: number, decimals = 6): number {
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
