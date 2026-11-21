import { BinanceProvider, createUdfHandler } from "../src/index";

const provider = new BinanceProvider({
  // For USD-M futures: baseUrl: "https://fapi.binance.com"
  maxBars: 20_000,
});

const handler = createUdfHandler(provider, { basePath: "/udf", cors: true });
const chartPage = Bun.file(new URL("./chart.html", import.meta.url));

const port = Number(process.env.PORT ?? 8586);
const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(chartPage, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return handler(request);
  },
});

console.log(`Binance UDF demo: ${server.url}`);
console.log(`UDF endpoint:     ${server.url}udf`);
console.log("Public REST endpoints have rate limits; do not expose this directly to the internet.");
