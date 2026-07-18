# @datanet/p5

## 0.2.1

### Patch Changes

- Updated dependencies [765dfbe]
  - @datanet/core@0.1.2

## 0.2.0

### Minor Changes

- 812675b: Add binary pub/sub, DMX, and Art-Net support: `publishBinary`, `subscribeBinary`, `unsubscribeBinary`, `publishDmx`, `publishArtNet`, `buildDmxFrame`, and `buildArtDmxPacket` — matching the binary API available in `@datanet/core`.

### Patch Changes

- ae75232: Complete API reference in both READMEs: all methods, options, error codes, token refresh, static helpers, and binary pub/sub documented.
- Updated dependencies [ae75232]
  - @datanet/core@0.1.1

## 0.1.1

### Patch Changes

- ec52d84: Fix p5.js warning "had problems creating the global function createDataNet" — the addon was manually setting `window.createDataNet` before p5 could promote it from `p5.prototype`, triggering a false naming conflict warning. p5 now handles global promotion automatically.

## 0.1.0

### Minor Changes

- a709c05: Initial release: DataNet addon for p5.js — `createDataNet()` in global and
  instance mode, realtime pub/sub for sketches, works in the p5.js Web Editor
  via a single script tag (no build step).
