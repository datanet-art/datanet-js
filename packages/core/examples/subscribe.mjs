/**
 * Subscribe to a DataNet channel from Node.js and print incoming messages.
 *
 * Usage:
 *   DATANET_API_KEY=ak_... DATANET_CHANNEL=project.<pid>.demo node subscribe.mjs
 *
 * Optional env:
 *   DATANET_API_URL / DATANET_WS_URL — point at a local gateway during development
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

const client = new DataNet({ apiKey: API_KEY, apiUrl: API_URL, wsUrl: WS_URL });

client.on("connect", () => {
  console.log(`[sub] connected to ${WS_URL}/ws`);
  console.log(`[sub] listening on ${CHANNEL} — press Ctrl-C to stop`);
});
client.on("disconnect", () => console.log("[sub] disconnected"));
client.on("error", (error) => {
  console.error(`[sub] error: ${error instanceof Error ? error.message : String(error)}`);
});

client.subscribe(CHANNEL, (data, meta) => {
  const when = new Date(meta.timestamp).toLocaleTimeString();
  console.log(`[sub ${when}] channel=${meta.channel} from=${meta.from} data=${JSON.stringify(data)}`);
});

function shutdown() {
  console.log("\n[sub] shutting down");
  client.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.connect();
