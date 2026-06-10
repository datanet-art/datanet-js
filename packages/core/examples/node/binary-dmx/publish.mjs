/**
 * Publish a binary DMX frame to DataNet from Node.js.
 *
 * Usage:
 *   cp .env.example .env
 *   node publish.mjs
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
  deviceId: process.env.DATANET_DEVICE_ID ?? "node-dmx-publisher",
  clientId: process.env.DATANET_CLIENT_ID ?? "datanet-core-example",
});

client.on("connect", () => console.log(`[dmx pub] connected, publishing to ${CHANNEL}`));
client.on("error", (error) => {
  console.error(`[dmx pub] error: ${error instanceof Error ? error.message : String(error)}`);
});

await client.connect();

const frame = DataNet.buildDmxFrame([
  255, // dimmer
  80,  // red
  20,  // green
  180, // blue
], 512);

client.publishBinary(CHANNEL, frame, {
  contentType: "binary/dmx",
  metadata: { universe: 1, format: "dmx512" },
});
console.log(`[dmx pub] sent ${frame.byteLength} bytes`);

setTimeout(() => client.disconnect(), 500);
