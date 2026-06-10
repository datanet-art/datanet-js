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

export type MessageHandler = (data: unknown, meta: MessageMeta) => void;
type EventHandler = (...args: unknown[]) => void;

export interface DataNetErrorDetails {
  code: string;
  message: string;
  channel?: string;
  retryMs?: number;
  scope?: string;
  status?: number;
}

export class DataNetError extends Error {
  readonly code: string;
  readonly channel?: string;
  readonly retryMs?: number;
  readonly scope?: string;
  readonly status?: number;

  constructor(details: DataNetErrorDetails) {
    super(details.message);
    this.name = "DataNetError";
    this.code = details.code;
    this.channel = details.channel;
    this.retryMs = details.retryMs;
    this.scope = details.scope;
    this.status = details.status;
  }
}

interface Envelope {
  op: string;
  ch?: string;
  d?: unknown;
  from?: string;
  ts?: number;
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
        const data = event.data as string | ArrayBuffer | Blob;
        const finish = (text: string) => {
          if (!handshakeComplete) {
            try {
              const msg = JSON.parse(text) as Record<string, unknown>;
              if (msg.type === "connected") {
                handshakeComplete = true;
                this.handlers.forEach((_, ch) => this.send({ op: "sub", ch }));
                this.emit("connect");
                resolve();
                return;
              }
              if (msg.type === "error" && msg.error) {
                const err = this.toGatewayError(msg);
                this.emit("error", err);
                reject(err);
                return;
              }
            } catch {
              // Ignore parse errors here and let the normal handler deal with them.
            }
          }
          this.handleMessage(text);
        };

        if (typeof data === "string") {
          finish(data);
        } else if (data instanceof ArrayBuffer) {
          finish(new TextDecoder().decode(data));
        } else if (data instanceof Blob) {
          void data.text().then((text) => finish(text));
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

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // Pub/sub message
    if (msg.op === "pub" && msg.ch) {
      const set = this.handlers.get(msg.ch as string);
      if (set) {
        const meta: MessageMeta = {
          channel: msg.ch as string,
          from: (msg.from as string) ?? "",
          timestamp: (msg.ts as number) ?? Date.now(),
        };
        set.forEach((h) => h(msg.d, meta));
      }
    }

    // Gateway-level errors (e.g. channel_not_allowed)
    if (msg.type === "error" && msg.error) {
      this.emit("error", this.toGatewayError(msg));
    }
  }

  private toGatewayError(msg: Record<string, unknown>): DataNetError {
    const code = String(msg.code ?? msg.error ?? "gateway_error");
    const channel = typeof msg.channel === "string" ? msg.channel : typeof msg.ch === "string" ? msg.ch : undefined;
    const retryMs = typeof msg.retry_ms === "number" ? msg.retry_ms : undefined;
    const scope = typeof msg.scope === "string" ? msg.scope : undefined;
    return new DataNetError({
      code,
      channel,
      retryMs,
      scope,
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
      const payload = JSON.parse(atob(token.split(".")[1])) as { exp?: number };
      return typeof payload.exp === "number" ? payload.exp : null;
    } catch {
      return null;
    }
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
  publish(channel: string, data: unknown): this {
    this.send({ op: "pub", ch: channel, d: data });
    return this;
  }

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
