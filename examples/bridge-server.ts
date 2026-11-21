import {
  BinanceConnector,
  MarketHub,
  type MarketSubscription,
  type MarketTopic,
} from "@rtkit/market-ingest";
import { createSubscriptionsHandler, SubscriptionGateway } from "@rtkit/subscriptions";

const hub = new MarketHub({
  connector: new BinanceConnector({ market: "futures" }),
  onError: (error, context) => console.error(`[hub] ${context}`, error),
});

const gateway = new SubscriptionGateway({
  sessionTtlMs: 30_000,
  onError: (error, context) => console.error(`[gateway] ${context}`, error),
});

function toMarket(topic: MarketTopic, params: Record<string, unknown>): MarketSubscription {
  const symbol = String(params.symbol ?? "");
  return topic === "kline"
    ? { topic, symbol, interval: String(params.interval ?? "") }
    : { topic, symbol };
}

for (const topic of ["quote", "kline", "funding", "liquidation"] as const) {
  gateway.registerTopic(topic, {
    onFirstSubscriber: (sub) => hub.subscribe(toMarket(topic, sub.params)),
    onLastSubscriber: (sub) => hub.unsubscribe(toMarket(topic, sub.params)),
  });
}

hub.onEvent((event) => {
  if (event.type === "kline") {
    gateway.publish("kline", { symbol: event.symbol, interval: event.interval }, event);
    return;
  }
  gateway.publish(event.type, { symbol: event.symbol }, event);
});

await hub.start();

const port = Number(process.env.PORT ?? 8790);
const server = Bun.serve({
  port,
  fetch: createSubscriptionsHandler(gateway, { basePath: "/rt", cors: true }),
});

console.log(`Bridge:  ${server.url}`);
console.log(`Health:  ${server.url}rt/health`);
console.log("");
console.log("Subscribe:");
console.log(
  `  curl -s -X POST ${server.url}rt/subscribe -H 'content-type: application/json' \\\n` +
    `    -d '{"subscriptions":[{"topic":"quote","params":{"symbol":"BTCUSDT"}}]}'`,
);
console.log("Then open /rt/events/<id> and watch live Binance events.");
console.log("Kline example: {\"topic\":\"kline\",\"params\":{\"symbol\":\"BTCUSDT\",\"interval\":\"1m\"}}");

async function shutdown(): Promise<void> {
  console.log("\nshutting down...");
  await hub.stop();
  await gateway.stop();
  await server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
