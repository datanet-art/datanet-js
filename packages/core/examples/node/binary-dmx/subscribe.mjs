/**
 * Subscribe to a binary DMX channel from Node.js.
 *
 * Usage:
 *   cp .env.example .env
 *   node subscribe.mjs
 */
import "./env.mjs";
import { DataNet } from "@datanet/core";

if (!globalThis.WebSocket) {
  const { WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
}

const API_KEY = process.env.DATANET_API_KEY;
const CHANNEL = process.env.DATANET_BINARY_CHANNEL ?? process.env.DATANET_CHANNEL;
if (!API_KEY || !CHANNEL) {
  console.error("Set DATANET_API_KEY and DATANET_BINARY_CHANNEL");
  process.exit(1);
}

const client = new DataNet({
  apiKey: API_KEY,
  apiUrl: process.env.DATANET_API_URL ?? "https://api.datanet.art",
  wsUrl: process.env.DATANET_WS_URL ?? "wss://ws.datanet.art",
  deviceId: process.env.DATANET_DEVICE_ID ?? "node-dmx-subscriber",
  clientId: process.env.DATANET_CLIENT_ID ?? "datanet-core-example",
});

client.on("connect", () => {
  console.log(`[dmx sub] connected, listening on ${CHANNEL}`);
});
client.on("error", (error) => {
  console.error(`[dmx sub] error: ${error instanceof Error ? error.message : String(error)}`);
});

client.subscribeBinary(CHANNEL, (bytes, meta) => {
  const preview = Array.from(bytes.subarray(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(
    `[dmx sub] ${bytes.byteLength} bytes on ${meta.channel} ` +
    `ct=${meta.contentType} universe=${meta.metadata?.universe ?? "?"}: ${preview}`
  );
}, { contentType: "binary/dmx" });

process.on("SIGINT", () => {
  console.log("\n[dmx sub] shutting down");
  client.disconnect();
  process.exit(0);
});

await client.connect();
