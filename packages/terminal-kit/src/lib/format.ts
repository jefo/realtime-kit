const compactFormatters = new Map<number, Intl.NumberFormat>();

function compactFormatter(decimals: number): Intl.NumberFormat {
  const cached = compactFormatters.get(decimals);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: decimals,
  });
  compactFormatters.set(decimals, formatter);
  return formatter;
}

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSize(value: number, decimals = 2): string {
  return formatPrice(value, decimals);
}

export function formatCompact(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) {
    return formatPrice(value, Math.abs(value) < 100 ? 2 : 0);
  }
  return compactFormatter(decimals).format(value);
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return integerFormatter.format(value);
}

export function formatPercent(value: number, digits = 2, signed = true): string {
  if (!Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

export interface TimeFormatOptions {
  seconds?: boolean;
  timeZone?: string;
}

export function formatTime(
  input: number | Date,
  options: TimeFormatOptions = {},
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: options.seconds ? "2-digit" : undefined,
    hour12: false,
    timeZone: options.timeZone ?? "UTC",
  }).format(date);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function formatDelta(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return `${arrow} ${formatPercent(value, digits)}`;
}
