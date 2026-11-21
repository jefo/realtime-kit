<script lang="ts">
  import { onMount } from "svelte";
  import {
    ConnectionBadge,
    DataTable,
    Metric,
    OrderBook,
    Sparkline,
    ThemeProvider,
    formatCompact,
    formatPercent,
    formatPrice,
    formatTime,
    type Column,
  } from "@rtkit/terminal-kit";
  import {
    createMarkets,
    makeBook,
    makeSeries,
    nextMarkets,
    tickSizeFor,
    type Market,
  } from "./mock";

  let theme = $state<"dark" | "light">("dark");

  const seed = createMarkets();
  const first = seed[0]!;

  let markets = $state<Market[]>(seed);
  let selected = $state(first.symbol);
  let series = $state<number[]>(makeSeries(first.price));
  let book = $state(makeBook(first.price, 12, tickSizeFor(first.price)));
  let latency = $state(12);
  let clock = $state(Date.now());

  const selectedMarket = $derived(
    markets.find((market) => market.symbol === selected) ?? markets[0]!,
  );
  const totalVolume = $derived(markets.reduce((sum, market) => sum + market.volume, 0));
  const totalOpenInterest = $derived(
    markets.reduce((sum, market) => sum + market.openInterest, 0),
  );
  const high = $derived(Math.max(...series));
  const low = $derived(Math.min(...series));

  const columns: Column<Market>[] = [
    {
      key: "symbol",
      header: "Market",
      value: (market) => market.symbol,
      format: (_value, market) => market.base,
    },
    {
      key: "price",
      header: "Last",
      align: "right",
      value: (market) => market.price,
      format: (value, market) => formatPrice(Number(value), market.decimals),
    },
    {
      key: "change",
      header: "24h",
      align: "right",
      value: (market) => market.change,
      format: (value) => formatPercent(Number(value)),
      cellClass: (value) => (Number(value) >= 0 ? "up" : "down"),
    },
    {
      key: "funding",
      header: "Funding",
      align: "right",
      value: (market) => market.funding,
      format: (value) => formatPercent(Number(value), 4),
    },
    {
      key: "volume",
      header: "Volume",
      align: "right",
      value: (market) => market.volume,
      format: (value) => formatCompact(Number(value)),
    },
    {
      key: "openInterest",
      header: "OI",
      align: "right",
      value: (market) => market.openInterest,
      format: (value) => formatCompact(Number(value)),
    },
  ];

  function select(symbol: string): void {
    selected = symbol;
    const market = markets.find((item) => item.symbol === symbol);
    if (!market) return;
    series = makeSeries(market.price);
    book = makeBook(market.price, 12, tickSizeFor(market.price));
  }

  function toggleTheme(): void {
    theme = theme === "dark" ? "light" : "dark";
  }

  onMount(() => {
    const timer = setInterval(() => {
      markets = nextMarkets(markets);
      const market = markets.find((item) => item.symbol === selected) ?? markets[0]!;
      series = [...series.slice(1), market.price];
      book = makeBook(market.price, 12, tickSizeFor(market.price));
      latency = 8 + Math.round(Math.random() * 18);
      clock = Date.now();
    }, 900);

    return () => clearInterval(timer);
  });
</script>

