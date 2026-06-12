/**
 * @datanet/p5 — DataNet addon for p5.js
 *
 * Thin wrapper around @datanet/core that registers createDataNet() on
 * p5.prototype (instance mode) and window (global mode), and adds p5-friendly
 * per-channel message buffers for use inside draw().
 *
 * All connection logic, binary encoding, DMX/Art-Net helpers, reconnection,
 * heartbeating, and token refresh are provided by @datanet/core.
 *
 * Global mode:
 *   const dn = createDataNet("ak_...");
 *   dn.connect();
 *   dn.subscribe("project.abc.sensor", (data) => { ... });
 *
 * Instance mode:
 *   new p5((p) => {
 *     let dn;
 *     p.setup = () => { dn = p.createDataNet("ak_..."); dn.connect(); };
 *   });
 */

import {
  DataNet,
  buildDmxFrame,
  buildArtDmxPacket,
} from "@datanet/core";

var DEFAULT_BUFFER_LENGTH = 100;

// ── DataNetP5 ──────────────────────────────────────────────────────────────

/**
 * p5-friendly DataNet client. Wraps DataNet from @datanet/core and adds
 * per-channel message buffers (getLastMessage, getBuffer, getMessageCount)
 * for use inside draw().
 *
 * All pub/sub, binary, DMX, Art-Net, reconnection, and heartbeat behaviour
 * is delegated to the underlying DataNet instance.
 *
 * @param {string} apiKey
 * @param {object} [options]  Same options as DataNet: deviceId, clientId,
 *                            deviceName, apiUrl, wsUrl, debug,
 *                            maxReconnectAttempts
 */
function DataNetP5(apiKey, options) {
  var opts = options || {};
  this._dn = new DataNet({
    apiKey:      apiKey,
    deviceId:    opts.deviceId   || undefined,
    clientId:    opts.clientId   || undefined,
    deviceName:  opts.deviceName || undefined,
    apiUrl:      opts.apiUrl     || undefined,
    wsUrl:       opts.wsUrl      || undefined,
    maxReconnectAttempts: typeof opts.maxReconnectAttempts === 'number'
      ? opts.maxReconnectAttempts
      : undefined,
  });

  // Per-channel message buffers for draw() helpers.
  this._buffers = {};
  this._counts  = {};
  this._last    = {};

  // Internal per-channel buffer-tracking handlers so we can remove them on unsubscribe.
  this._bufferHandlers = {};
}

// ── Connection ─────────────────────────────────────────────────────────────

DataNetP5.prototype.connect = function () {
  this._dn.connect().catch(function () {
    // errors are emitted on the "error" event
  });
  return this;
};

DataNetP5.prototype.disconnect = function () {
  this._dn.disconnect();
  return this;
};

DataNetP5.prototype.isConnected = function () {
  return this._dn.connected;
};

Object.defineProperty(DataNetP5.prototype, 'connected', {
  get: function () { return this._dn.connected; },
  enumerable: true,
  configurable: true,
});

// ── Events ─────────────────────────────────────────────────────────────────

DataNetP5.prototype.on = function (event, handler) {
  this._dn.on(event, handler);
  return this;
};

DataNetP5.prototype.off = function (event, handler) {
  this._dn.off(event, handler);
  return this;
};

// Legacy aliases — deprecated, use on()/off() instead.
DataNetP5.prototype.onConnect    = function (fn) { return this.on('connect',    fn); };
DataNetP5.prototype.onDisconnect = function (fn) { return this.on('disconnect', fn); };
DataNetP5.prototype.onError      = function (fn) { return this.on('error',      fn); };

// ── JSON pub / sub ─────────────────────────────────────────────────────────

DataNetP5.prototype.subscribe = function (channel, handler) {
  var self = this;

  // Attach a single buffer-tracking handler per channel on first subscribe.
  if (!self._bufferHandlers[channel]) {
    var bufferHandler = function (data, meta) {
      var entry = { data: data, from: meta.from, timestamp: meta.timestamp };
      if (!self._buffers[channel]) self._buffers[channel] = [];
      self._buffers[channel].push(entry);
      if (self._buffers[channel].length > DEFAULT_BUFFER_LENGTH) {
        self._buffers[channel].shift();
      }
      self._last[channel]   = entry;
      self._counts[channel] = (self._counts[channel] || 0) + 1;
    };
    self._bufferHandlers[channel] = bufferHandler;
    self._dn.subscribe(channel, bufferHandler);
  }

  self._dn.subscribe(channel, handler);
  return self;
};

DataNetP5.prototype.unsubscribe = function (channel, handler) {
  this._dn.unsubscribe(channel, handler);
  return this;
};

DataNetP5.prototype.publish = function (channel, data) {
  this._dn.publish(channel, data);
  return this;
};

// ── Binary pub / sub ───────────────────────────────────────────────────────

DataNetP5.prototype.publishBinary = function (channel, data, options) {
  this._dn.publishBinary(channel, data, options);
  return this;
};

DataNetP5.prototype.subscribeBinary = function (channel, handler, options) {
  this._dn.subscribeBinary(channel, handler, options);
  return this;
};

DataNetP5.prototype.unsubscribeBinary = function (channel, handler) {
  this._dn.unsubscribeBinary(channel, handler);
  return this;
};

DataNetP5.prototype.subscribeAny = function (channel, handler) {
  this._dn.subscribeAny(channel, handler);
  return this;
};

DataNetP5.prototype.unsubscribeAny = function (channel, handler) {
  this._dn.unsubscribeAny(channel, handler);
  return this;
};

// ── DMX / Art-Net ──────────────────────────────────────────────────────────

DataNetP5.prototype.publishDmx = function (channel, values, options) {
  this._dn.publishDmx(channel, values, options);
  return this;
};

DataNetP5.prototype.publishArtNet = function (channel, dmx, options) {
  this._dn.publishArtNet(channel, dmx, options);
  return this;
};

// ── Buffer / query helpers (p5-specific) ───────────────────────────────────

DataNetP5.prototype.getLastMessage = function (channel) {
  return this._last[channel] || null;
};

DataNetP5.prototype.getMessageCount = function (channel) {
  return this._counts[channel] || 0;
};

DataNetP5.prototype.getBuffer = function (channel, maxLength) {
  var len = typeof maxLength === 'number' ? maxLength : DEFAULT_BUFFER_LENGTH;
  var buf = this._buffers[channel];
  if (!buf) return [];
  return buf.slice(-len);
};

// ── p5 addon registration ──────────────────────────────────────────────────

function createDataNet(apiKey, options) {
  /* jshint validthis: true */
  var client = new DataNetP5(apiKey, options);

  // In instance mode `this` is the p5 instance — register cleanup so the
  // connection closes when the sketch is removed.
  if (this && typeof this.registerMethod === 'function') {
    var _client = client;
    this.registerMethod('remove', function () { _client.disconnect(); });
  }

  return client;
}

var p5constructor = (typeof p5 !== 'undefined' ? p5 : null) ||
                   (typeof window !== 'undefined' && window.p5) || null;
var browserGlobal = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : null);

if (p5constructor) {
  // p5 automatically promotes p5.prototype methods to window globals in
  // global mode — do not set window.createDataNet manually or p5 will warn
  // about a naming conflict on startup.
  p5constructor.prototype.createDataNet = createDataNet;
} else if (browserGlobal && typeof browserGlobal.createDataNet !== 'function') {
  browserGlobal.createDataNet = function (apiKey, options) {
    return new DataNetP5(apiKey, options);
  };
}

export { DataNetP5, createDataNet, buildDmxFrame, buildArtDmxPacket };
