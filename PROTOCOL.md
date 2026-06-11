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

DataNet supports two transport payload classes:

- JSON values in `d`, including strings, numbers, booleans, arrays, objects,
  and nested data structures.
- Binary bytes in `b64`, labeled by `ct` and optionally described with `meta`.

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

The `ct` value identifies the packet format, not the channel itself. A project
may use standard DataNet content types or application-specific strings when a
bridge, SDK, or receiver understands that format.

## Server Responses

```json
{ "type": "connected", "connId": "..." }
{ "type": "sub_ack", "op": "hereNow", "ch": "project.<project-id>.sensor", "occupancy": 1 }
{ "type": "unsub_ack", "op": "unsubAck", "ch": "project.<project-id>.sensor" }
{ "type": "hb_ack", "op": "hb", "timestamp": 1710000000000 }
{ "type": "error", "error": "rate_limited", "retry_ms": 10000 }
```

## Error Codes

| `error` | When | Extra fields | Retryable? |
|---|---|---|---|
| `rate_limited` | Publish exceeded a per-connection, per-topic, or per-project msgs/sec or bytes/sec budget | `retry_ms`, `scope` (`"connection"` when the per-connection throttle fired) | Yes — back off for `retry_ms` |
| `device_limit_reached` | Connecting would exceed the plan's active-device cap; sent before the handshake, then the socket is closed | `limit` (the plan's device cap) | No — disconnect another device or upgrade |
| `topic_limit_reached` | The channel exists but is over the plan's channel cap (e.g. after a tier downgrade) | `limit` (the plan's channel cap) | No — remove channels or upgrade |
| `channel_not_provisioned` | The channel has not been created for this project | `channel`, `operation` | No — create the channel first |
| `channel_not_allowed` | The JWT's channel prefixes don't cover this channel | `channel`, `operation` | No |
| `insufficient_scope` | The API key lacks the `pub` or `sub` scope | `required` | No |

SDKs surface these as structured errors (`DataNetError`) with `code`,
`channel`, `retryMs`/`retry_ms`, `scope`, and `limit` populated when present.
`device_limit_reached` is fatal: clients must not auto-reconnect after it.

## SDK Guidance

- `publish(channel, value)` may auto-detect typed arrays / byte buffers and send
  binary envelopes.
- `publishBinary(channel, bytes, { contentType, metadata })` should be available
  for explicit binary sends.
- `subscribe(channel, handler)` should receive JSON messages.
- `subscribeBinary(channel, handler)` should receive bytes plus metadata.
- `subscribeAny(channel, handler)` should receive both JSON and binary messages
  with a `kind` discriminator.
