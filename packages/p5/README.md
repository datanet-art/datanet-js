# @datanet/p5

DataNet addon for [p5.js](https://p5js.org) — realtime pub/sub for sketches.
Works in global mode and instance mode, in the browser and the
[p5.js Web Editor](https://editor.p5js.org). Single self-contained file: no
build step, no bundler.

## Install

In the p5.js Web Editor or any HTML sketch, load it after p5.js:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@datanet/p5@0/dist/datanet-p5.min.js"></script>
```

Or via npm for bundled projects:

```bash
npm install @datanet/p5
```

---

## Quick start — global mode

```js
let dn;

function setup() {
  createCanvas(700, 500);
  dn = createDataNet("ak_..."); // API key from https://app.datanet.art
  dn.connect();
  dn.subscribe("project.<pid>.sensor", (data, meta) => {
    console.log(data, meta.channel);
  });
}

function mousePressed() {
  dn.publish("project.<pid>.sensor", { x: mouseX / width, y: mouseY / height });
}
```

## Quick start — instance mode

```js
new p5((p) => {
  let dn;

  p.setup = () => {
    p.createCanvas(700, 500);
    dn = p.createDataNet("ak_...");
    dn.connect();
    dn.subscribe("project.<pid>.sensor", (data) => {
      console.log(data);
    });
  };
});
```

---

## `createDataNet(apiKey, options?)` → `DataNetP5`

Creates and returns a DataNet client. In global mode call it as a free
function; in instance mode call it as `p.createDataNet(...)`.

The client automatically disconnects when the sketch is removed (via
`p.remove()` or the p5.js Web Editor's stop button).

### Options

| Option | Default | Description |
|---|---|---|
| `deviceId` | — | Stable device identifier for device limits and history metadata |
| `clientId` | — | Client/app identifier for connection tracking |
| `deviceName` | — | Display name shown in dashboards and admin tools |
| `apiUrl` | `https://api.datanet.art` | Override the REST base URL (local dev) |
| `wsUrl` | `wss://ws.datanet.art/ws` | Override the WebSocket URL |
| `maxReconnectAttempts` | `5` | Reconnect attempts before giving up |

```js
dn = createDataNet("ak_...", {
  deviceId: "installation-01",
  deviceName: "Main Installation",
  maxReconnectAttempts: 3,
});
```

---

## Connection

### `dn.connect()` → `DataNetP5`

Authenticate with your API key and open the WebSocket. The `"connect"` event
fires when the socket is ready. Returns `this` for chaining.

```js
dn.connect();
// or chain:
dn.connect().on("connect", () => console.log("ready"));
```

### `dn.disconnect()` → `DataNetP5`

Close the WebSocket. No reconnect will be attempted after this call.

```js
dn.disconnect();
```

### `dn.isConnected()` → `boolean`

Returns `true` if the WebSocket is currently open.

```js
if (dn.isConnected()) {
  dn.publish("project.<pid>.events", { action: "click" });
}
```

### `dn.connected` (property)

Alias for `isConnected()`, readable as a property.

```js
if (dn.connected) { ... }
```

---

## Pub / Sub

### `dn.subscribe(channel, handler)` → `DataNetP5`

Subscribe to a channel. `handler` is called with `(data, meta)` for every
incoming message. Subscriptions made before `connect()` are automatically
re-sent when the connection opens.

```js
dn.subscribe("project.<pid>.sensors", (data, meta) => {
  console.log(data);           // message payload
  console.log(meta.channel);  // full channel name
  console.log(meta.from);     // sender device id
  console.log(meta.timestamp); // unix ms
});
```

### `dn.unsubscribe(channel, handler?)` → `DataNetP5`

Remove a subscription. If `handler` is omitted, all handlers for the channel
are removed.

```js
dn.unsubscribe("project.<pid>.sensors", myHandler);
// or remove all:
dn.unsubscribe("project.<pid>.sensors");
```

### `dn.publish(channel, data)` → `DataNetP5`

Publish a message to a channel. `data` can be any JSON-serialisable value.

```js
dn.publish("project.<pid>.sensors", { temperature: 21.4 });
dn.publish("project.<pid>.events", "ping");
dn.publish("project.<pid>.position", { x: mouseX, y: mouseY });
```

---

## Binary pub/sub — DMX and Art-Net

For lighting installations and hardware bridges, the p5 client can send and
receive raw binary frames alongside JSON messages.

### `dn.publishBinary(channel, data, options?)` → `DataNetP5`

Publish raw bytes with an explicit content type.

```js
dn.publishBinary("project.<pid>.lighting.dmx", dmxFrame, {
  contentType: "binary/dmx",
  metadata: { universe: 1 },
});
```

### `dn.subscribeBinary(channel, handler)` → `DataNetP5`

Receive raw bytes. `handler` is called with `(bytes: Uint8Array, meta)`.

```js
dn.subscribeBinary("project.<pid>.lighting.dmx", (bytes, meta) => {
  console.log(meta.contentType, meta.bytes, bytes[0]);
  // meta.metadata contains any application metadata the publisher set
});
```

### `dn.unsubscribeBinary(channel, handler?)` → `DataNetP5`

Remove a binary subscription. If `handler` is omitted all handlers for the
channel are removed.

### `dn.publishDmx(channel, values, options?)` → `DataNetP5`

Clamp `values` into a 1–512 byte DMX frame and publish as `binary/dmx`.
Values are clamped to 0–255 and the frame is zero-padded to `length`.

```js
// Set first 4 channels, send a full 512-byte frame
dn.publishDmx("project.<pid>.lighting.dmx", [255, 80, 20, 180]);

// Shorter frame
dn.publishDmx("project.<pid>.lighting.dmx", [255, 80, 20, 180], { length: 4 });
```

### `dn.publishArtNet(channel, dmx, options?)` → `DataNetP5`

Build an Art-Net ArtDMX packet and publish as `binary/artnet`.

```js
dn.publishArtNet("project.<pid>.lighting.artnet", [255, 80, 20, 180], {
  universe: 0,
  subnet: 0,
  net: 0,
});
```

### Standalone helpers

`buildDmxFrame` and `buildArtDmxPacket` are available as named exports for
bundler / Node.js projects:

```js
import { buildDmxFrame, buildArtDmxPacket } from "@datanet/p5";
const frame = buildDmxFrame([255, 80, 20, 180], 512);
```

For TypeScript projects, `@datanet/core` provides the same helpers with full
type definitions.

---

## Message buffers

The client keeps a rolling buffer of the last 100 messages per channel,
useful for drawing sparklines or graphs inside `draw()`.

### `dn.getLastMessage(channel)` → `{data, from, timestamp} | null`

The most recent message received on a channel, or `null` if none yet.

```js
function draw() {
  const msg = dn.getLastMessage("project.<pid>.sensors");
  if (msg) {
    text(msg.data.temperature, 10, 20);
  }
}
```

### `dn.getBuffer(channel, maxLength?)` → `Array`

The last `maxLength` messages (default 100), most recent at the end. Each
entry has `{ data, from, timestamp }`.

```js
function draw() {
  const msgs = dn.getBuffer("project.<pid>.sensors", 50);
  msgs.forEach((msg, i) => {
    point(i * 4, map(msg.data.value, 0, 1, height, 0));
  });
}
```

### `dn.getMessageCount(channel)` → `number`

Total messages received on a channel since subscribing.

```js
text(`Messages received: ${dn.getMessageCount("project.<pid>.sensors")}`, 10, 20);
```

---

## Events

### `dn.on(event, handler)` → `DataNetP5`

Register a lifecycle event handler.

| Event | When |
|---|---|
| `"connect"` | WebSocket opened and ready |
| `"disconnect"` | Connection closed (before any reconnect attempt) |
| `"error"` | Auth failure, gateway error, or reconnect exhausted |

```js
dn
  .on("connect", () => console.log("DataNet connected"))
  .on("disconnect", () => console.log("DataNet disconnected"))
  .on("error", (err) => console.error("DataNet error:", err.message));
```

### `dn.off(event, handler)` → `DataNetP5`

Remove a previously registered event handler.

```js
const onError = (err) => console.error(err);
dn.on("error", onError);
// later:
dn.off("error", onError);
```

Legacy aliases `onConnect(fn)`, `onDisconnect(fn)`, and `onError(fn)` are
supported but deprecated — use `on(event, fn)` instead.

---

## Error handling

Gateway errors are emitted on the `"error"` event.

```js
dn.on("error", (err) => {
  console.error(err.message);
});
```

Common error messages:

| Situation | Message |
|---|---|
| Bad API key | `DataNet auth failed — HTTP 401: ...` |
| Rate limited | `DataNet: rate_limited` |
| Channel cap hit | `DataNet: topic_limit_reached` |
| Device cap hit | `DataNet: device_limit_reached` |
| Reconnect exhausted | `DataNet: max reconnect attempts (5) reached` |

The client reconnects automatically with exponential backoff (1s, 2s, 4s…
up to 30s) after unexpected disconnects. Calling `disconnect()` stops
reconnect attempts.

---

## Examples

- [`examples/sketch-global`](examples/sketch-global) — live scatter plot, global mode
- [`examples/sketch-instance`](examples/sketch-instance) — instance mode
- Full projects: [datanet-examples](https://github.com/datanet-art/datanet-examples)

---

## About

DataNet is developed and supported by [Studio Jordan Shaw](https://www.jordanshaw.com), a creative technology studio building tools for realtime, networked, and physical-digital work.

- DataNet: [datanet.art](https://datanet.art)
- Studio: [jordanshaw.com](https://www.jordanshaw.com)
- Instagram: [@jshaw3](https://www.instagram.com/jshaw3)
- GitHub: [datanet-art](https://github.com/datanet-art)
- Source: [datanet-js](https://github.com/datanet-art/datanet-js)
- Examples: [datanet-examples](https://github.com/datanet-art/datanet-examples)

---

## License

MIT
