import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "rtkit-consumer-"));

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

try {
  const tarballs = [];
  for (const pkg of ["rt-subscriptions", "udf-datafeed", "market-ingest", "terminal-kit"]) {
    const dir = join(root, "packages", pkg);
    const output = execFileSync("npm", ["pack", "--pack-destination", work], {
      cwd: dir,
      encoding: "utf8",
    });
    const filename = output.trim().split("\n").at(-1);
    if (!filename?.endsWith(".tgz")) {
      throw new Error(`npm pack did not return a tarball for ${pkg}: ${output}`);
    }
    tarballs.push(join(work, filename));
  }

  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "rtkit-consumer", private: true, type: "module" }, null, 2),
  );

  run(
    "npm",
    [
      "install",
      ...tarballs,
      "svelte@5.59.1",
      "vite@8.3.8",
      "@sveltejs/vite-plugin-svelte@7.3.1",
      "--no-audit",
      "--no-fund",
    ],
    work,
  );

  writeFileSync(
    join(work, "smoke.mjs"),
    `
import { SubscriptionGateway } from "@rtkit/subscriptions";
import { MemoryProvider } from "@rtkit/udf-datafeed";
import { MarketHub, MemoryEventCache } from "@rtkit/market-ingest";

const gateway = new SubscriptionGateway({ sessionTtlMs: 0 });
const session = await gateway.createSession([{ topic: "ticker", params: { symbol: "BTC" } }]);
const stream = gateway.open(session.id);
gateway.publish("ticker", { symbol: "BTC" }, { price: 42 });
const event = await stream.next();
if (event.value?.data?.price !== 42) throw new Error("subscriptions smoke failed");
await gateway.stop();

const provider = new MemoryProvider();
const info = provider.resolveSymbol("BTCUSDT", { signal: new AbortController().signal });
if (info?.name !== "BTCUSDT") throw new Error("udf smoke failed");

const cache = new MemoryEventCache();
await cache.set("quote:BTCUSDT", { type: "quote", exchange: "X", symbol: "BTCUSDT", bid: 1, ask: 2, ts: 1 });
if ((await cache.get("quote:BTCUSDT"))?.symbol !== "BTCUSDT") throw new Error("market cache smoke failed");

if (typeof MarketHub !== "function") throw new Error("market hub smoke failed");
console.log("node consumer smoke: ok");
`,
  );
  run("node", ["smoke.mjs"], work);

  mkdirSync(join(work, "src"));
  writeFileSync(
    join(work, "index.html"),
    '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
  );
  writeFileSync(
    join(work, "svelte.config.js"),
    'import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";\nexport default { preprocess: vitePreprocess() };\n',
  );
  writeFileSync(
    join(work, "vite.config.js"),
    'import { defineConfig } from "vite";\nimport { svelte } from "@sveltejs/vite-plugin-svelte";\nexport default defineConfig({ plugins: [svelte()] });\n',
  );
  writeFileSync(
    join(work, "src/main.js"),
    'import { mount } from "svelte";\nimport App from "./App.svelte";\nmount(App, { target: document.getElementById("app") });\n',
  );
  writeFileSync(
    join(work, "src/App.svelte"),
    `
<script>
  import { ThemeProvider, DataTable, OrderBook, Sparkline, Metric, ConnectionBadge, formatPrice } from "@rtkit/terminal-kit";
  const rows = [{ symbol: "BTC", price: 65000 }];
  const columns = [{ key: "symbol", header: "Market" }, { key: "price", header: "Last", align: "right", format: (v) => formatPrice(Number(v)) }];
  const bids = [{ price: 99, size: 1 }];
  const asks = [{ price: 101, size: 2 }];
</script>
<ThemeProvider theme="dark">
  <ConnectionBadge status="live" />
  <Metric label="BTC" value={65000} />
  <Sparkline values={[1, 2, 3]} />
  <OrderBook {bids} {asks} />
  <DataTable {rows} {columns} />
</ThemeProvider>
`,
  );

  run("npx", ["vite", "build"], work);
  console.log("consumer smoke: ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
