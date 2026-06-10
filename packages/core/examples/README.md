# @datanet/core Examples

Minimal runnable examples for the core JavaScript SDK.

## Browser

- `browser/basic.html` — subscribe and publish JSON from a plain HTML page.
- `browser/dmx.html` — publish a binary DMX frame from a browser.

Build the SDK first so the examples can load `../../dist/datanet.browser.js`:

```bash
pnpm --filter @datanet/core build
```

Then open the HTML file and paste an API key/channel from the dashboard.

## Node.js

Copy the relevant template before running a Node example:

```bash
cp node/pubsub/.env.example node/pubsub/.env
node node/pubsub/subscribe.mjs
node node/pubsub/publish.mjs
```

Binary DMX:

```bash
cp node/binary-dmx/.env.example node/binary-dmx/.env
node node/binary-dmx/subscribe.mjs
node node/binary-dmx/publish.mjs
```

Node 22+ includes a global WebSocket. Node 20/21 examples load `ws`
automatically when needed.
