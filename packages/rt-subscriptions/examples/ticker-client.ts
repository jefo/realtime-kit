import { SubscriptionsClient } from "../src/index";

const client = new SubscriptionsClient({
  url: process.env.GATEWAY_URL ?? "http://127.0.0.1:8787",
});

client.onState((state, error) => {
  console.log(`[state] ${state}${error ? ` (${error.message})` : ""}`);
});

client.onAny((event) => {
  console.log(`[${event.topic}] ${event.key} ->`, event.data);
});

await client.subscribe([
  { topic: "ticker", params: { symbol: "BTCUSDT" } },
  { topic: "ticker", params: { symbol: "ETHUSDT" } },
]);

console.log(`subscribed: ${client.id}`);

process.on("SIGINT", () => {
  client.close();
  process.exit(0);
});
