import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataNet,
  DataNetError,
  base64ToBinary,
  binaryToBase64,
  buildArtDmxPacket,
  buildDmxFrame,
} from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DataNetError", () => {
  it("carries structured gateway error details", () => {
    const err = new DataNetError({
      code: "channel_not_allowed",
      message: "DataNet: channel not allowed",
      channel: "project.x.demo",
      retryMs: 1500,
      scope: "pub",
      status: 403,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DataNetError");
    expect(err.code).toBe("channel_not_allowed");
    expect(err.channel).toBe("project.x.demo");
    expect(err.retryMs).toBe(1500);
    expect(err.scope).toBe("pub");
    expect(err.status).toBe(403);
  });
});

describe("DataNet", () => {
  it("is not connected before connect()", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    expect(client.connected).toBe(false);
  });

  it("supports chained subscribe/publish/unsubscribe before connecting", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const handler = vi.fn();

    expect(() => {
      client.subscribe("project.x.demo", handler).publish("project.x.demo", { hello: 1 }).unsubscribe("project.x.demo");
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("registers and removes event listeners", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const onError = vi.fn();
    client.on("error", onError);
    client.off("error", onError);
    expect(client.connected).toBe(false);
  });

  it("rejects connect() when the auth endpoint is unreachable", async () => {
    const client = new DataNet({
      apiKey: "ak_test",
      apiUrl: "http://127.0.0.1:1", // nothing listens here
    });
    const onError = vi.fn();
    client.on("error", onError);

    await expect(client.connect()).rejects.toThrow(/authentication/);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("disconnect() is safe to call before connect()", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    expect(() => client.disconnect()).not.toThrow();
    expect(client.connected).toBe(false);
  });

  it("sends heartbeat envelopes every 30 seconds", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const client = new DataNet({ apiKey: "ak_test" });
    const send = vi.fn();
    (client as unknown as { ws: { readyState: number; send: (payload: string) => void } }).ws = {
      readyState: 1,
      send,
    };

    (client as unknown as { startHeartbeat(): void }).startHeartbeat();
    vi.advanceTimersByTime(30_000);

    expect(send).toHaveBeenCalledWith(JSON.stringify({ op: "hb" }));
    (client as unknown as { stopHeartbeat(): void }).stopHeartbeat();
  });

  it("schedules reconnect with exponential backoff and reuses a valid JWT", async () => {
    vi.useFakeTimers();
    const client = new DataNet({ apiKey: "ak_test" });
    const openSocket = vi.fn(async () => {});
    Object.assign(client as unknown as Record<string, unknown>, {
      jwt: "header.payload.signature",
      jwtExpiry: Math.floor(Date.now() / 1000) + 120,
      openSocket,
    });

    (client as unknown as { scheduleReconnect(): void }).scheduleReconnect();
    expect(openSocket).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(openSocket).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(openSocket).toHaveBeenCalledOnce();
  });

  it("replays JSON, binary, and mixed subscriptions after socket connect", async () => {
    type Listener = (event: { data?: unknown }) => void;
    class FakeWebSocket {
      static OPEN = 1;
      static instances: FakeWebSocket[] = [];
      readyState = 1;
      sent: string[] = [];
      listeners = new Map<string, Listener[]>();

      constructor() {
        FakeWebSocket.instances.push(this);
      }

      addEventListener(event: string, listener: Listener) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      }

      send(payload: string) {
        this.sent.push(payload);
      }

      close() {
        this.emit("close", {});
      }

      emit(event: string, payload: { data?: unknown }) {
        for (const listener of this.listeners.get(event) ?? []) listener(payload);
      }
    }

    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new DataNet({ apiKey: "ak_test" });
    client.subscribe("demo.json", vi.fn());
    client.subscribeBinary("demo.binary", vi.fn());
    client.subscribeAny("demo.any", vi.fn());
    Object.assign(client as unknown as Record<string, unknown>, { jwt: "token" });

    const opened = (client as unknown as { openSocket(): Promise<void> }).openSocket();
    const ws = FakeWebSocket.instances[0]!;
    ws.emit("open", {});
    ws.emit("message", { data: JSON.stringify({ type: "connected" }) });
    await opened;

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      { op: "sub", ch: "demo.json" },
      { op: "sub", ch: "demo.binary" },
      { op: "sub", ch: "demo.any" },
    ]);
    client.disconnect();
  });

  it("decodes Node Buffer WebSocket message payloads", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const decoded = (client as unknown as { decodeMessageData(data: unknown): { text: string } | null }).decodeMessageData(
      Buffer.from('{"op":"pub"}')
    );

    expect(decoded?.text).toBe('{"op":"pub"}');
  });

  it("decodes Uint8Array WebSocket message payloads", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const decoded = (client as unknown as { decodeMessageData(data: unknown): { text: string } | null }).decodeMessageData(
      new TextEncoder().encode('{"op":"pub"}')
    );

    expect(decoded?.text).toBe('{"op":"pub"}');
  });

  it("builds clamped DMX frames", () => {
    const frame = buildDmxFrame([255, 300, -1, 12.8], 6);

    expect([...frame]).toEqual([255, 255, 0, 12, 0, 0]);
  });

  it("builds ArtDMX packets from DMX bytes", () => {
    const packet = buildArtDmxPacket(new Uint8Array([1, 2, 3]), {
      universe: 2,
      subnet: 1,
      net: 3,
      sequence: 9,
    });

    expect(new TextDecoder().decode(packet.subarray(0, 7))).toBe("Art-Net");
    expect(packet[8]).toBe(0x00);
    expect(packet[9]).toBe(0x50);
    expect(packet[11]).toBe(14);
    expect(packet[12]).toBe(9);
    expect(packet[14]).toBe(0x12);
    expect(packet[15]).toBe(3);
    expect(packet[16]).toBe(0);
    expect(packet[17]).toBe(3);
    expect([...packet.subarray(18)]).toEqual([1, 2, 3]);
  });

  it("base64-encodes binary payloads", () => {
    expect(binaryToBase64(new Uint8Array([0, 1, 2, 255]))).toBe("AAEC/w==");
  });

  it("base64-decodes binary payloads", () => {
    expect([...base64ToBinary("AAEC/w==")]).toEqual([0, 1, 2, 255]);
  });

  it("publishes binary envelopes expected by the gateway", () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const client = new DataNet({ apiKey: "ak_test" });
    const send = vi.fn();
    (client as unknown as { ws: { readyState: number; send: (payload: string) => void } }).ws = {
      readyState: 1,
      send,
    };

    client.publishBinary("demo.lighting.dmx", new Uint8Array([1, 2, 3]), {
      contentType: "binary/dmx",
      metadata: { universe: 1 },
    });

    expect(send).toHaveBeenCalledWith(JSON.stringify({
      op: "pub",
      ch: "demo.lighting.dmx",
      bin: true,
      b64: "AQID",
      ct: "binary/dmx",
      meta: { universe: 1 },
    }));
    vi.unstubAllGlobals();
  });

  it("auto-detects binary data passed to publish()", () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const client = new DataNet({ apiKey: "ak_test" });
    const send = vi.fn();
    (client as unknown as { ws: { readyState: number; send: (payload: string) => void } }).ws = {
      readyState: 1,
      send,
    };

    client.publish("demo.lighting.dmx", new Uint8Array([4, 5]), {
      contentType: "binary/dmx",
      metadata: { universe: 2 },
    });

    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      op: "pub",
      ch: "demo.lighting.dmx",
      bin: true,
      b64: "BAU=",
      ct: "binary/dmx",
      meta: { universe: 2 },
    });
    vi.unstubAllGlobals();
  });

  it("delivers metadata-bearing binary envelopes to binary and any subscribers", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const binaryHandler = vi.fn();
    const anyHandler = vi.fn();

    client.subscribeBinary("demo.lighting.dmx", binaryHandler);
    client.subscribeAny("demo.lighting.dmx", anyHandler);

    const handled = (client as unknown as { handleMessage(raw: string): boolean }).handleMessage(JSON.stringify({
      op: "pub",
      ch: "demo.lighting.dmx",
      bin: true,
      b64: "AQID",
      ct: "binary/dmx",
      bytes: 3,
      ts: 123,
      from: "browser-controller",
      meta: { universe: 1 },
    }));

    expect(handled).toBe(true);
    expect([...binaryHandler.mock.calls[0][0]]).toEqual([1, 2, 3]);
    expect(binaryHandler.mock.calls[0][1]).toEqual({
      channel: "demo.lighting.dmx",
      from: "browser-controller",
      timestamp: 123,
      contentType: "binary/dmx",
      bytes: 3,
      metadata: { universe: 1 },
    });
    expect(anyHandler.mock.calls[0][0]).toMatchObject({
      kind: "binary",
      meta: { contentType: "binary/dmx", metadata: { universe: 1 } },
    });
  });

  it("publishes DMX and Art-Net helper payloads as binary", () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const client = new DataNet({ apiKey: "ak_test" });
    const send = vi.fn();
    (client as unknown as { ws: { readyState: number; send: (payload: string) => void } }).ws = {
      readyState: 1,
      send,
    };

    client.publishDmx("demo.lighting.dmx", [255, 0], { length: 2 });
    client.publishArtNet("demo.lighting.artnet", [255, 0], { universe: 1 });

    const dmxEnvelope = JSON.parse(send.mock.calls[0][0]);
    const artnetEnvelope = JSON.parse(send.mock.calls[1][0]);
    expect(dmxEnvelope).toMatchObject({ bin: true, ct: "binary/dmx", b64: "/wA=" });
    expect(artnetEnvelope).toMatchObject({ bin: true, ct: "binary/artnet" });
    vi.unstubAllGlobals();
  });
});
