/**
 * @datanet/core — DataNet JavaScript SDK
 *
 * Lightweight WebSocket client for the DataNet platform (https://datanet.art).
 * Handles authentication, pub/sub, heartbeating, and reconnection.
 *
 * Works in browsers and Node.js. Node 20/21 users must provide a global
 * WebSocket implementation (e.g. `globalThis.WebSocket = WebSocket` from
 * the `ws` package); Node 22+ has one built in.
 */

export interface DataNetOptions {
  /** Your project API key (ak_...) */
  apiKey: string;
  /** Stable device identifier used for device limits and history metadata */
  deviceId?: string;
  /** Optional client/app identifier for connection tracking */
  clientId?: string;
  /** Optional device display name for dashboards/admin tools */
  deviceName?: string;
  /** REST API base URL. Defaults to https://api.datanet.art */
  apiUrl?: string;
  /** WebSocket base URL. Defaults to wss://ws.datanet.art */
  wsUrl?: string;
  /** Max reconnect attempts before giving up. Defaults to 5 */
  maxReconnectAttempts?: number;
}

export interface MessageMeta {
  channel: string;
  from: string;
  timestamp: number;
}

/** Authoritative channel occupancy returned by the DataNet presence API. */
export interface PresenceResult {
  occupancy: number;
  members: string[];
}

export type MessageHandler = (data: unknown, meta: MessageMeta) => void;
export type BinaryData = ArrayBuffer | ArrayBufferView;
export type BinaryContentType =
  | "binary/dmx"
  | "binary/artnet"
  | "application/octet-stream"
  | (string & {});

export interface BinaryMessageMeta {
  channel: string;
  from: string;
  timestamp: number;
  contentType: string;
  bytes: number;
  metadata?: Record<string, unknown>;
}

export type BinaryMessageHandler = (data: Uint8Array, meta: BinaryMessageMeta) => void;

export type AnyMessage =
  | { kind: "json"; data: unknown; meta: MessageMeta }
  | { kind: "binary"; data: Uint8Array; meta: BinaryMessageMeta };

export type AnyMessageHandler = (message: AnyMessage) => void;

export interface PublishOptions {
  contentType?: BinaryContentType;
  metadata?: Record<string, unknown>;
}

export type PublishBinaryOptions = PublishOptions;

export interface SubscribeBinaryOptions {
  contentType?: BinaryContentType;
}

export interface ArtDmxOptions {
  universe?: number;
  subnet?: number;
  net?: number;
  sequence?: number;
  physical?: number;
}

type EventHandler = (...args: unknown[]) => void;

export interface DataNetErrorDetails {
  code: string;
  message: string;
  channel?: string;
  retryMs?: number;
  scope?: string;
  status?: number;
  /** Plan limit that was hit, e.g. device or channel cap (device_limit_reached, topic_limit_reached) */
  limit?: number;
}

export class DataNetError extends Error {
  readonly code: string;
  readonly channel?: string;
  readonly retryMs?: number;
  readonly scope?: string;
  readonly status?: number;
  readonly limit?: number;

  constructor(details: DataNetErrorDetails) {
    super(details.message);
    this.name = "DataNetError";
    this.code = details.code;
    this.channel = details.channel;
    this.retryMs = details.retryMs;
    this.scope = details.scope;
    this.status = details.status;
    this.limit = details.limit;
  }
}

interface Envelope {
  op: string;
  ch?: string;
  d?: unknown;
  from?: string;
  ts?: number;
  bin?: boolean;
  b64?: string;
  ct?: string;
  bytes?: number;
  meta?: Record<string, unknown>;
}

interface DecodedMessageData {
  text: string;
  bytes?: Uint8Array;
}

function clampByte(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

function clampRange(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function toUint8Array(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function isBinaryData(data: unknown): data is BinaryData {
  return data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

export function binaryToBase64(data: BinaryData): string {
  const bytes = toUint8Array(data);
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: "base64"): string } };
  }).Buffer;

  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBinary(encoded: string): Uint8Array {
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: string, encoding: "base64"): Uint8Array };
  }).Buffer;

  if (maybeBuffer) {
    return new Uint8Array(maybeBuffer.from(encoded, "base64"));
  }

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildDmxFrame(values: ArrayLike<number>, length = 512): Uint8Array {
  const frameLength = clampRange(length, 1, 512, 512);
  const frame = new Uint8Array(frameLength);
  const count = Math.min(values.length, frameLength);
  for (let i = 0; i < count; i += 1) {
    frame[i] = clampByte(Number(values[i]));
  }
  return frame;
}

