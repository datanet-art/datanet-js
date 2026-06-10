# @datanet/core

DataNet JavaScript SDK — realtime pub/sub for browsers and Node.js. Handles
authentication, channel subscribe/publish, heartbeating, token refresh, and
reconnection against the [DataNet](https://datanet.art) platform.

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
<script src="https://cdn.jsdelivr.net/npm/@datanet/core@0.1/dist/datanet.browser.min.js"></script>
```

Pin a version in production — installations should never float on "latest".

## Usage

```js
import { DataNet } from "@datanet/core";

const client = new DataNet({
  apiKey: "ak_...",            // from https://app.datanet.art
  deviceId: "kiosk-01",        // optional: stable id for device limits/history
});

client.on("connect", () => console.log("connected"));
client.on("error", (err) => console.error(err));

client.subscribe("project.<pid>.sensors", (data, meta) => {
  console.log(meta.channel, data);
});

await client.connect();
client.publish("project.<pid>.sensors", { temperature: 21.4 });
```

## Binary, DMX, and Art-Net

DataNet can also carry raw bytes for lighting control, compact sensor frames,
and bridge workflows. Binary publishes use the gateway's binary envelope under
the hood, so browser and Node users do not need to manually base64-encode data.

```js
import { DataNet, buildDmxFrame } from "@datanet/core";

const client = new DataNet({ apiKey: "ak_...", deviceId: "lighting-ui" });
await client.connect();

const dmx = buildDmxFrame([255, 80, 20, 180], 512);
client.publishDmx("project.<pid>.lighting.dmx", dmx);
```

For script-tag/browser users, helpers are available as static methods:

```html
<script src="https://cdn.jsdelivr.net/npm/@datanet/core@0.1/dist/datanet.browser.min.js"></script>
<script>
  const client = new DataNet({ apiKey: "ak_...", deviceId: "browser-dmx-ui" });
  const dmx = DataNet.buildDmxFrame([255, 80, 20, 180], 512);
  await client.connect();
  client.publishDmx("project.<pid>.lighting.dmx", dmx);
</script>
```

Available binary helpers:

| API | Purpose |
|---|---|
| `publish(channel, bytes, { contentType, metadata })` | Auto-detect typed arrays and publish them as binary |
| `publishBinary(channel, bytes, { contentType, metadata })` | Publish raw bytes with a content type and metadata |
| `subscribeBinary(channel, handler, { contentType })` | Receive raw bytes plus `{ channel, from, timestamp, contentType, bytes, metadata }` |
| `subscribeAny(channel, handler)` | Receive both JSON and binary messages with a `kind` field |
| `publishDmx(channel, values, { length })` | Clamp values into a DMX frame and publish as `binary/dmx` |
| `publishArtNet(channel, dmx, options)` | Build an ArtDMX packet from DMX values and publish as `binary/artnet` |
| `buildDmxFrame(values, length)` | Create a 1-512 byte DMX frame |
| `buildArtDmxPacket(dmx, options)` | Build an Art-Net ArtDMX UDP payload |

Binary messages are delivered with protocol metadata instead of anonymous raw
frames, so subscribers can route and decode packets without hard-coding that
context in app code.

```js
client.publishBinary("project.<pid>.lighting.dmx", dmx, {
  contentType: "binary/dmx",
  metadata: { universe: 1, format: "dmx512" },
});

client.subscribeBinary("project.<pid>.lighting.dmx", (bytes, meta) => {
  console.log(meta.channel, meta.contentType, meta.metadata?.universe, bytes.length);
});

client.subscribeAny("project.<pid>.lighting.dmx", (message) => {
  if (message.kind === "binary") {
    console.log(message.meta.contentType, message.meta.bytes);
  }
});
```

If you already have a complete Art-Net packet from another library, send it
directly:

```js
client.publishBinary("project.<pid>.lighting.artnet", artnetPacket, {
  contentType: "binary/artnet",
});
```

### Options

| Option | Default | Purpose |
|---|---|---|
| `apiKey` | — | Project API key (required) |
| `deviceId` | — | Stable device identifier |
| `clientId` | — | Client/app identifier |
| `deviceName` | — | Display name for dashboards |
| `apiUrl` | `https://api.datanet.art` | REST base URL |
| `wsUrl` | `wss://ws.datanet.art` | WebSocket base URL |
| `maxReconnectAttempts` | `5` | Reconnect attempts before giving up |

### Errors

Gateway errors surface as `DataNetError` with `code`, `channel`, `retryMs`,
`scope`, and `status` fields:

```js
client.on("error", (err) => {
  if (err.code === "rate_limited") setTimeout(retry, err.retryMs);
});
```

### Node.js

Node 22+ has a global `WebSocket`. On Node 20/21:

```js
import { WebSocket } from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;
```

## Examples

See [`examples/`](examples):

- [`examples/browser`](examples/browser) - plain HTML browser examples
- [`examples/node/pubsub`](examples/node/pubsub) - JSON publish/subscribe scripts
- [`examples/node/binary-dmx`](examples/node/binary-dmx) - metadata-bearing binary DMX scripts

Full projects: [datanet-examples](https://github.com/datanet-art/datanet-examples).

## License

MIT
