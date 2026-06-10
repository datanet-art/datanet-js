# datanet-js

DataNet JavaScript SDK family — realtime pub/sub for browsers, Node.js, and
p5.js sketches. [DataNet](https://datanet.art) is an artist-friendly realtime
data network for installations, artworks, and connected devices.

| Package | Install | For |
|---|---|---|
| [`@datanet/core`](packages/core) | `npm install @datanet/core` | Browsers and Node.js — the foundation |
| [`@datanet/p5`](packages/p5) | `<script>` tag or `npm install @datanet/p5` | p5.js sketches (global & instance mode) |

## Quick start (browser, no build step)

```html
<script src="https://cdn.jsdelivr.net/npm/@datanet/core@0.1/dist/datanet.browser.min.js"></script>
<script>
  const client = new DataNet({ apiKey: "ak_..." });
  client.subscribe("project.<pid>.demo", (data, meta) => console.log(data, meta));
  client.connect().then(() => client.publish("project.<pid>.demo", { hello: 1 }));
</script>
```

Get an API key at [app.datanet.art](https://app.datanet.art). Full docs at
[datanet.art/docs](https://datanet.art/docs).
The wire protocol is documented in [PROTOCOL.md](PROTOCOL.md).

## Quick start (Node.js)

```js
import { DataNet } from "@datanet/core";

const client = new DataNet({ apiKey: process.env.DATANET_API_KEY });
client.on("connect", () => console.log("connected"));
client.subscribe("project.<pid>.demo", (data) => console.log(data));
await client.connect();
```

## Binary lighting quick start

```js
import { DataNet, buildDmxFrame } from "@datanet/core";

const client = new DataNet({ apiKey: process.env.DATANET_API_KEY });
await client.connect();

const frame = buildDmxFrame([255, 80, 20, 180], 512);
client.publishBinary("project.<pid>.lighting.dmx", frame, {
  contentType: "binary/dmx",
  metadata: { universe: 1, format: "dmx512" },
});

client.subscribeBinary("project.<pid>.lighting.dmx", (bytes, meta) => {
  console.log(meta.contentType, meta.metadata?.universe, bytes.length);
});
```

Binary messages carry protocol metadata with the packet: `channel`, `from`,
`timestamp`, `contentType`, `bytes`, and optional custom `metadata`. Use
`subscribeAny()` when a channel may carry both JSON and binary signals.

Node 22+ works out of the box. On Node 20/21, provide a WebSocket global
first: `import { WebSocket } from "ws"; globalThis.WebSocket = WebSocket;`

## Examples

Each package ships minimal runnable examples in its `examples/` directory.
Full standalone projects live in
[datanet-examples](https://github.com/datanet-art/datanet-examples).

## Development

```bash
pnpm install
pnpm build        # builds all packages
pnpm test         # runs all tests
```

This is a pnpm workspace; packages version and publish independently via
[changesets](https://github.com/changesets/changesets). To propose a change,
include a changeset: `pnpm changeset`.

To develop against a local DataNet gateway, point the client at it with
`apiUrl`/`wsUrl` (or `DATANET_API_URL`/`DATANET_WS_URL` for the examples).

## License

[MIT](LICENSE)