export function buildArtDmxPacket(dmx: BinaryData | ArrayLike<number>, options: ArtDmxOptions = {}): Uint8Array {
  const dmxBytes = ArrayBuffer.isView(dmx) || dmx instanceof ArrayBuffer
    ? toUint8Array(dmx)
    : buildDmxFrame(dmx, Math.min(Math.max(dmx.length, 2), 512));
  const frameLength = clampRange(Math.max(dmxBytes.length, 2), 2, 512, 2);
  const packet = new Uint8Array(18 + frameLength);
  const header = "Art-Net";
  for (let i = 0; i < header.length; i += 1) packet[i] = header.charCodeAt(i);
  packet[7] = 0x00;
  packet[8] = 0x00;
  packet[9] = 0x50;
  packet[10] = 0x00;
  packet[11] = 14;
  packet[12] = clampByte(options.sequence ?? 0);
  packet[13] = clampByte(options.physical ?? 0);

  const universe = clampRange(options.universe ?? 0, 0, 15, 0);
  const subnet = clampRange(options.subnet ?? 0, 0, 15, 0);
  const net = clampRange(options.net ?? 0, 0, 127, 0);
  const portAddress = (subnet << 4) | universe;
  packet[14] = portAddress & 0xff;
  packet[15] = net & 0x7f;
  packet[16] = (frameLength >> 8) & 0xff;
  packet[17] = frameLength & 0xff;
  packet.set(dmxBytes.subarray(0, frameLength), 18);
  return packet;
}

export class DataNet {
  private readonly apiKey: string;
  private readonly deviceId?: string;
  private readonly clientId?: string;
  private readonly deviceName?: string;
  private readonly apiUrl: string;
  private readonly wsUrl: string;
  private readonly maxReconnectAttempts: number;

  private jwt: string | null = null;
  private jwtExpiry: number | null = null; // unix seconds from JWT exp claim
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private binaryHandlers = new Map<string, Set<BinaryMessageHandler>>();
  private anyHandlers = new Map<string, Set<AnyMessageHandler>>();
  private binaryContentTypes = new Map<string, string>();
  private listeners = new Map<string, Set<EventHandler>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  constructor(options: DataNetOptions) {
    this.apiKey = options.apiKey;
    this.deviceId = options.deviceId;
    this.clientId = options.clientId;
    this.deviceName = options.deviceName;
    this.apiUrl = options.apiUrl ?? "https://api.datanet.art";
    this.wsUrl = options.wsUrl ?? "wss://ws.datanet.art";
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  }

  // ── Event emitter ──────────────────────────────────────────────────────────

