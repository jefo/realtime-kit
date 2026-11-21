import { createUdfHandler, MemoryProvider } from "../src/index";

const provider = new MemoryProvider();
const handler = createUdfHandler(provider, { basePath: "/udf", cors: true });
const chartPage = Bun.file(new URL("./chart.html", import.meta.url));

const port = Number(process.env.PORT ?? 8585);
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

console.log(`UDF demo:     ${server.url}`);
console.log(`UDF endpoint: ${server.url}udf`);
console.log(`history:      ${server.url}udf/history?symbol=BTCUSDT&resolution=60&from=1700000000&to=1700086400`);
