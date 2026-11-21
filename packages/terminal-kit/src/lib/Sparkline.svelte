<script lang="ts">
  interface Props {
    values: number[];
    width?: number;
    height?: number;
    stroke?: string;
    fill?: string;
    area?: boolean;
    min?: number;
    max?: number;
    label?: string;
  }

  let {
    values,
    width = 160,
    height = 40,
    stroke = "var(--rtk-accent, #d4af37)",
    fill,
    area = true,
    min,
    max,
    label = "sparkline",
  }: Props = $props();

  const geometry = $derived.by(() => {
    if (values.length === 0) return { line: "", area: "", empty: true };

    let lo = min ?? Number.POSITIVE_INFINITY;
    let hi = max ?? Number.NEGATIVE_INFINITY;
    if (min === undefined || max === undefined) {
      for (const value of values) {
        if (!Number.isFinite(value)) continue;
        if (min === undefined && value < lo) lo = value;
        if (max === undefined && value > hi) hi = value;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (hi === lo) {
      hi = lo + 1;
    }

    const span = hi - lo;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const points = values.map((value, index) => {
      const safe = Number.isFinite(value) ? value : lo;
      const x = index * step;
      const y = height - ((safe - lo) / span) * height;
      return [x, y] as const;
    });

    const line = points
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    const areaPath = `${line} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`;

    return { line, area: areaPath, empty: false };
  });
</script>

{#if geometry.empty}
  <svg
    class="rtk-sparkline"
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={`${label}: no data`}
    preserveAspectRatio="none"
    style:height={`${height}px`}
  >
    <line
      x1="0"
      y1={height / 2}
      x2={width}
      y2={height / 2}
      stroke="var(--rtk-border-strong, #313c4a)"
      stroke-width="1"
      stroke-dasharray="3 3"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{:else}
  <svg
    class="rtk-sparkline"
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={label}
    preserveAspectRatio="none"
    style:height={`${height}px`}
  >
    {#if area}
      <path d={geometry.area} fill={fill ?? stroke} fill-opacity="0.12" stroke="none" />
    {/if}
    <path
      d={geometry.line}
      fill="none"
      stroke={stroke}
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}

<style>
  .rtk-sparkline {
    display: block;
    width: 100%;
    overflow: visible;
  }
</style>
