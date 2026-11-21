import { createSubscriptionsHandler, SubscriptionGateway } from "../src/index";

const gateway = new SubscriptionGateway({
  sessionTtlMs: 30_000,
  onError: (error, context) => console.error(`[gateway] ${context}`, error),
});

const timers = new Map<string, ReturnType<typeof setInterval>>();

// The upstream only runs while somebody is subscribed to this exact key.
gateway.registerTopic("ticker", {
  onFirstSubscriber(sub) {
    const symbol = String(sub.params.symbol ?? "?");
    const timer = setInterval(() => {
      gateway.publish("ticker", { symbol }, {
        symbol,
        price: Number((100 + Math.random() * 10).toFixed(2)),
        ts: Date.now(),
      });
    }, 500);
    timers.set(sub.key, timer);
    console.log(`[upstream] start ${symbol}`);
  },
  onLastSubscriber(sub) {
    const timer = timers.get(sub.key);
    if (timer) clearInterval(timer);
    timers.delete(sub.key);
    console.log(`[upstream] stop ${sub.key}`);
  },
});

const port = Number(process.env.PORT ?? 8787);
const server = Bun.serve({
  port,
  fetch: createSubscriptionsHandler(gateway, { cors: true }),
});

console.log(`ticker gateway: ${server.url}`);
console.log("try: curl -s localhost:%d/health", port);

async function shutdown(): Promise<void> {
  console.log("\nshutting down...");
  for (const timer of timers.values()) clearInterval(timer);
  await gateway.stop();
  await server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
