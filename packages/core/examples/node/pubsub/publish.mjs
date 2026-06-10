/**
 * Publish JSON messages to a DataNet channel from Node.js.
 *
 * Usage:
 *   cp .env.example .env
 *   node publish.mjs
 */
import "./env.mjs";
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
const DEVICE_ID = process.env.DATANET_DEVICE_ID ?? "node-publisher";
const CLIENT_ID = process.env.DATANET_CLIENT_ID ?? "datanet-core-example";
const COUNT = Number.parseInt(process.env.DATANET_COUNT ?? "10", 10);
const INTERVAL_MS = Number.parseInt(process.env.DATANET_INTERVAL_MS ?? "1000", 10);
const PUBLISH_SETTLE_MS = Number.parseInt(process.env.DATANET_PUBLISH_SETTLE_MS ?? "500", 10);

const client = new DataNet({
  apiKey: API_KEY,
  apiUrl: API_URL,
  wsUrl: WS_URL,
  deviceId: DEVICE_ID,
  clientId: CLIENT_ID,
});

client.on("connect", () => console.log(`[pub] connected to ${WS_URL}/ws as ${DEVICE_ID}`));
client.on("disconnect", () => console.log("[pub] disconnected"));
client.on("error", (error) => {
  const detail = error && typeof error === "object" && "code" in error
    ? ` code=${error.code}${"channel" in error && error.channel ? ` channel=${error.channel}` : ""}`
    : "";
  console.error(`[pub] error:${detail} ${error instanceof Error ? error.message : String(error)}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await client.connect();
console.log(`[pub] publishing ${COUNT} message(s) to ${CHANNEL} as ${DEVICE_ID}`);

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

if (PUBLISH_SETTLE_MS > 0) {
  await sleep(PUBLISH_SETTLE_MS);
}
client.disconnect();
