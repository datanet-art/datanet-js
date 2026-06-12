# @datanet/core

DataNet JavaScript SDK — realtime pub/sub for browsers and Node.js. Handles
authentication, channel subscribe/publish, heartbeating, automatic token
refresh, and reconnection against the [DataNet](https://datanet.art) platform.

Payloads can be JSON values and nested data structures, typed arrays / raw
bytes, or content-type-labeled binary formats such as DMX, Art-Net, float
vectors, BLE batches, and compact interaction frames.

For custom clients or other SDK implementations, see the repository-level
[`PROTOCOL.md`](../../PROTOCOL.md).

## Install

```bash
npm install @datanet/core
# or
pnpm add @datanet/core
```

Or with a script tag (exposes `window.DataNet`):

```html
<script src="https://cdn.jsdelivr.net/npm/@datanet/core@0/dist/datanet.browser.min.js"></script>
```

Pin a version in production — installations should never float on "latest".

---

## Quick start

```js
import { DataNet } from "@datanet/core";

const client = new DataNet({
  apiKey: "ak_...",       // from https://app.datanet.art
  deviceId: "kiosk-01",  // optional: stable id for device limits and history
});

client.on("connect", () => console.log("connected"));
client.on("error", (err) => console.error(err));

client.subscribe("project.<pid>.sensors", (data, meta) => {
  console.log(meta.channel, data);
});

await client.connect();
client.publish("project.<pid>.sensors", { temperature: 21.4 });
```

---

## Constructor

```js
new DataNet(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Project API key (required) |
| `deviceId` | `string` | — | Stable device identifier for device limits and history metadata |
| `clientId` | `string` | — | Client/app identifier for connection tracking |
| `deviceName` | `string` | — | Display name shown in dashboards and admin tools |
| `apiUrl` | `string` | `https://api.datanet.art` | REST base URL |
| `wsUrl` | `string` | `wss://ws.datanet.art` | WebSocket base URL |
| `maxReconnectAttempts` | `number` | `5` | Reconnect attempts before giving up |

---

## Connection

### `client.connect()` → `Promise<void>`

Authenticate with your API key and open the WebSocket. Must be called before
`subscribe` or `publish`. Resolves when the gateway handshake completes and
all pending subscriptions have been re-sent.

```js
await client.connect();
```

### `client.disconnect()` → `void`

Close the connection. No reconnect will be attempted.

```js
client.disconnect();
```

### `client.connected` → `boolean`

`true` if the WebSocket is currently open.

```js
if (client.connected) {
  client.publish("project.<pid>.events", { action: "click" });
}
```

---

## Events

### `client.on(event, handler)` → `this`

Register a lifecycle event handler. Returns `this` for chaining.

| Event | Handler signature | When |
|---|---|---|
| `"connect"` | `() => void` | WebSocket opened and handshake complete |
| `"disconnect"` | `() => void` | Connection closed (before any reconnect) |
| `"error"` | `(err: DataNetError \| Error) => void` | Auth failure, gateway error, or reconnect exhausted |

```js
client
  .on("connect", () => console.log("connected"))
  .on("disconnect", () => console.log("disconnected"))
  .on("error", (err) => {
    if (err.code === "rate_limited") {
      setTimeout(retry, err.retryMs);
    }
  });
```

### `client.off(event, handler)` → `this`

Remove a previously registered event handler.

```js
const onError = (err) => console.error(err);
client.on("error", onError);
// later:
client.off("error", onError);
```

---

## JSON pub/sub

### `client.subscribe(channel, handler)` → `this`

Subscribe to a channel. `handler` is called with `(data, meta)` for every
incoming message. Subscriptions made before `connect()` are automatically
re-sent on connect and after every reconnect.

```js
client.subscribe("project.<pid>.sensors", (data, meta) => {
  console.log(data);          // the message payload
  console.log(meta.channel);  // full channel name
  console.log(meta.from);     // sender device/client id
  console.log(meta.timestamp); // unix ms
});
```

### `client.unsubscribe(channel, handler?)` → `this`

Remove a subscription. If `handler` is omitted, all handlers for the channel
are removed and an `unsub` is sent to the gateway.

```js
client.unsubscribe("project.<pid>.sensors", myHandler);
// or remove all:
client.unsubscribe("project.<pid>.sensors");
```

### `client.publish(channel, data, options?)` → `this`

Publish a message to a channel. `data` can be any JSON-serialisable value. If
`data` is a typed array or `ArrayBuffer` it is automatically routed to
`publishBinary`.

```js
client.publish("project.<pid>.sensors", { temperature: 21.4 });
client.publish("project.<pid>.events", "ping");
client.publish("project.<pid>.frames", new Float32Array([0.1, 0.5, 0.9]));
```

---

## Binary pub/sub

DataNet carries raw bytes for lighting control, compact sensor frames, and
bridge workflows. Binary publishes use the gateway's binary envelope so
subscribers always receive routing metadata alongside the bytes.

### `client.publishBinary(channel, data, options?)` → `this`

Publish raw bytes with an explicit content type.

```js
client.publishBinary("project.<pid>.lighting.dmx", dmxFrame, {
  contentType: "binary/dmx",
  metadata: { universe: 1, format: "dmx512" },
});
```

### `client.subscribeBinary(channel, handler, options?)` → `this`

Receive raw bytes. `handler` is called with `(bytes: Uint8Array, meta)`.

```js
client.subscribeBinary("project.<pid>.lighting.dmx", (bytes, meta) => {
  console.log(meta.channel, meta.contentType, meta.bytes, bytes.length);
  console.log(meta.metadata?.universe); // application metadata
});
```

### `client.unsubscribeBinary(channel, handler?)` → `this`

Remove a binary subscription (same semantics as `unsubscribe`).

### `client.subscribeAny(channel, handler)` → `this`

Receive both JSON and binary messages on the same channel. The handler receives
a discriminated union:

```js
client.subscribeAny("project.<pid>.mixed", (message) => {
  if (message.kind === "json") {
    console.log(message.data, message.meta.channel);
  } else {
    // message.kind === "binary"
    console.log(message.data, message.meta.contentType);
  }
});
```

### `client.unsubscribeAny(channel, handler?)` → `this`

Remove a mixed subscription.

---

## DMX and Art-Net

### `client.publishDmx(channel, values, options?)` → `this`

Clamp `values` into a 1–512 byte DMX frame and publish as `binary/dmx`.

```js
client.publishDmx("project.<pid>.lighting.dmx", [255, 80, 20, 180]);
client.publishDmx("project.<pid>.lighting.dmx", [255, 80, 20, 180], { length: 512 });
```

### `client.publishArtNet(channel, dmx, options?)` → `this`

Build an ArtDMX packet and publish as `binary/artnet`.

```js
client.publishArtNet("project.<pid>.lighting.artnet", dmxFrame, {
  universe: 0,
  subnet: 0,
  net: 0,
});
```

---

## Static helpers

Available as both named exports and static methods on `DataNet`:

```js
import { buildDmxFrame, buildArtDmxPacket, toUint8Array, binaryToBase64, base64ToBinary } from "@datanet/core";
// or:
DataNet.buildDmxFrame(...)
```

| Helper | Signature | Purpose |
|---|---|---|
| `buildDmxFrame` | `(values, length?) → Uint8Array` | Build a 1–512 byte DMX frame, values clamped 0–255 |
| `buildArtDmxPacket` | `(dmx, options?) → Uint8Array` | Build a full Art-Net ArtDMX UDP payload |
| `toUint8Array` | `(data: BinaryData) → Uint8Array` | Normalise any typed array or ArrayBuffer to Uint8Array |
| `binaryToBase64` | `(data: BinaryData) → string` | Encode bytes to base64 (Node and browser) |
| `base64ToBinary` | `(encoded: string) → Uint8Array` | Decode base64 to bytes (Node and browser) |

---

## Errors

Gateway errors surface as `DataNetError` instances on the `"error"` event.

```js
client.on("error", (err) => {
  console.log(err.code);     // machine-readable error code
  console.log(err.message);  // human-readable description
  console.log(err.channel);  // channel involved (if any)
  console.log(err.retryMs);  // ms to wait before retrying (rate_limited only)
  console.log(err.scope);    // scope that was missing (insufficient_scope only)
  console.log(err.limit);    // plan cap that was hit (device/topic limits only)
  console.log(err.status);   // HTTP status (authentication errors only)
});
```

| Code | When | Extra fields | Retryable? |
|---|---|---|---|
| `rate_limited` | Message budget exceeded | `retryMs`, `scope` | Yes — wait `retryMs` |
| `device_limit_reached` | Device cap hit | `limit` | No — stop reconnecting |
| `topic_limit_reached` | Channel cap hit on sub/pub | `limit` | No |
| `channel_not_provisioned` | Channel was never created | `channel` | No |
| `channel_not_allowed` | JWT scope doesn't cover channel | `channel` | No |
| `insufficient_scope` | API key scope too narrow | `scope` | No |
| `authentication_failed` | Bad API key or expired token | `status` | No |

```js
client.on("error", (err) => {
  if (err.code === "rate_limited") {
    setTimeout(() => client.publish(channel, data), err.retryMs);
  } else if (err.code === "device_limit_reached") {
    console.error(`Device cap is ${err.limit} — upgrade your plan`);
    client.disconnect(); // fatal — don't reconnect
  }
});
```

---

## Token refresh

The SDK silently refreshes the JWT 90 seconds before it expires, so
long-running browser sessions stay connected across the 10-minute JWT window
without requiring a reconnect or user action. No configuration needed.

---

## Node.js

Node 22+ has a global `WebSocket`. For Node 20/21 you must provide one:

```js
import { WebSocket } from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

import { DataNet } from "@datanet/core";
```

---

## Browser script tag

```html
<script src="https://cdn.jsdelivr.net/npm/@datanet/core@0/dist/datanet.browser.min.js"></script>
<script>
  const client = new DataNet({ apiKey: "ak_...", deviceId: "browser-ui" });
  const dmx = DataNet.buildDmxFrame([255, 80, 20, 180], 512);
  await client.connect();
  client.publishDmx("project.<pid>.lighting.dmx", dmx);
</script>
```

---

## Examples

See [`examples/`](examples):

- [`examples/browser`](examples/browser) — plain HTML browser examples
- [`examples/node/pubsub`](examples/node/pubsub) — JSON publish/subscribe scripts
- [`examples/node/binary-dmx`](examples/node/binary-dmx) — metadata-bearing binary DMX scripts

Full projects: [datanet-examples](https://github.com/datanet-art/datanet-examples).

---

## License

MIT
