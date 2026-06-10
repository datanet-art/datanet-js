/**
 * DataNet p5.js example — Global Mode
 * Live scatter plot of incoming {x, y} sensor data points.
 *
 * Replace API_KEY and CHANNEL with your own values.
 * Expected message payload: { "x": <0-1 normalized>, "y": <0-1 normalized> }
 *
 * Controls:
 *   C — clear all dots
 *   D — disconnect / R — reconnect
 *   Space, click, tap, or drag — publish a test point
 */

// ── Configuration ──────────────────────────────────────────────────────────
var API_KEY = 'ak_your_api_key_here';
var CHANNEL = 'project.your_project_id.sensor';

// ── Constants ──────────────────────────────────────────────────────────────
var MAX_DOTS     = 300;   // maximum dots on screen at once
var DOT_LIFETIME = 8000;  // ms before a dot fades out
var CANVAS_W     = 700;
var CANVAS_H     = 500;
var PAD          = 50;    // padding inside plot area

// ── State ──────────────────────────────────────────────────────────────────
var dn;
var dots = [];            // [{px, py, born, hue}]
var statusText  = 'Connecting…';
var statusColor;
var msgCount    = 0;
var lastTouchAt = 0;

function getCanvasSize() {
  var container = document.getElementById('sketch-container');
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

// Generate a demo dot so the canvas isn't empty before real data arrives.
function addDemoDot() {
  dots.push({
    px:   random(PAD, CANVAS_W - PAD),
    py:   random(PAD, CANVAS_H - PAD),
    born: millis(),
    hue:  random(180, 280),
    demo: true,
  });
}

function addDataDot(nx, ny, source) {
  dots.push({
    px:     map(nx, 0, 1, PAD, CANVAS_W - PAD),
    py:     map(ny, 0, 1, CANVAS_H - PAD, PAD),  // flip y so 0 = bottom
    born:   millis(),
    hue:    map(nx, 0, 1, 180, 300),
    source: source,
  });

  // Keep dot list bounded.
  if (dots.length > MAX_DOTS) dots.shift();
}

// ── p5.js sketch ──────────────────────────────────────────────────────────

function setup() {
  var size = getCanvasSize();
  applyCanvasSize(size.width, size.height);
  var canvas = createCanvas(CANVAS_W, CANVAS_H);
  lockPageTouch(canvas);
  canvas.parent('sketch-container');
  colorMode(HSB, 360, 100, 100, 100);
  statusColor = color(0, 70, 90);

  // Seed a few demo points so the canvas looks alive immediately.
  for (var i = 0; i < 12; i++) addDemoDot();

  // ── DataNet ─────────────────────────────────────────────────────────────
  // In global mode we call the window-level function that the addon attaches.
  // The explicit window reference is friendlier to the p5.js Web Editor.
  dn = window.createDataNet(API_KEY /*, { debug: true } */);

  dn.on('connect', function () {
    statusText  = 'Connected — channel: ' + CHANNEL;
    statusColor = color(120, 70, 80);

    dn.subscribe(CHANNEL, function (data, meta) {
      // Expect { x: 0..1, y: 0..1 }. Clamp to plot area.
      var nx = constrain(data.x != null ? data.x : random(), 0, 1);
      var ny = constrain(data.y != null ? data.y : random(), 0, 1);

      addDataDot(nx, ny, data.source || 'network');
      msgCount++;
    });
  });

  dn.on('disconnect', function () {
    statusText  = 'Disconnected — reconnecting…';
    statusColor = color(30, 80, 90);
  });

  dn.on('error', function (err) {
    statusText  = 'Error: ' + err.message;
    statusColor = color(0, 80, 90);
    console.error('[DataNet]', err);
  });

  dn.connect();
}

function draw() {
  background(240, 30, 8);

  drawAxes();
  drawDots();
  drawHUD();
}

function windowResized() {
  var size = getCanvasSize();
  applyCanvasSize(size.width, size.height);
  resizeCanvas(CANVAS_W, CANVAS_H);
}

// ── Drawing helpers ────────────────────────────────────────────────────────

function drawAxes() {
  stroke(0, 0, 25);
  strokeWeight(1);
  noFill();

  // Plot border.
  rect(PAD, PAD, CANVAS_W - 2 * PAD, CANVAS_H - 2 * PAD);

  // Dashed grid lines.
  drawingContext.setLineDash([4, 8]);
  var steps = 4;
  for (var i = 1; i < steps; i++) {
    var gx = map(i, 0, steps, PAD, CANVAS_W - PAD);
    var gy = map(i, 0, steps, PAD, CANVAS_H - PAD);
    line(gx, PAD, gx, CANVAS_H - PAD);
    line(PAD, gy, CANVAS_W - PAD, gy);
  }
  drawingContext.setLineDash([]);

  // Axis labels.
  fill(0, 0, 55);
  noStroke();
  textSize(10);
  textAlign(CENTER, TOP);
  text('x →', CANVAS_W / 2, CANVAS_H - PAD + 8);
  textAlign(RIGHT, CENTER);
  push();
  translate(PAD - 10, CANVAS_H / 2);
  rotate(-HALF_PI);
  text('y →', 0, 0);
  pop();
}

function drawDots() {
  var now = millis();

  for (var i = dots.length - 1; i >= 0; i--) {
    var d   = dots[i];
    var age = now - d.born;

    if (age > DOT_LIFETIME) {
      dots.splice(i, 1);
      continue;
    }

    var progress = age / DOT_LIFETIME;           // 0 = fresh, 1 = about to vanish
    var alpha    = 100 * (1 - progress * progress);  // quadratic fade
    var r        = lerp(14, 4, progress);        // shrink as they age

    // Outer glow.
    noStroke();
    fill(d.hue, 70, 90, alpha * 0.3);
    ellipse(d.px, d.py, r * 3, r * 3);

    // Core dot.
    fill(d.hue, 60, 100, alpha);
    ellipse(d.px, d.py, r, r);
  }
}

function drawHUD() {
  // Status pill.
  noStroke();
  fill(0, 0, 10, 70);
  rect(PAD - 2, 8, CANVAS_W - 2 * PAD + 4, 26, 6);

  fill(statusColor);
  textAlign(LEFT, CENTER);
  textSize(11);
  text(statusText, PAD + 6, 21);

  // Message counter.
  textAlign(RIGHT, CENTER);
  fill(0, 0, 60);
  text('msgs: ' + msgCount + '  dots: ' + dots.length, CANVAS_W - PAD - 4, 21);
}

// ── Interaction controls ───────────────────────────────────────────────────

function publishPointFromCanvas(px, py, source) {
  var nx = constrain(map(px, PAD, CANVAS_W - PAD, 0, 1), 0, 1);
  var ny = constrain(map(py, CANVAS_H - PAD, PAD, 0, 1), 0, 1);

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
  if (mouseX < 0 || mouseX > CANVAS_W || mouseY < 0 || mouseY > CANVAS_H) return;
  publishPointFromCanvas(mouseX, mouseY, source);
}

function mousePressed() {
  if (Date.now() - lastTouchAt < 500) return;
  publishPointerPoint('mouse');
}

function mouseDragged() {
  if (Date.now() - lastTouchAt < 500) return;
  publishPointerPoint('mouse-drag');
}

function touchStarted() {
  lastTouchAt = Date.now();
  publishPointerPoint('touch');
  return false;
}

function touchMoved() {
  lastTouchAt = Date.now();
  publishPointerPoint('touch-drag');
  return false;
}

function keyPressed() {
  if (!dn) return;

  if (key === 'c' || key === 'C') {
    dots = [];
  }
  if (key === 'd' || key === 'D') {
    dn.disconnect();
    statusText  = 'Disconnected';
    statusColor = color(30, 80, 90);
  }
  if (key === 'r' || key === 'R') {
    dn.connect();
  }

  // Spacebar: publish a test point to the channel.
  if (key === ' ') {
    var nx = random();
    var ny = random();
    addDataDot(nx, ny, 'keyboard');

    if (dn.isConnected()) {
      dn.publish(CHANNEL, { x: nx, y: ny, source: 'keyboard' });
    }
  }
}
