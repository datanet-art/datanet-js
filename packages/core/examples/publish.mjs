/**
 * Publish messages to a DataNet channel from Node.js.
 *
 * Usage:
 *   DATANET_API_KEY=ak_... DATANET_CHANNEL=project.<pid>.demo node publish.mjs
 *
 * Optional env:
 *   DATANET_API_URL / DATANET_WS_URL  — point at a local gateway during development
 *   DATANET_COUNT / DATANET_INTERVAL_MS — how many messages, how fast
 */
import { DataNet } from "@datanet/core";

// Node 20/21 ship without a global WebSocket; Node 22+ has one built in.
if (!globalThis.WebSocket) {
  const { WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
}

const API_KEY = process.env.DATANET_API_KEY;
const CHANNEL = process.env.DATANET_CHANNEL;
if (!API_KEY || !CHANNEL) {
  console.error("Set DATANET_API_KEY and DATANET_CHANNEL (get a key at https://app.datanet.art)");
  process.exit(1);
}

const API_URL = process.env.DATANET_API_URL ?? "https://api.datanet.art";
const WS_URL = process.env.DATANET_WS_URL ?? "wss://ws.datanet.art";
const COUNT = Number.parseInt(process.env.DATANET_COUNT ?? "10", 10);
const INTERVAL_MS = Number.parseInt(process.env.DATANET_INTERVAL_MS ?? "1000", 10);

const client = new DataNet({ apiKey: API_KEY, apiUrl: API_URL, wsUrl: WS_URL });

client.on("connect", () => console.log(`[pub] connected to ${WS_URL}/ws`));
client.on("disconnect", () => console.log("[pub] disconnected"));
client.on("error", (error) => {
  console.error(`[pub] error: ${error instanceof Error ? error.message : String(error)}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await client.connect();
console.log(`[pub] publishing ${COUNT} message(s) to ${CHANNEL}`);

for (let i = 1; i <= COUNT; i += 1) {
  const payload = {
    index: i,
    source: "datanet-core-example",
    wave: Number((Math.sin(i / 2) * 0.5 + 0.5).toFixed(3)),
    sentAt: Date.now(),
  };
  client.publish(CHANNEL, payload);
  console.log(`[pub] sent ${i}/${COUNT}: ${JSON.stringify(payload)}`);
  if (i < COUNT) await sleep(INTERVAL_MS);
}

client.disconnect();