  on(event: "connect" | "disconnect" | "error", handler: EventHandler): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  /**
   * Authenticate with your API key and open the WebSocket connection.
   * Must be called before subscribe/publish.
   */
  async connect(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          apiKey: this.apiKey,
          ...(this.deviceId ? { deviceId: this.deviceId } : {}),
          ...(this.clientId ? { clientId: this.clientId } : {}),
          ...(this.deviceName ? { deviceName: this.deviceName } : {}),
        }),
      });
    } catch (error) {
      clearTimeout(timeout);
      const err = new Error(
        error instanceof Error && error.name === "AbortError"
          ? "DataNet: authentication timed out"
          : "DataNet: authentication request failed"
      );
      this.emit("error", err);
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: string; code?: string };
        if (body.error) detail = `: ${body.error}`;
      } catch {
        // Ignore malformed error bodies and fall back to status text.
      }
      const err = new DataNetError({
        code: "authentication_failed",
        status: res.status,
        message: `DataNet: authentication failed (${res.status} ${res.statusText})${detail}`,
      });
      this.emit("error", err);
      throw err;
    }

    const json = (await res.json()) as { token: string };
    this.jwt = json.token;
    this.jwtExpiry = this.parseJwtExp(this.jwt);
    this.scheduleTokenRefresh();
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    if (!this.jwt) return Promise.resolve();
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      let handshakeComplete = false;

      // JWT is passed as a WebSocket subprotocol: "bearer <token>"
      const ws = new WebSocket(`${this.wsUrl}/ws`, ["bearer", this.jwt!]);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      });

      ws.addEventListener("message", (event) => {
        const data = event.data as unknown;
        const finish = (text: string): boolean => {
          if (!handshakeComplete) {
            try {
              const msg = JSON.parse(text) as Record<string, unknown>;
              if (msg.type === "connected") {
                handshakeComplete = true;
                this.handlers.forEach((_, ch) => this.send({ op: "sub", ch }));
                this.binaryHandlers.forEach((_, ch) => this.send({ op: "sub", ch }));
                this.anyHandlers.forEach((_, ch) => this.send({ op: "sub", ch }));
                this.emit("connect");
                resolve();
                return true;
              }
              if (msg.type === "error" && msg.error) {
                const err = this.toGatewayError(msg);
                this.emit("error", err);
                reject(err);
                return true;
              }
            } catch {
              // Ignore parse errors here and let the normal handler deal with them.
            }
          }
          return this.handleMessage(text);
        };

        const decoded = this.decodeMessageData(data);
        const receive = ({ text, bytes }: { text: string; bytes?: Uint8Array }) => {
          const handled = finish(text);
          if (!handled && bytes) {
            this.handleBinaryMessage(bytes);
          }
        };

        if (decoded) {
          if (this.isPromise(decoded)) {
            void decoded.then(receive);
          } else {
            receive(decoded);
          }
        }
      });

      ws.addEventListener("close", () => {
        this.stopHeartbeat();
        this.emit("disconnect");
        if (!handshakeComplete) {
          reject(new Error("DataNet: connection closed before handshake completed"));
          return;
        }
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      });

      ws.addEventListener("error", (event) => {
        this.emit("error", event);
        if (!handshakeComplete) {
          reject(new Error("DataNet: websocket connection failed"));
        }
      });
    });
  }

  private isPromise<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T>).then === "function";
  }

  private decodeMessageData(data: unknown): DecodedMessageData | Promise<DecodedMessageData> | null {
    if (typeof data === "string") {
      return { text: data };
    }
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      return { text: new TextDecoder().decode(bytes), bytes };
    }
    if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return { text: new TextDecoder().decode(bytes), bytes };
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return data.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        return { text: new TextDecoder().decode(bytes), bytes };
      });
    }
    return null;
  }

  private handleMessage(raw: string): boolean {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }

    // Pub/sub message
    if (msg.op === "pub" && msg.ch) {
      if (msg.bin === true && typeof msg.b64 === "string") {
        this.handleBinaryEnvelope(msg as unknown as Envelope);
        return true;
      }

      const set = this.handlers.get(msg.ch as string);
      const meta: MessageMeta = {
        channel: msg.ch as string,
        from: (msg.from as string) ?? "",
        timestamp: (msg.ts as number) ?? Date.now(),
      };
      if (set) {
        set.forEach((h) => h(msg.d, meta));
      }
      this.anyHandlers.get(msg.ch as string)?.forEach((handler) => {
        handler({ kind: "json", data: msg.d, meta });
      });
    }

    // Gateway-level errors (e.g. channel_not_allowed)
    if (msg.type === "error" && msg.error) {
      this.emit("error", this.toGatewayError(msg));
    }
    return true;
  }

  private handleBinaryMessage(bytes: Uint8Array): void {
    const channels = new Set([...this.binaryHandlers.keys(), ...this.anyHandlers.keys()]);
    if (channels.size === 0) return;
    if (channels.size > 1) {
      this.emit(
        "error",
        new Error("DataNet: raw binary frame received with multiple binary channels active; raw frames cannot be routed without metadata")
      );
      return;
    }

    const [channel] = channels;
    const meta: BinaryMessageMeta = {
      channel,
      from: "",
      timestamp: Date.now(),
      contentType: this.binaryContentTypes.get(channel) ?? "application/octet-stream",
      bytes: bytes.byteLength,
    };
    this.binaryHandlers.get(channel)?.forEach((handler) => handler(bytes, meta));
    this.anyHandlers.get(channel)?.forEach((handler) => {
      handler({ kind: "binary", data: bytes, meta });
    });
  }

  private handleBinaryEnvelope(msg: Envelope): void {
    if (!msg.ch || !msg.b64) return;
    const channel = msg.ch;
    const bytes = base64ToBinary(msg.b64);
    const meta: BinaryMessageMeta = {
      channel,
      from: msg.from ?? "",
      timestamp: msg.ts ?? Date.now(),
      contentType: msg.ct ?? this.binaryContentTypes.get(channel) ?? "application/octet-stream",
      bytes: typeof msg.bytes === "number" ? msg.bytes : bytes.byteLength,
      metadata: msg.meta,
    };

    this.binaryHandlers.get(channel)?.forEach((handler) => handler(bytes, meta));
    this.anyHandlers.get(channel)?.forEach((handler) => {
      handler({ kind: "binary", data: bytes, meta });
    });
  }

  private toGatewayError(msg: Record<string, unknown>): DataNetError {
    const code = String(msg.code ?? msg.error ?? "gateway_error");
    const channel = typeof msg.channel === "string" ? msg.channel : typeof msg.ch === "string" ? msg.ch : undefined;
    const retryMs = typeof msg.retry_ms === "number" ? msg.retry_ms : undefined;
    const scope = typeof msg.scope === "string" ? msg.scope : undefined;
    const limit = typeof msg.limit === "number" ? msg.limit : undefined;
    return new DataNetError({
      code,
      channel,
      retryMs,
      scope,
      limit,
      message: `DataNet: ${String(msg.error ?? code)}${channel ? ` (${channel})` : ""}`,
    });
  }

  private send(envelope: Envelope): void {
    // The null check must come first: on Node 20/21 there is no global
    // WebSocket until the user installs one, and pre-connect calls like
    // publish() must not touch it.
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: "hb" });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Reconnection ───────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit(
        "error",
        new Error(
          `DataNet: max reconnect attempts (${this.maxReconnectAttempts}) reached`
        )
      );
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s … capped at 30s
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      // Re-auth if JWT is missing or expired; otherwise reuse the existing token
      if (this.jwt && !this.isJwtExpired()) {
        this.openSocket().catch(() => {});
      } else {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  // ── Token refresh ──────────────────────────────────────────────────────────

  /** Decode the exp claim from a JWT without verifying the signature. */
  private parseJwtExp(token: string): number | null {
    try {
      const payload = this.parseJwtPayload(token);
      return typeof payload.exp === "number" ? payload.exp : null;
    } catch {
      return null;
    }
  }

  /** Decode JWT claims without verifying the signature (the gateway verifies it). */
  private parseJwtPayload(token: string): Record<string, unknown> {
    const segment = token.split(".")[1] ?? "";
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  }

  /** True when the stored JWT has expired or will expire within 10 seconds. */
  private isJwtExpired(): boolean {
    if (!this.jwtExpiry) return false;
    return Date.now() >= (this.jwtExpiry - 10) * 1_000;
  }

  /**
   * Schedule a silent token refresh 90 seconds before the JWT expires.
   * This keeps browser keys alive across the 10-minute JWT window without
   * requiring a reconnect. The refreshed JWT is stored and used on the next
   * socket open (active connections are unaffected — the JWT is only checked
   * at WebSocket upgrade time).
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.jwtExpiry) return;
    const refreshAt = (this.jwtExpiry - 90) * 1_000; // 90s before expiry
    const delay = refreshAt - Date.now();
    if (delay <= 0) return;
    this.refreshTimer = setTimeout(() => {
      this.silentRefresh().catch(() => {});
    }, delay);
  }

  private async silentRefresh(): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: this.apiKey,
          ...(this.deviceId ? { deviceId: this.deviceId } : {}),
          ...(this.clientId ? { clientId: this.clientId } : {}),
          ...(this.deviceName ? { deviceName: this.deviceName } : {}),
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { token: string };
      this.jwt = json.token;
      this.jwtExpiry = this.parseJwtExp(this.jwt);
      this.scheduleTokenRefresh();
    } catch {
      // Will retry naturally when the connection drops and reconnect re-auths
    }
  }

  // ── Pub / Sub ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to a channel.
   * @param channel  Channel name as configured in your project (e.g. "sensors/temperature")
   * @param handler  Called with (data, { channel, from, timestamp }) for every message
   */
  subscribe(channel: string, handler: MessageHandler): this {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      // Send sub envelope if already connected; openSocket() will replay if not
      this.send({ op: "sub", ch: channel });
    }
    set.add(handler);
    return this;
  }

  /**
   * Unsubscribe from a channel.
   * If no handler is provided all handlers for that channel are removed.
   */
  unsubscribe(channel: string, handler?: MessageHandler): this {
    if (!handler) {
      this.handlers.delete(channel);
      this.send({ op: "unsub", ch: channel });
    } else {
      const set = this.handlers.get(channel);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(channel);
          this.send({ op: "unsub", ch: channel });
        }
      }
    }
    return this;
  }

  /**
   * Publish a message to a channel.
   * @param channel  Channel name
   * @param data     Any JSON-serialisable value
   */
  publish(channel: string, data: unknown, options: PublishOptions = {}): this {
    if (isBinaryData(data)) {
      return this.publishBinary(channel, data, {
        contentType: options.contentType,
        metadata: options.metadata,
      });
    }
    this.send({ op: "pub", ch: channel, d: data });
    return this;
  }

  /**
   * Return authoritative occupancy for a channel.
   * The client must be connected (and therefore hold a current JWT) first.
   */
  async getPresence(channel: string): Promise<PresenceResult> {
    if (!this.jwt) {
      throw new DataNetError({
        code: "not_connected",
        message: "DataNet: connect before requesting presence",
      });
    }

    let projectId: string | undefined;
    try {
      const pid = this.parseJwtPayload(this.jwt).pid;
      if (typeof pid === "string" && pid) projectId = pid;
    } catch {
      // Canonical project.<pid>.* channels can still be resolved by the API.
    }

    const query = `channel=${encodeURIComponent(channel)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/presence?${query}`, {
        headers: { Authorization: `Bearer ${this.jwt}` },
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "DataNet: presence request timed out"
        : "DataNet: presence request failed";
      throw new DataNetError({ code: "presence_failed", message });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        detail = body.error ?? detail;
      } catch {
        // Fall back to HTTP status text for malformed error bodies.
      }
      throw new DataNetError({
        code: response.status === 403 ? "presence_forbidden" : "presence_failed",
        status: response.status,
        channel,
        message: `DataNet: presence request failed (${response.status}${detail ? ` ${detail}` : ""})`,
      });
    }

    const body = (await response.json()) as { occupancy?: unknown; count?: unknown; members?: unknown };
    const occupancy = typeof body.occupancy === "number"
      ? body.occupancy
      : typeof body.count === "number" ? body.count : 0;
    const members = Array.isArray(body.members)
      ? body.members.filter((member): member is string => typeof member === "string")
      : [];
    return { occupancy, members };
  }

  /**
   * Publish raw bytes to a binary channel. Browsers, Node bridges, and hardware
   * receivers can use this for DMX, Art-Net, sensor frames, and other compact
   * binary payloads.
   */
  publishBinary(channel: string, data: BinaryData, options: PublishBinaryOptions = {}): this {
    this.send({
      op: "pub",
      ch: channel,
      bin: true,
      b64: binaryToBase64(data),
      ct: options.contentType ?? "application/octet-stream",
      meta: options.metadata,
    });
    return this;
  }

  subscribeBinary(channel: string, handler: BinaryMessageHandler, options: SubscribeBinaryOptions = {}): this {
    let set = this.binaryHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.binaryHandlers.set(channel, set);
      if (options.contentType) this.binaryContentTypes.set(channel, options.contentType);
      this.send({ op: "sub", ch: channel });
    }
    set.add(handler);
    return this;
  }

  unsubscribeBinary(channel: string, handler?: BinaryMessageHandler): this {
    if (!handler) {
      this.binaryHandlers.delete(channel);
      this.binaryContentTypes.delete(channel);
      this.send({ op: "unsub", ch: channel });
      return this;
    }

    const set = this.binaryHandlers.get(channel);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.binaryHandlers.delete(channel);
        this.binaryContentTypes.delete(channel);
        this.send({ op: "unsub", ch: channel });
      }
    }
    return this;
  }

  subscribeAny(channel: string, handler: AnyMessageHandler): this {
    let set = this.anyHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.anyHandlers.set(channel, set);
      this.send({ op: "sub", ch: channel });
    }
    set.add(handler);
    return this;
  }

  unsubscribeAny(channel: string, handler?: AnyMessageHandler): this {
    if (!handler) {
      this.anyHandlers.delete(channel);
      this.send({ op: "unsub", ch: channel });
      return this;
    }

    const set = this.anyHandlers.get(channel);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.anyHandlers.delete(channel);
        this.send({ op: "unsub", ch: channel });
      }
    }
    return this;
  }

  publishDmx(channel: string, values: ArrayLike<number>, options: { length?: number } = {}): this {
    return this.publishBinary(channel, buildDmxFrame(values, options.length ?? 512), {
      contentType: "binary/dmx",
    });
  }

  publishArtNet(channel: string, dmx: BinaryData | ArrayLike<number>, options: ArtDmxOptions = {}): this {
    return this.publishBinary(channel, buildArtDmxPacket(dmx, options), {
      contentType: "binary/artnet",
    });
  }

  static toUint8Array = toUint8Array;
  static binaryToBase64 = binaryToBase64;
  static base64ToBinary = base64ToBinary;
  static buildDmxFrame = buildDmxFrame;
  static buildArtDmxPacket = buildArtDmxPacket;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Close the connection. No reconnect will be attempted. */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.jwt = null;
    this.jwtExpiry = null;
  }

  /** True if the WebSocket is currently open */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
