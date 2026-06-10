# @datanet/core

DataNet JavaScript SDK — realtime pub/sub for browsers and Node.js. Handles
authentication, channel subscribe/publish, heartbeating, token refresh, and
reconnection against the [DataNet](https://datanet.art) platform.

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

See [`examples/`](examples) — Node publish/subscribe scripts and a browser
page. Full projects: [datanet-examples](https://github.com/datanet-art/datanet-examples).

## License

MIT
