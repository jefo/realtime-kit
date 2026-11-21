import type { Bar, HistoryOkResponse } from "../protocol/types";

/**
 * UDF requires ascending, unique timestamps in seconds. Providers are allowed
 * to return messy data; the server cleans it once.
 */
export function normalizeBars(input: Bar[], maxBars = 50_000): Bar[] {
  const byTime = new Map<number, Bar>();

  for (const bar of input) {
    if (!bar || typeof bar !== "object") continue;

    const time = Math.floor(Number(bar.time));
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);

    if (!Number.isFinite(time) || time <= 0) continue;
    if (![open, high, low, close].every(Number.isFinite)) continue;

    const normalized: Bar = { time, open, high, low, close };
    const volume = Number(bar.volume);
    if (Number.isFinite(volume)) normalized.volume = volume;

    // Last write wins for duplicate timestamps.
    byTime.set(time, normalized);
  }

  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  return sorted.length > maxBars ? sorted.slice(-maxBars) : sorted;
}

export function toHistoryResponse(bars: Bar[], nextTime?: number): HistoryOkResponse {
  const response: HistoryOkResponse = {
    s: "ok",
    t: bars.map((bar) => bar.time),
    o: bars.map((bar) => bar.open),
    h: bars.map((bar) => bar.high),
    l: bars.map((bar) => bar.low),
    c: bars.map((bar) => bar.close),
  };

  if (bars.some((bar) => bar.volume !== undefined)) {
    response.v = bars.map((bar) => bar.volume ?? 0);
  }

  if (nextTime !== undefined) {
    (response as HistoryOkResponse & { nextTime?: number }).nextTime = nextTime;
  }

  return response;
}
