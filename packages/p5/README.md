# @datanet/p5

DataNet addon for [p5.js](https://p5js.org) — realtime pub/sub for sketches.
Works in global mode and instance mode, in the browser and the
[p5.js Web Editor](https://editor.p5js.org). Single self-contained file: no
build step, no bundler.

## Install

In the p5.js Web Editor or any HTML sketch, load it after p5.js:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@datanet/p5@0.1/dist/datanet-p5.min.js"></script>
```

Or via npm for bundled projects:

```bash
npm install @datanet/p5
```

## Usage — global mode

```js
let dn;

function setup() {
  createCanvas(700, 500);
  dn = createDataNet("ak_..."); // from https://app.datanet.art
  dn.connect();
  dn.subscribe("project.<pid>.sensor", (data, meta) => {
    // react to incoming data
  });
}

function mousePressed() {
  dn.publish("project.<pid>.sensor", { x: mouseX / width, y: mouseY / height });
}
```

## Usage — instance mode

```js
new p5((p) => {
  let dn;
  p.setup = () => {
    p.createCanvas(700, 500);
    dn = p.createDataNet("ak_...");
    dn.connect();
  };
});
```

## Options

```js
createDataNet("ak_...", {
  apiUrl: "https://api.datanet.art",  // override for local dev
  wsUrl: "wss://ws.datanet.art/ws",
  debug: false,                        // log protocol messages
  maxReconnectAttempts: 5,
});
```

The client heartbeats every 30 s and reconnects automatically with
exponential backoff.

## Examples

- [`examples/sketch-global`](examples/sketch-global) — live scatter plot, global mode
- [`examples/sketch-instance`](examples/sketch-instance) — instance mode
- Full projects: [datanet-examples](https://github.com/datanet-art/datanet-examples)

## License

MIT
