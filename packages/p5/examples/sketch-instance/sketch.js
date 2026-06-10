/**
 * DataNet p5.js example — Instance Mode
 *
 * Same live scatter plot as the global-mode example, but written using the
 * p5.js instance-mode pattern (new p5(function(p) { ... })). This approach
 * is preferred when you have multiple sketches on a page, or when you want to
 * avoid polluting the global namespace.
 *
 * Usage: include p5.js, datanet-p5.js, then this file in your HTML.
 *
 * Replace API_KEY and CHANNEL with your own values.
 */

// ── Configuration ──────────────────────────────────────────────────────────
var API_KEY = 'ak_your_api_key_here';
var CHANNEL = 'project.your_project_id.sensor';

// ── Sketch ─────────────────────────────────────────────────────────────────
var sketch = function (p) {

  // Constants local to this sketch.
  var MAX_DOTS     = 300;
  var DOT_LIFETIME = 8000;  // ms
  var CANVAS_W     = 700;
  var CANVAS_H     = 500;
  var PAD          = 50;

  // Sketch state.
  var dn;
  var dots        = [];
  var msgCount    = 0;
  var statusText  = 'Connecting…';
  var statusHue   = 30;   // HSB hue for the status badge
  var lastTouchAt = 0;

  function getCanvasSize() {
    var container = document.getElementById('sketch-instance-container');
    var width = 700;
    var height = 500;

    if (container) {
      width = container.clientWidth || width;
      height = container.clientHeight || height;
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        var styles = window.getComputedStyle(container);
        width -= parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
        height -= parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      }
    } else if (typeof window !== 'undefined') {
      width = window.innerWidth || width;
      height = window.innerHeight || height;
    }

    return {
      width: Math.max(320, Math.floor(width)),
      height: Math.max(260, Math.floor(height)),
    };
  }

  function applyCanvasSize(width, height) {
    CANVAS_W = width;
    CANVAS_H = height;
  }

  function lockPageTouch(canvas) {
    if (typeof document !== 'undefined') {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      document.body.style.touchAction = 'none';
    }
    if (canvas && canvas.elt) {
      canvas.elt.style.display = 'block';
      canvas.elt.style.touchAction = 'none';
    }
  }

  function addDataDot(nx, ny, source) {
    dots.push({
      px:     p.map(nx, 0, 1, PAD, CANVAS_W - PAD),
      py:     p.map(ny, 0, 1, CANVAS_H - PAD, PAD),
      born:   p.millis(),
      hue:    p.map(nx, 0, 1, 180, 310),
      source: source,
    });

    if (dots.length > MAX_DOTS) dots.shift();
  }

  // ── p5 lifecycle ───────────────────────────────────────────────────────

  p.setup = function () {
    var size = getCanvasSize();
    applyCanvasSize(size.width, size.height);
    var canvas = p.createCanvas(CANVAS_W, CANVAS_H);
    lockPageTouch(canvas);
    // Attach to a specific container element if present, otherwise let p5
    // place it in the body.
    var container = document.getElementById('sketch-instance-container');
    if (container) canvas.parent(container);

    p.colorMode(p.HSB, 360, 100, 100, 100);

    // Seed a few animated placeholder dots.
    for (var i = 0; i < 10; i++) {
      dots.push({
        px:   p.random(PAD, CANVAS_W - PAD),
        py:   p.random(PAD, CANVAS_H - PAD),
        born: p.millis() - p.random(0, DOT_LIFETIME * 0.6),
        hue:  p.random(180, 320),
      });
    }

    // ── DataNet ───────────────────────────────────────────────────────────
    // In instance mode, createDataNet is available on the p5 instance (p).
    // It automatically registers a cleanup hook that closes the socket when
    // the sketch is removed.
    dn = p.createDataNet(API_KEY /*, { debug: true } */);

    dn.on('connect', function () {
      statusText = 'Connected';
      statusHue  = 120;

      dn.subscribe(CHANNEL, function (data, meta) {
        var nx = p.constrain(data.x != null ? data.x : p.random(), 0, 1);
        var ny = p.constrain(data.y != null ? data.y : p.random(), 0, 1);

        addDataDot(nx, ny, data.source || 'network');
        msgCount++;
      });
    });

    dn.on('disconnect', function () {
      statusText = 'Disconnected — reconnecting…';
      statusHue  = 30;
    });

    dn.on('error', function (err) {
      statusText = 'Error: ' + err.message;
      statusHue  = 0;
      console.error('[DataNet]', err);
    });

    dn.connect();
  };

  p.draw = function () {
    p.background(240, 30, 8);
    drawAxes();
    drawDots();
    drawHUD();
  };

  p.windowResized = function () {
    var size = getCanvasSize();
    applyCanvasSize(size.width, size.height);
    p.resizeCanvas(CANVAS_W, CANVAS_H);
  };

  // ── Drawing helpers ──────────────────────────────────────────────────────

  function drawAxes() {
    p.stroke(0, 0, 25);
    p.strokeWeight(1);
    p.noFill();
    p.rect(PAD, PAD, CANVAS_W - 2 * PAD, CANVAS_H - 2 * PAD);

    p.drawingContext.setLineDash([4, 8]);
    var steps = 4;
    for (var i = 1; i < steps; i++) {
      var gx = p.map(i, 0, steps, PAD, CANVAS_W - PAD);
      var gy = p.map(i, 0, steps, PAD, CANVAS_H - PAD);
      p.line(gx, PAD, gx, CANVAS_H - PAD);
      p.line(PAD, gy, CANVAS_W - PAD, gy);
    }
    p.drawingContext.setLineDash([]);

    p.fill(0, 0, 55);
    p.noStroke();
    p.textSize(10);
    p.textAlign(p.CENTER, p.TOP);
    p.text('x →', CANVAS_W / 2, CANVAS_H - PAD + 8);
    p.textAlign(p.RIGHT, p.CENTER);
    p.push();
    p.translate(PAD - 10, CANVAS_H / 2);
    p.rotate(-p.HALF_PI);
    p.text('y →', 0, 0);
    p.pop();
  }

  function drawDots() {
    var now = p.millis();
    for (var i = dots.length - 1; i >= 0; i--) {
      var d       = dots[i];
      var age     = now - d.born;
      if (age > DOT_LIFETIME) { dots.splice(i, 1); continue; }

      var progress = age / DOT_LIFETIME;
      var alpha    = 100 * (1 - progress * progress);
      var r        = p.lerp(14, 4, progress);

      p.noStroke();
      p.fill(d.hue, 70, 90, alpha * 0.3);
      p.ellipse(d.px, d.py, r * 3, r * 3);
      p.fill(d.hue, 60, 100, alpha);
      p.ellipse(d.px, d.py, r, r);
    }
  }

  function drawHUD() {
    // Status bar background.
    p.noStroke();
    p.fill(0, 0, 10, 70);
    p.rect(PAD - 2, 8, CANVAS_W - 2 * PAD + 4, 26, 6);

    // Status text.
    p.fill(statusHue, 70, 90);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(11);
    p.text(statusText, PAD + 6, 21);

    // Mode label (so it's clear this is the instance-mode sketch).
    p.textAlign(p.RIGHT, p.CENTER);
    p.fill(0, 0, 50);
    p.text('instance mode  |  msgs: ' + msgCount + '  dots: ' + dots.length,
           CANVAS_W - PAD - 4, 21);

    // Buffer stats pulled from the DataNet client.
    var buf = dn.getBuffer(CHANNEL, 10);
    if (buf.length > 0) {
      p.fill(0, 0, 40);
      p.textAlign(p.LEFT, p.BOTTOM);
      p.textSize(9);
      p.text('last 10 buf: ' + buf.length + ' entries', PAD, CANVAS_H - 4);
    }
  }

  // ── Interaction controls ─────────────────────────────────────────────────

  function publishPointFromCanvas(px, py, source) {
    var nx = p.constrain(p.map(px, PAD, CANVAS_W - PAD, 0, 1), 0, 1);
    var ny = p.constrain(p.map(py, CANVAS_H - PAD, PAD, 0, 1), 0, 1);

    addDataDot(nx, ny, source);

    if (dn && dn.isConnected()) {
      dn.publish(CHANNEL, {
        x: nx,
        y: ny,
        source: source,
      });
    }
  }

  function publishPointerPoint(source) {
    if (p.mouseX < 0 || p.mouseX > CANVAS_W || p.mouseY < 0 || p.mouseY > CANVAS_H) return;
    publishPointFromCanvas(p.mouseX, p.mouseY, source);
  }

  p.mousePressed = function () {
    if (Date.now() - lastTouchAt < 500) return;
    publishPointerPoint('mouse');
  };

  p.mouseDragged = function () {
    if (Date.now() - lastTouchAt < 500) return;
    publishPointerPoint('mouse-drag');
  };

  p.touchStarted = function () {
    lastTouchAt = Date.now();
    publishPointerPoint('touch');
    return false;
  };

  p.touchMoved = function () {
    lastTouchAt = Date.now();
    publishPointerPoint('touch-drag');
    return false;
  };

  p.keyPressed = function () {
    if (!dn) return;

    if (p.key === 'c' || p.key === 'C') dots = [];

    if (p.key === 'd' || p.key === 'D') {
      dn.disconnect();
      statusText = 'Disconnected';
      statusHue  = 30;
    }

    if (p.key === 'r' || p.key === 'R') dn.connect();

    // Spacebar: publish a synthetic point for quick testing.
    if (p.key === ' ') {
      var nx = p.random();
      var ny = p.random();
      addDataDot(nx, ny, 'keyboard');

      if (dn.isConnected()) {
        dn.publish(CHANNEL, { x: nx, y: ny, source: 'keyboard' });
      }
    }
  };
};

// ── Mount the sketch ────────────────────────────────────────────────────────
// Instance mode: pass the sketch function to the p5 constructor.
// The sketch will attach to #sketch-instance-container if present, otherwise
// it appends a canvas to <body>.
new p5(sketch);
