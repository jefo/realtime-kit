<script lang="ts">
  import { formatPercent } from "./format";

  interface Props {
    label: string;
    value: string | number;
    /** Percent change, e.g. `1.24` for +1.24%. */
    delta?: number;
    deltaLabel?: string;
    hint?: string;
    trend?: "up" | "down" | "flat";
    prefix?: string;
    suffix?: string;
    decimals?: number;
  }

  let {
    label,
    value,
    delta,
    deltaLabel,
    hint,
    trend,
    prefix = "",
    suffix = "",
    decimals = 2,
  }: Props = $props();

  const direction = $derived(
    trend ?? (delta === undefined || delta === 0 ? "flat" : delta > 0 ? "up" : "down"),
  );

  const displayValue = $derived(
    typeof value === "number"
      ? value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : value,
  );

  const deltaText = $derived(
    deltaLabel ?? (delta === undefined ? null : formatPercent(delta)),
  );
</script>

<div class="rtk-metric" data-trend={direction}>
  <span class="rtk-metric-label">{label}</span>
  <span class="rtk-metric-value">{prefix}{displayValue}{suffix}</span>
  {#if deltaText !== null}
    <span class="rtk-metric-delta">{deltaText}</span>
  {/if}
  {#if hint}
    <span class="rtk-metric-hint">{hint}</span>
  {/if}
</div>

<style>
  .rtk-metric {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--rtk-border, #232b35);
    border-radius: var(--rtk-radius, 10px);
    background: var(--rtk-panel, #11161c);
  }

  .rtk-metric-label {
    overflow: hidden;
    color: var(--rtk-muted, #8b95a3);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .rtk-metric-value {
    color: var(--rtk-text, #e6e9ee);
    font-family: var(--rtk-mono, monospace);
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .rtk-metric-delta {
    width: fit-content;
    padding: 1px 6px;
    border-radius: 999px;
    font-family: var(--rtk-mono, monospace);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .rtk-metric[data-trend="up"] .rtk-metric-delta {
    color: var(--rtk-up, #3fb950);
    background: var(--rtk-up-soft, rgba(63, 185, 80, 0.16));
  }

  .rtk-metric[data-trend="down"] .rtk-metric-delta {
    color: var(--rtk-down, #f85149);
    background: var(--rtk-down-soft, rgba(248, 81, 73, 0.16));
  }

  .rtk-metric[data-trend="flat"] .rtk-metric-delta {
    color: var(--rtk-muted, #8b95a3);
    background: var(--rtk-panel-3, #1c242e);
  }

  .rtk-metric-hint {
    overflow: hidden;
    color: var(--rtk-faint, #5c6675);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
