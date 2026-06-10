/**
 * datanet-p5.js — DataNet addon library for p5.js
 *
 * Provides p5.js-friendly access to the SJS DataNet realtime pub/sub platform.
 * Works in both global mode and instance mode.
 *
 * Global mode:
 *   const dn = window.createDataNet("ak_...");
 *   dn.connect();
 *   dn.subscribe("project.abc.temp", (data, meta) => { ... });
 *
 * Instance mode:
 *   new p5(function(p) {
 *     let dn;
 *     p.setup = function() {
 *       dn = p.createDataNet("ak_...");
 *       dn.connect();
 *     };
 *   });
 *
 * Protocol:
 *   - Auth: POST /auth/token with {apiKey} → {token}
 *   - WebSocket: Sec-WebSocket-Protocol: bearer, <jwt>
 *   - Envelopes: {op, ch?, d?}  ops: sub | unsub | pub | hb
 *   - Heartbeat every 30 s
 *   - Auto-reconnect on disconnect (exponential backoff, max 5 attempts)
 *
 * Version: 0.1.0
 * Platform: https://datanet.art
 */

(function (root, factory) {
  /* UMD wrapper — works as a <script> tag, CommonJS require(), or ES module.
   *
   * Note: the AMD and CJS branches are intentionally gated on
   * `typeof window === 'undefined'` so browser environments (p5.js web editor,
   * webpack, esbuild) always fall through to the plain browser branch even when
   * define() or module.exports exists. Without this guard, createDataNet may
   * never get registered as a window global.
   */
  if (typeof define === 'function' && define.amd && typeof window === 'undefined') {
    define(['p5'], factory);
  } else if (typeof module === 'object' && module.exports && typeof window === 'undefined') {
    // True Node / CommonJS environment (no window).
    module.exports = factory(require('p5'));
  } else {
    // Browser <script> tag, p5.js web editor, or any bundler running in browser.
    factory(root.p5 || (typeof p5 !== 'undefined' ? p5 : null));
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (p5) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  var DEFAULT_API_URL            = 'https://api.datanet.art';
  var DEFAULT_WS_URL             = 'wss://ws.datanet.art/ws';
  var HEARTBEAT_INTERVAL_MS      = 30000;
  var DEFAULT_BUFFER_LENGTH      = 100;
  var DEFAULT_MAX_RECONNECT      = 5;

  // ── DataNetP5 class ────────────────────────────────────────────────────────

  /**
   * DataNetP5
   *
   * The main client object. Obtain one via createDataNet() or p.createDataNet().
   * Do not instantiate directly.
   *
   * @param {string}  apiKey   DataNet API key (starts with ak_).
   * @param {object}  options
   * @param {string}  [options.apiUrl]              Override HTTP base URL.
   * @param {string}  [options.wsUrl]               Override WebSocket URL.
   * @param {boolean} [options.debug]               Log protocol messages to console.
   * @param {number}  [options.maxReconnectAttempts] Max reconnect attempts (default 5).
   */
  function DataNetP5(apiKey, options) {
    var opts = options || {};

    this._apiKey  = apiKey;
    this._apiUrl  = (opts.apiUrl  || DEFAULT_API_URL).replace(/\/$/, '');
    this._wsUrl   = opts.wsUrl   || DEFAULT_WS_URL;
    this._debug   = !!opts.debug;
    this._maxReconnectAttempts = typeof opts.maxReconnectAttempts === 'number'
      ? opts.maxReconnectAttempts
      : DEFAULT_MAX_RECONNECT;

    // Connection state.
    this._jwt       = null;
    this._ws        = null;
    this._connected = false;
    this._closing   = false;   // true after explicit disconnect()

    // Reconnect attempt tracking.
    this._reconnectAttempts = 0;

    // Per-channel subscriber map: channel → [fn, ...]
    this._listeners = {};

    // Per-channel message buffers: channel → [{data, from, timestamp}, ...]
    this._buffers = {};

    // Per-channel counters.
    this._counts = {};

    // Most recent message per channel.
    this._last = {};

    // Event handlers map: event → [fn, ...]
    this._eventHandlers = {
      connect:    [],
      disconnect: [],
      error:      [],
    };

    // Heartbeat timer handle.
    this._hbTimer = null;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  /**
   * Authenticate and open the WebSocket.
   *
   * Authentication is asynchronous. The "connect" event fires when the
   * socket is open and all pending subscriptions have been sent.
   *
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.connect = function () {
    var self = this;
    self._closing = false;
    self._reconnectAttempts = 0;

    self._fetchToken()
      .then(function (jwt) {
        self._jwt = jwt;
        self._openWebSocket();
      })
      .catch(function (err) {
        self._fireError(err);
      });

    return this;
  };

  /**
   * Close the WebSocket and stop the heartbeat.
   * No automatic reconnect will occur after this call.
   *
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.disconnect = function () {
    this._closing = true;
    this._reconnectAttempts = 0;
    this._stopHeartbeat();
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
    }
    this._connected = false;
    return this;
  };

  /** @returns {boolean} true if the WebSocket is currently open. */
  DataNetP5.prototype.isConnected = function () {
    return this._connected;
  };

  // ── Pub / Sub ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to a channel.
   *
   * @param {string}   channel  Fully-qualified channel name.
   * @param {function} fn       Callback: (data, meta) => void
   *                            where data is the message payload and
   *                            meta = { channel, from, timestamp }.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.subscribe = function (channel, fn) {
    if (!this._listeners[channel]) {
      this._listeners[channel] = [];
    }
    this._listeners[channel].push(fn);

    if (this._connected) {
      this._sendRaw(this._subEnvelope(channel));
    }
    return this;
  };

  /**
   * Remove listeners for a channel and send an unsub message.
   *
   * @param {string}    channel
   * @param {function} [fn]     If provided, remove only this specific handler.
   *                            If omitted, remove all handlers for the channel.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.unsubscribe = function (channel, fn) {
    if (fn && this._listeners[channel]) {
      var fns = this._listeners[channel];
      var idx = fns.indexOf(fn);
      if (idx !== -1) fns.splice(idx, 1);
      // If no handlers remain, clean up and send unsub.
      if (fns.length === 0) {
        delete this._listeners[channel];
        if (this._connected) {
          this._sendRaw(this._unsubEnvelope(channel));
        }
      }
    } else {
      delete this._listeners[channel];
      if (this._connected) {
        this._sendRaw(this._unsubEnvelope(channel));
      }
    }
    return this;
  };

  /**
   * Publish a message to a channel.
   *
   * @param {string} channel  Target channel.
   * @param {object|string} data  JS object or JSON string.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.publish = function (channel, data) {
    if (!this._connected) {
      this._fireError(new Error('DataNet: not connected — call connect() first'));
      return this;
    }
    var payload = typeof data === 'string' ? data : JSON.stringify(data);
    this._sendRaw('{"op":"pub","ch":' + JSON.stringify(channel) + ',"d":' + payload + '}');
    return this;
  };

  // ── Buffer / Query API ─────────────────────────────────────────────────────

  /**
   * Return the last received message for a channel, or null if none.
   *
   * @param {string} channel
   * @returns {{data: object, from: string, timestamp: number}|null}
   */
  DataNetP5.prototype.getLastMessage = function (channel) {
    return this._last[channel] || null;
  };

  /**
   * Return the total number of messages received on a channel since subscribe.
   *
   * @param {string} channel
   * @returns {number}
   */
  DataNetP5.prototype.getMessageCount = function (channel) {
    return this._counts[channel] || 0;
  };

  /**
   * Return a circular buffer of the last N messages for a channel.
   * Useful for drawing sparklines or scrolling graphs inside draw().
   *
   * @param {string} channel
   * @param {number} [maxLength=100]  Maximum messages to keep.
   * @returns {Array<{data: object, from: string, timestamp: number}>}
   */
  DataNetP5.prototype.getBuffer = function (channel, maxLength) {
    var len = typeof maxLength === 'number' ? maxLength : DEFAULT_BUFFER_LENGTH;
    var buf = this._buffers[channel];
    if (!buf) return [];
    // Return the last `len` messages (most recent at the end).
    return buf.slice(-len);
  };

  // ── Event API ──────────────────────────────────────────────────────────────

  /**
   * Register a handler for a lifecycle event.
   *
   * @param {string}   event  One of: "connect", "disconnect", "error"
   * @param {function} fn     Handler function.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.on = function (event, fn) {
    if (this._eventHandlers[event]) {
      this._eventHandlers[event].push(fn);
    }
    return this;
  };

  /**
   * Remove a previously registered event handler.
   *
   * @param {string}   event  One of: "connect", "disconnect", "error"
   * @param {function} fn     The exact handler function to remove.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.off = function (event, fn) {
    if (this._eventHandlers[event]) {
      var handlers = this._eventHandlers[event];
      var idx = handlers.indexOf(fn);
      if (idx !== -1) handlers.splice(idx, 1);
    }
    return this;
  };

  // ── Callbacks (legacy aliases) ─────────────────────────────────────────────

  /**
   * Register a callback that fires when the WebSocket opens.
   * @deprecated Use on("connect", fn) instead.
   * @param {function} fn
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.onConnect = function (fn) {
    return this.on('connect', fn);
  };

  /**
   * Register a callback that fires when the WebSocket closes unexpectedly.
   * @deprecated Use on("disconnect", fn) instead.
   * @param {function} fn
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.onDisconnect = function (fn) {
    return this.on('disconnect', fn);
  };

  /**
   * Register a callback for errors (auth, parse, etc.).
   * @deprecated Use on("error", fn) instead.
   * @param {function} fn  Receives an Error object.
   * @returns {DataNetP5} this (chainable)
   */
  DataNetP5.prototype.onError = function (fn) {
    return this.on('error', fn);
  };

  // ── connected property ─────────────────────────────────────────────────────

  Object.defineProperty(DataNetP5.prototype, 'connected', {
    get: function () { return this._connected; },
    enumerable: true,
    configurable: true,
  });

  // ── Internal — Auth ────────────────────────────────────────────────────────

  DataNetP5.prototype._fetchToken = function () {
    var self = this;
    var url  = self._apiUrl + '/auth/token';
    var body = JSON.stringify({ apiKey: self._apiKey });

    return fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    body,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('DataNet auth failed — HTTP ' + res.status + ': ' + text);
        });
      }
      return res.json();
    }).then(function (json) {
      if (json.error) {
        throw new Error('DataNet auth failed — ' + json.error);
      }
      if (!json.token) {
        throw new Error('DataNet auth response missing token field');
      }
      self._log('auth ok — token received');
      return json.token;
    });
  };

  // ── Internal — WebSocket ───────────────────────────────────────────────────

  DataNetP5.prototype._openWebSocket = function () {
    var self = this;

    try {
      // Pass JWT in the subprotocol header as expected by the DataNet gateway.
      var ws = new WebSocket(self._wsUrl, ['bearer', self._jwt]);

      ws.onopen = function () {
        self._ws        = ws;
        self._connected = true;
        self._reconnectAttempts = 0;
        self._log('WebSocket open');

        // Re-send subscriptions (handles reconnect scenario).
        Object.keys(self._listeners).forEach(function (ch) {
          self._sendRaw(self._subEnvelope(ch));
        });

        self._startHeartbeat();

        self._fireEvent('connect');
      };

      ws.onmessage = function (event) {
        var data = event.data;

        if (typeof data === 'string') {
          self._handleMessage(data);
          return;
        }

        if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
          self._handleMessage(new TextDecoder().decode(data));
          return;
        }

        if (typeof Blob !== 'undefined' && data instanceof Blob) {
          data.text()
            .then(function (text) {
              self._handleMessage(text);
            })
            .catch(function (err) {
              self._fireError(err instanceof Error ? err : new Error('DataNet: failed to read Blob message'));
            });
          return;
        }

        self._fireError(new Error('DataNet: unsupported message type'));
      };

      ws.onclose = function (event) {
        self._connected = false;
        self._stopHeartbeat();
        self._log('WebSocket closed — code ' + event.code);

        self._fireEvent('disconnect');

        if (!self._closing) {
          var attempt = self._reconnectAttempts;
          if (attempt >= self._maxReconnectAttempts) {
            self._fireError(new Error(
              'DataNet: max reconnect attempts (' + self._maxReconnectAttempts + ') reached'
            ));
            return;
          }
          self._reconnectAttempts = attempt + 1;
          var delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          self._log('reconnecting in ' + delay + 'ms (attempt ' + self._reconnectAttempts + ')…');
          setTimeout(function () {
            if (!self._closing) {
              self._fetchToken()
                .then(function (jwt) {
                  self._jwt = jwt;
                  self._openWebSocket();
                })
                .catch(function (err) {
                  self._fireError(err);
                });
            }
          }, delay);
        }
      };

      ws.onerror = function (event) {
        // WebSocket error events carry no useful message in the browser; the
        // close event that follows will have the real code.
        self._fireError(new Error('DataNet WebSocket error'));
      };

    } catch (err) {
      self._fireError(err);
    }
  };

  DataNetP5.prototype._handleMessage = function (raw) {
    var self = this;
    var env;

    try {
      env = JSON.parse(raw);
    } catch (e) {
      self._fireError(new Error('DataNet: could not parse message: ' + raw));
      return;
    }

    self._log('recv', env);

    if (env.op !== 'pub') return;  // ignore sub-acks, hb-acks

    var channel   = env.ch   || '';
    var data      = env.d    || {};
    var from      = env.from || '';
    var timestamp = env.ts   || 0;

    // Store in per-channel buffer.
    if (!self._buffers[channel]) self._buffers[channel] = [];
    var entry = { data: data, from: from, timestamp: timestamp };
    self._buffers[channel].push(entry);

    // Trim buffer to DEFAULT_BUFFER_LENGTH to avoid unbounded growth.
    // (getBuffer() callers can request shorter slices.)
    if (self._buffers[channel].length > DEFAULT_BUFFER_LENGTH) {
      self._buffers[channel].shift();
    }

    // Update last & count.
    self._last[channel] = entry;
    self._counts[channel] = (self._counts[channel] || 0) + 1;

    // Dispatch to all registered listeners for this channel.
    var fns = self._listeners[channel];
    if (fns) {
      var meta = { channel: channel, from: from, timestamp: timestamp };
      fns.forEach(function (fn) {
        try { fn(data, meta); } catch (err) { self._fireError(err); }
      });
    }
  };

  // ── Internal — Heartbeat ───────────────────────────────────────────────────

  DataNetP5.prototype._startHeartbeat = function () {
    var self = this;
    self._stopHeartbeat();
    self._hbTimer = setInterval(function () {
      if (self._connected) {
        self._sendRaw('{"op":"hb"}');
        self._log('heartbeat sent');
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  DataNetP5.prototype._stopHeartbeat = function () {
    if (this._hbTimer !== null) {
      clearInterval(this._hbTimer);
      this._hbTimer = null;
    }
  };

  // ── Internal — Helpers ─────────────────────────────────────────────────────

  DataNetP5.prototype._sendRaw = function (json) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(json);
      this._log('send', json);
    }
  };

  DataNetP5.prototype._subEnvelope = function (channel) {
    return '{"op":"sub","ch":' + JSON.stringify(channel) + '}';
  };

  DataNetP5.prototype._unsubEnvelope = function (channel) {
    return '{"op":"unsub","ch":' + JSON.stringify(channel) + '}';
  };

  DataNetP5.prototype._fireEvent = function (event) {
    var handlers = this._eventHandlers[event];
    if (handlers) {
      handlers.forEach(function (fn) {
        try { fn(); } catch (_) {}
      });
    }
  };

  DataNetP5.prototype._fireError = function (err) {
    var handlers = this._eventHandlers.error;
    if (handlers && handlers.length > 0) {
      handlers.forEach(function (fn) {
        try { fn(err); } catch (_) {}
      });
    } else {
      console.error('[DataNet]', err);
    }
  };

  DataNetP5.prototype._log = function () {
    if (this._debug) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[DataNet]');
      console.log.apply(console, args);
    }
  };

  // ── p5.js addon registration ───────────────────────────────────────────────

  /**
   * Factory function attached to both p5.prototype (instance mode) and
   * window (global mode).
   *
   * @param {string}  apiKey   DataNet API key.
   * @param {object}  [options]
   * @param {string}  [options.apiUrl]               Custom API base URL.
   * @param {string}  [options.wsUrl]                Custom WebSocket URL.
   * @param {boolean} [options.debug]                Enable protocol logging.
   * @param {number}  [options.maxReconnectAttempts]  Max reconnect attempts (default 5).
   * @returns {DataNetP5}
   */
  function createDataNet(apiKey, options) {
    /* jshint validthis: true */
    var client = new DataNetP5(apiKey, options);

    // Register cleanup hook so the connection closes when the sketch ends.
    // In instance mode `this` is the p5 instance.
    if (this && typeof this.registerMethod === 'function') {
      var _client = client;
      this.registerMethod('remove', function () {
        _client.disconnect();
      });
    }

    return client;
  }

  // Resolve the p5 constructor: use what was passed in, or fall back to
  // the global (covers p5.js web editor and other bundled browser contexts
  // where the UMD CJS branch may have been skipped).
  var p5constructor = p5 || (typeof window !== 'undefined' && window.p5) || null;
  var browserGlobal = typeof window !== 'undefined'
    ? window
    : (typeof globalThis !== 'undefined' ? globalThis : null);
  var universalGlobal = typeof globalThis !== 'undefined' ? globalThis : browserGlobal;

  if (p5constructor) {
    // Instance mode: p.createDataNet(...)
    p5constructor.prototype.createDataNet = createDataNet;
  }

  // Register a global-mode factory so sketches can call
  // window.createDataNet() even if p5 is not visible at addon-load time.
  if (browserGlobal && typeof browserGlobal.createDataNet !== 'function') {
    browserGlobal.createDataNet = function (apiKey, options) {
      return new DataNetP5(apiKey, options);
    };
  }

  if (universalGlobal && typeof universalGlobal.createDataNet !== 'function') {
    universalGlobal.createDataNet = function (apiKey, options) {
      return new DataNetP5(apiKey, options);
    };
  }

  // Export for module consumers (Node test environments, bundlers, etc.).
  return { DataNetP5: DataNetP5, createDataNet: createDataNet };
}));
