<script lang="ts">
  import { formatPercent, formatPrice, formatSize } from "./format";
  import {
    aggregateLevels,
    depthRatio,
    maxLevelSize,
    sortLevels,
    spread,
  } from "./orderbook";
  import type { OrderBookLevel } from "./types";

  interface Props {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    maxRows?: number;
    priceDecimals?: number;
    sizeDecimals?: number;
    /** Aggregate levels into buckets of this size. */
    tickSize?: number;
    showSpread?: boolean;
    title?: string;
  }

  let {
    bids,
    asks,
    maxRows = 12,
    priceDecimals = 2,
    sizeDecimals = 2,
    tickSize,
    showSpread = true,
    title = "Order book",
  }: Props = $props();

  const rowLimit = $derived(
    Number.isFinite(maxRows) && maxRows >= 1 ? Math.floor(maxRows) : 12,
  );

  const aggregated = $derived(
    tickSize && tickSize > 0
      ? {
          bids: aggregateLevels(bids, tickSize, "bid"),
          asks: aggregateLevels(asks, tickSize, "ask"),
        }
      : { bids, asks },
  );

  const book = $derived(sortLevels(aggregated.bids, aggregated.asks, rowLimit));
  const maxSize = $derived(maxLevelSize([...book.bids, ...book.asks]));
  const info = $derived(spread(book));
  const reversedAsks = $derived([...book.asks].reverse());
  const empty = $derived(book.bids.length === 0 && book.asks.length === 0);

  function depth(size: number): string {
    return `${(depthRatio(size, maxSize) * 100).toFixed(2)}%`;
  }
</script>

<section class="rtk-book" aria-label={title}>
  <header class="rtk-book-head">
    <span class="rtk-book-title">{title}</span>
    {#if showSpread}
      <span class="rtk-book-spread">
        {#if info.absolute === null}
          spread —
        {:else}
          spread {formatPrice(info.absolute, priceDecimals)}
          {#if info.percent !== null}
            <span class="rtk-book-spread-pct">{formatPercent(info.percent, 3, false)}</span>
          {/if}
        {/if}
      </span>
    {/if}
  </header>

  {#if empty}
    <div class="rtk-book-empty">No book</div>
  {:else}
    <table class="rtk-book-table" aria-label={`${title} levels`}>
      <thead>
        <tr>
          <th scope="col">price</th>
          <th scope="col">size</th>
        </tr>
      </thead>
      <tbody>
        {#each reversedAsks as level (level.price)}
          <tr class="ask" style:--rtk-depth={depth(level.size)}>
            <td class="rtk-book-price">
              <span class="rtk-book-depth" aria-hidden="true"></span>
              <span class="rtk-book-value">{formatPrice(level.price, priceDecimals)}</span>
            </td>
            <td class="rtk-book-size">{formatSize(level.size, sizeDecimals)}</td>
          </tr>
        {/each}

        {#if showSpread && info.absolute !== null}
          <tr class="rtk-book-mid">
            <td colspan="2">
              <div class="rtk-book-mid-row">
                <span>{formatPrice(info.mid ?? 0, priceDecimals)}</span>
                <span class="rtk-book-mid-label">mid</span>
              </div>
            </td>
          </tr>
        {/if}

        {#each book.bids as level (level.price)}
          <tr class="bid" style:--rtk-depth={depth(level.size)}>
            <td class="rtk-book-price">
              <span class="rtk-book-depth" aria-hidden="true"></span>
              <span class="rtk-book-value">{formatPrice(level.price, priceDecimals)}</span>
            </td>
            <td class="rtk-book-size">{formatSize(level.size, sizeDecimals)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .rtk-book {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--rtk-border, #232b35);
    border-radius: var(--rtk-radius, 10px);
    background: var(--rtk-panel, #11161c);
    font-variant-numeric: tabular-nums;
  }

  .rtk-book-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--rtk-border, #232b35);
    background: var(--rtk-panel-2, #161c24);
  }

  .rtk-book-title {
    color: var(--rtk-muted, #8b95a3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .rtk-book-spread {
    color: var(--rtk-faint, #7f8a99);
    font-size: 10px;
  }

  .rtk-book-spread-pct {
    color: var(--rtk-muted, #8b95a3);
  }

  .rtk-book-table {
    width: 100%;
    border-collapse: collapse;
  }

  .rtk-book-table th {
    padding: 6px 12px;
    color: var(--rtk-faint, #7f8a99);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-align: left;
    text-transform: uppercase;
  }

  .rtk-book-table th:last-child {
    text-align: right;
  }

  .rtk-book-table td {
    position: relative;
    padding: 3px 12px;
    border: 0;
  }

  .rtk-book-table tbody tr:hover {
    background: var(--rtk-hover, rgba(255, 255, 255, 0.035));
  }

  .rtk-book-price {
    font-family: var(--rtk-mono, monospace);
    font-size: 11px;
  }

  .rtk-book-value {
    position: relative;
    z-index: 1;
  }

  .rtk-book-depth {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 0;
    width: var(--rtk-depth, 0%);
    transition: width 160ms linear;
  }

  .rtk-book-table tr.ask .rtk-book-depth {
    background: var(--rtk-down-soft, rgba(248, 81, 73, 0.16));
  }

  .rtk-book-table tr.bid .rtk-book-depth {
    background: var(--rtk-up-soft, rgba(63, 185, 80, 0.16));
  }

  .rtk-book-table tr.ask .rtk-book-value {
    color: var(--rtk-down, #f85149);
  }

  .rtk-book-table tr.bid .rtk-book-value {
    color: var(--rtk-up, #3fb950);
  }

  .rtk-book-size {
    color: var(--rtk-muted, #8b95a3);
    font-family: var(--rtk-mono, monospace);
    font-size: 11px;
    text-align: right;
  }

  .rtk-book-mid td {
    padding: 7px 12px;
    border-block: 1px solid var(--rtk-border, #232b35);
    background: var(--rtk-panel-2, #161c24);
    color: var(--rtk-text, #e6e9ee);
    font-family: var(--rtk-mono, monospace);
    font-size: 13px;
    font-weight: 600;
  }

  .rtk-book-mid-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .rtk-book-mid-label {
    color: var(--rtk-faint, #7f8a99);
    font-family: var(--rtk-font, sans-serif);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .rtk-book-empty {
    padding: 28px 12px;
    color: var(--rtk-muted, #8b95a3);
    text-align: center;
  }
</style>
