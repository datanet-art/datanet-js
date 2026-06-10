# DataNet WebSocket Protocol

This document describes the SDK-facing WebSocket envelope used by DataNet
clients. SDKs should preserve this contract across languages so JavaScript,
Python, Arduino/ESP32, Processing, TouchDesigner, and bridge tools interoperate.

## Connection

Connect to:

```text
wss://ws.datanet.art/ws
```

Pass the gateway JWT as a WebSocket subprotocol:

```text
Sec-WebSocket-Protocol: bearer, <jwt>
```

The JWT is obtained from `POST https://api.datanet.art/auth/token` using a
project API key.

## Client Envelopes

Subscribe:

```json
{ "op": "sub", "ch": "project.<project-id>.sensor" }
```

Unsubscribe:

```json
{ "op": "unsub", "ch": "project.<project-id>.sensor" }
```

Publish JSON:

```json
{
  "op": "pub",
  "ch": "project.<project-id>.sensor",
  "d": { "value": 42 }
}
```

Publish binary:

```json
{
  "op": "pub",
  "ch": "project.<project-id>.lights",
  "bin": true,
  "b64": "AQID",
  "ct": "binary/dmx",
  "meta": {
    "universe": 1,
    "format": "dmx512"
  }
}
```

Heartbeat:

```json
{ "op": "hb" }
```

## Server Publish Envelopes

JSON subscribers receive:

```json
{
  "type": "message",
  "op": "pub",
  "ch": "project.<project-id>.sensor",
  "d": { "value": 42 },
  "ts": 1710000000000,
  "from": "device-1"
}
```

Binary subscribers receive a metadata-bearing envelope:

```json
{
  "type": "message",
  "op": "pub",
  "ch": "project.<project-id>.lights",
  "bin": true,
  "b64": "AQID",
  "ct": "binary/dmx",
  "bytes": 3,
  "ts": 1710000000000,
  "from": "browser-controller",
  "meta": {
    "universe": 1,
    "format": "dmx512"
  }
}
```

SDKs should expose binary messages as bytes plus metadata:

```ts
{
  channel: string;
  from: string;
  timestamp: number;
  contentType: string;
  bytes: number;
  metadata?: Record<string, unknown>;
}
```

Binary packets must not be treated as self-describing. The protocol metadata is
how bridges know whether bytes are DMX, Art-Net, BLE batches, vectors, or another
binary format.

## Content Types

Known binary content types include:

- `binary/dmx`
- `binary/dmx-delta`
- `binary/artnet`
- `binary/vecf32`
- `binary/ble-adv-batch`
- `binary/interaction-batch`
- `application/octet-stream`

## Server Responses

```json
{ "type": "connected", "connId": "..." }
{ "type": "sub_ack", "op": "hereNow", "ch": "project.<project-id>.sensor", "occupancy": 1 }
{ "type": "unsub_ack", "op": "unsubAck", "ch": "project.<project-id>.sensor" }
{ "type": "hb_ack", "op": "hb", "timestamp": 1710000000000 }
{ "type": "error", "error": "rate_limited", "retry_ms": 10000 }
```

## SDK Guidance

- `publish(channel, value)` may auto-detect typed arrays / byte buffers and send
  binary envelopes.
- `publishBinary(channel, bytes, { contentType, metadata })` should be available
  for explicit binary sends.
- `subscribe(channel, handler)` should receive JSON messages.
- `subscribeBinary(channel, handler)` should receive bytes plus metadata.
- `subscribeAny(channel, handler)` should receive both JSON and binary messages
  with a `kind` discriminator.