<ThemeProvider {theme}>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">RTK</span>
        <span class="brand-name">terminal</span>
      </div>
      <div class="topbar-right">
        <ConnectionBadge status="live" latencyMs={latency} />
        <button class="theme-toggle" type="button" onclick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>

    <section class="metrics" aria-label="Market metrics">
      <Metric
        label={`${selectedMarket.base} / USDT`}
        value={selectedMarket.price}
        decimals={selectedMarket.decimals}
        delta={selectedMarket.change}
        hint="perpetual"
      />
      <Metric
        label="24h volume"
        value={`$${formatCompact(totalVolume)}`}
        hint="all markets"
      />
      <Metric
        label="Open interest"
        value={`$${formatCompact(totalOpenInterest)}`}
        hint="all markets"
      />
      <Metric
        label="Funding / 8h"
        value={formatPercent(selectedMarket.funding, 4)}
        trend={selectedMarket.funding >= 0 ? "up" : "down"}
        hint="next in 3h 12m"
      />
    </section>

    <main class="grid">
      <section class="card chart-card">
        <div class="card-head">
          <div>
            <strong>{selectedMarket.symbol}</strong>
            <span class="muted"> · 1m</span>
          </div>
          <span class="muted">{formatTime(clock, { seconds: true })} UTC</span>
        </div>
        <Sparkline
          values={series}
          height={132}
          stroke={selectedMarket.change >= 0 ? "var(--rtk-up)" : "var(--rtk-down)"}
          label={`${selectedMarket.base} price`}
        />
        <div class="chart-foot">
          <span class="muted">high {formatPrice(high, selectedMarket.decimals)}</span>
          <span class="muted">low {formatPrice(low, selectedMarket.decimals)}</span>
          <span class="muted">ticks {series.length}</span>
        </div>
      </section>

      <div class="book-slot">
        <OrderBook
          bids={book.bids}
          asks={book.asks}
          title={`${selectedMarket.base} book`}
          priceDecimals={selectedMarket.decimals}
          tickSize={tickSizeFor(selectedMarket.price)}
          maxRows={12}
        />
      </div>

      <section class="card table-card">
        <div class="card-head">
          <div>
            <strong>Markets</strong>
            <span class="muted"> · {markets.length}</span>
          </div>
          <span class="muted">click a row to switch</span>
        </div>
        <DataTable
          rows={markets}
          {columns}
          rowKey={(row) => row.symbol}
          selectedKey={selected}
          onRowClick={(row) => select(row.symbol)}
          maxHeight="320px"
        />
      </section>
    </main>

    <footer class="footer">
      <span>@rtkit/terminal-kit · demo data</span>
      <span>no charting library · no CSS framework</span>
    </footer>
  </div>
</ThemeProvider>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    min-height: 100%;
    background: #0b0e11;
  }

  :global(#app) {
    min-height: 100vh;
  }

  .shell {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 16px;
    min-height: 100vh;
    box-sizing: border-box;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 2px 6px;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--rtk-mono);
  }

  .brand-mark {
    color: var(--rtk-accent);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  .brand-name {
    color: var(--rtk-muted);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .theme-toggle {
    padding: 6px 10px;
    border: 1px solid var(--rtk-border);
    border-radius: 999px;
    background: var(--rtk-panel);
    color: var(--rtk-muted);
    font: inherit;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .theme-toggle:hover {
    border-color: var(--rtk-border-strong);
    color: var(--rtk-text);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.65fr);
    grid-template-areas:
      "chart book"
      "table book";
    gap: 12px;
    align-items: start;
  }

  .book-slot {
    grid-area: book;
    min-width: 0;
  }

  .card {
    padding: 12px 14px;
    border: 1px solid var(--rtk-border);
    border-radius: var(--rtk-radius);
    background: var(--rtk-panel);
  }

  .chart-card {
    grid-area: chart;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .card-head strong {
    color: var(--rtk-text);
    font-family: var(--rtk-mono);
    font-size: 13px;
    letter-spacing: 0.02em;
  }

  .muted {
    color: var(--rtk-muted);
    font-size: 10px;
  }

  .chart-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-top: 2px;
    border-top: 1px solid var(--rtk-border);
  }

  .table-card {
    grid-area: table;
    padding-bottom: 0;
  }

  .table-card :global(.rtk-table-wrap) {
    border: 0;
    border-radius: 0;
  }

  .table-card :global(.rtk-table thead th:first-child),
  .table-card :global(.rtk-table tbody td:first-child) {
    padding-left: 0;
  }

  :global(.rtk-table td.up) {
    color: var(--rtk-up);
  }

  :global(.rtk-table td.down) {
    color: var(--rtk-down);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 2px 12px;
    color: var(--rtk-faint);
    font-size: 10px;
    letter-spacing: 0.04em;
  }

  @media (max-width: 900px) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .grid {
      grid-template-columns: 1fr;
      grid-template-areas:
        "chart"
        "book"
        "table";
    }

    .table-card {
      grid-column: auto;
    }

    .footer {
      flex-direction: column;
    }
  }
</style>
