/**
 * Maths symbols recognized from a single open stroke: curly brace, square root,
 * and coordinate axes drawn as an "L". Pure logic, unit-tested.
 * `path` is the stroke resampled at equal spacing, in pixels (y pointing down).
 */

export type P = {x: number; y: number};

export type SymbolShape =
  | {kind: 'brace'; points: P[]}
  | {kind: 'sqrt'; points: P[]}
  | {kind: 'axes'; origin: P; xEnd: P; yEnd: P};

type Result = {shape: SymbolShape | null; reason: string};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Largest distance of `pts` to the line a-b. */
function maxDeviation(pts: P[], a: P, b: P): number {
  const len = Math.max(1e-9, dist(a, b));
  return Math.max(...pts.map(p => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len));
}

/** Direction a → b turned to the nearest page axis when within `maxDeg` of it. */
function snapUnit(a: P, b: P, maxDeg: number): P {
  const len = Math.max(1e-9, dist(a, b));
  const u = {x: (b.x - a.x) / len, y: (b.y - a.y) / len};
  const angle = deg(Math.atan2(u.y, u.x));
  if (Math.abs(angle - Math.round(angle / 90) * 90) > maxDeg) {
    return u;
  }
  return Math.abs(u.x) >= Math.abs(u.y) ? {x: Math.sign(u.x), y: 0} : {x: 0, y: Math.sign(u.y)};
}

// ---------------------------------------------------------------------------
// Curly brace
// ---------------------------------------------------------------------------

/** Largest direction change (degrees) at each point, over `w` points on each side. */
function turns(path: P[], w: number): number[] {
  return path.map((p, i) => {
    if (i < w || i + w >= path.length) {
      return 0;
    }
    const a1 = Math.atan2(p.y - path[i - w].y, p.x - path[i - w].x);
    const a2 = Math.atan2(path[i + w].y - p.y, path[i + w].x - p.x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) {
      d = 2 * Math.PI - d;
    }
    return deg(d);
  });
}

/**
 * A brace goes from one end to the other (the chord) and bulges to one side,
 * with a sharp feature in the middle: the point of a textbook brace, the small
 * zigzag between two "(" arcs, or the vertex of a quick "<". This sets it apart
 * from an arc "(" (smooth all along) and from an "S" (both sides).
 */
export function recognizeBrace(path: P[], minSize: number, k: number): Result {
  const s = path[0];
  const e = path[path.length - 1];
  const len = dist(s, e);
  if (len < 1.5 * minSize) {
    return {shape: null, reason: 'brace: too short'};
  }
  const u = {x: (e.x - s.x) / len, y: (e.y - s.y) / len};
  const along = path.map(p => (p.x - s.x) * u.x + (p.y - s.y) * u.y);
  const lat = path.map(p => (p.x - s.x) * -u.y + (p.y - s.y) * u.x);

  // It must progress from one end to the other (curls and the middle zigzag allowed).
  let furthest = -Infinity;
  let back = 0;
  for (const a of along) {
    furthest = Math.max(furthest, a);
    back = Math.max(back, furthest - a);
  }
  if (back > 0.15 * len) {
    return {shape: null, reason: 'brace: goes back and forth'};
  }

  let m = 0;
  for (let i = 1; i < path.length; i++) {
    if (Math.abs(lat[i]) > Math.abs(lat[m])) {
      m = i;
    }
  }
  const side = Math.sign(lat[m]) || 1;
  const depth = Math.abs(lat[m]);
  if (depth < 0.06 * len || depth > 0.4 * len) {
    return {shape: null, reason: `brace: depth ${Math.round((100 * depth) / len)}% of its length`};
  }
  if (Math.min(...lat.map(v => v * side)) < -0.2 * depth) {
    return {shape: null, reason: 'brace: bulges on both sides'};
  }

  // Sharp feature in the middle (40–60% of the length: braces are symmetric).
  const t = turns(path, 5);
  let peak = -1;
  for (let i = 0; i < path.length; i++) {
    const f = along[i] / len;
    if (f >= 0.4 && f <= 0.6 && (peak < 0 || t[i] > t[peak])) {
      peak = i;
    }
  }
  if (peak < 0 || t[peak] < 35 / k) {
    return {shape: null, reason: 'brace: no point in the middle'};
  }
  // Smooth arms (curled ends allowed): a "W" or a zigzag has sharp turns there.
  // The middle feature itself may stick out or sit back near the chord
  // (two "(" arcs joined by a notch).
  const sharpArms = t.filter((v, i) => {
    const f = along[i] / len;
    return v > 50 && ((f > 0.1 && f < 0.38) || (f > 0.62 && f < 0.9));
  }).length;
  if (sharpArms > 3) {
    return {shape: null, reason: 'brace: arms not smooth'};
  }

  // Clean brace, straightened to the page axes when close to them.
  const dir = snapUnit(s, e, 12);
  const normal = {x: -dir.y * side, y: dir.x * side};
  const pts = braceOutline(len, Math.min(Math.max(depth, 0.1 * len), 0.22 * len)).map(q => ({
    x: s.x + q.x * dir.x + q.y * normal.x,
    y: s.y + q.x * dir.y + q.y * normal.y,
  }));
  return {shape: {kind: 'brace', points: pts}, reason: 'brace'};
}

/**
 * Brace of length `len` and depth `depth` in its own frame: x along the chord,
 * y towards the point. Quarter circles at both ends and around the point,
 * straight arms in between.
 */
export function braceOutline(len: number, depth: number, stepsPerQuarter = 8): P[] {
  const r = Math.min(depth / 2, len / 4);
  const arc = (cx: number, cy: number, from: number, to: number) =>
    Array.from({length: stepsPerQuarter + 1}, (_, i) => {
      const t = from + ((to - from) * i) / stepsPerQuarter;
      return {x: cx + r * Math.cos(t), y: cy + r * Math.sin(t)};
    });
  const half = [...arc(r, 0, Math.PI, Math.PI / 2), ...arc(len / 2 - r, 2 * r, -Math.PI / 2, 0)];
  const mirror = [...half].reverse().map(p => ({x: len - p.x, y: p.y}));
  return [...half, ...mirror.slice(1)];
}

// ---------------------------------------------------------------------------
// Square root
// ---------------------------------------------------------------------------

/**
 * √ drawn upright in one stroke: a short entry down to the lowest point (any
 * shape: straight, "‾|", hooked), a long rise, then a bar to the right. The
 * corner at the top of the rise is the point farthest from the bottom → end
 * line. The bar keeps the drawn length, so it covers what is written under it.
 */
export function recognizeSqrt(path: P[], minSize: number, k: number): Result {
  let b = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].y > path[b].y) {
      b = i;
    }
  }
  const low = path[b];
  const end = path[path.length - 1];
  if (b === 0 || b >= path.length - 2) {
    return {shape: null, reason: 'sqrt: no rise'};
  }
  let t = b + 1;
  for (let i = b + 1; i < path.length - 1; i++) {
    if (maxDeviation([path[i]], low, end) > maxDeviation([path[t]], low, end)) {
      t = i;
    }
  }
  const top = path[t];
  const h = low.y - top.y;
  if (h < 0.5 * minSize) {
    return {shape: null, reason: 'sqrt: rise too short'};
  }
  // Bar: long, roughly horizontal, roughly straight.
  const barLen = end.x - top.x;
  if (barLen < 0.4 * h) {
    return {shape: null, reason: 'sqrt: no bar'};
  }
  if (deg(Math.atan2(Math.abs(end.y - top.y), barLen)) > 12 * k) {
    return {shape: null, reason: 'sqrt: bar not horizontal'};
  }
  if (maxDeviation(path.slice(t), top, end) > 0.1 * k * Math.max(barLen, h)) {
    return {shape: null, reason: 'sqrt: bar not straight'};
  }
  // Rise: straight, steep (up to slightly leaning back).
  const riseAngle = deg(Math.atan2(h, top.x - low.x));
  if (riseAngle < 45 || riseAngle > 105) {
    return {shape: null, reason: `sqrt: rise at ${Math.round(riseAngle)}°`};
  }
  if (maxDeviation(path.slice(b, t + 1), low, top) > 0.15 * k * dist(low, top)) {
    return {shape: null, reason: 'sqrt: rise not straight'};
  }
  // Entry: short, starting left of the bottom, staying below the bar and near the bottom.
  const lead = path.slice(0, b + 1);
  let leadLen = 0;
  for (let i = 1; i < lead.length; i++) {
    leadLen += dist(lead[i - 1], lead[i]);
  }
  if (leadLen < 0.1 * h || leadLen > 2 * h) {
    return {shape: null, reason: 'sqrt: no short entry stroke'};
  }
  if (path[0].x >= low.x || lead.some(p => p.x > low.x + 0.3 * h || p.y < top.y + 0.15 * h)) {
    return {shape: null, reason: 'sqrt: entry stroke out of place'};
  }
  // Clean radical of textbook proportions: the tick keeps a modest size on tall roots.
  const tick = Math.min(0.45 * h, 70);
  const start = {x: low.x - 0.55 * tick, y: low.y - tick};
  const serif = {x: start.x - 0.25 * tick, y: start.y + 0.12 * tick};
  const barY = top.y;
  return {
    shape: {kind: 'sqrt', points: [serif, start, low, {x: top.x, y: barY}, {x: end.x, y: barY}]},
    reason: 'sqrt',
  };
}

// ---------------------------------------------------------------------------
// Coordinate axes ("L")
// ---------------------------------------------------------------------------

/**
 * Two straight legs at a right angle, one vertical and one horizontal, drawn
 * in one stroke. The corner is the origin; each leg becomes an axis in the
 * direction it was drawn.
 */
export function recognizeAxes(path: P[], minSize: number, k: number, snapDegrees = 8): Result {
  const s = path[0];
  const e = path[path.length - 1];
  let c = 0;
  let best = -1;
  for (let i = 1; i < path.length - 1; i++) {
    const d = maxDeviation([path[i]], s, e);
    if (d > best) {
      best = d;
      c = i;
    }
  }
  const o = path[c];
  const legs = [s, e].map(end => ({end, len: dist(o, end)}));
  if (legs.some(l => l.len < 1.5 * minSize)) {
    return {shape: null, reason: 'axes: legs too short'};
  }
  const tol = 0.05 * k;
  if (
    maxDeviation(path.slice(0, c + 1), s, o) > tol * legs[0].len ||
    maxDeviation(path.slice(c), o, e) > tol * legs[1].len
  ) {
    return {shape: null, reason: 'axes: legs not straight'};
  }
  // Any orientation: the legs must be perpendicular; the pair is then turned as
  // one orthogonal frame, snapped to the page axes when it is nearly upright.
  const t0 = Math.atan2(s.y - o.y, s.x - o.x);
  const t1 = Math.atan2(e.y - o.y, e.x - o.x);
  let diff = t1 - t0;
  while (diff > Math.PI) {
    diff -= 2 * Math.PI;
  }
  while (diff <= -Math.PI) {
    diff += 2 * Math.PI;
  }
  if (Math.abs(Math.abs(deg(diff)) - 90) > 12 * k) {
    return {shape: null, reason: `axes: legs not perpendicular (${Math.round(Math.abs(deg(diff)))}°)`};
  }
  const turn = diff > 0 ? Math.PI / 2 : -Math.PI / 2;
  let frame = t0 + (diff - turn) / 2; // leg 0 direction, leg 1 at frame + turn
  const tilt = deg(frame) - Math.round(deg(frame) / 90) * 90;
  if (Math.abs(tilt) <= snapDegrees) {
    frame -= (tilt * Math.PI) / 180;
  }
  const along = (a: number, len: number) => {
    // Exact zeros on the page axes, so that upright axes are exactly upright.
    const cs = Math.abs(Math.cos(a)) < 1e-9 ? 0 : Math.cos(a);
    const sn = Math.abs(Math.sin(a)) < 1e-9 ? 0 : Math.sin(a);
    return {x: o.x + len * cs, y: o.y + len * sn};
  };
  const end0 = along(frame, legs[0].len);
  const end1 = along(frame + turn, legs[1].len);
  // x axis: the leg closer to horizontal.
  const flat = (p: P) => Math.abs(p.x - o.x) >= Math.abs(p.y - o.y);
  const [xEnd, yEnd] = flat(end0) && !flat(end1) ? [end0, end1] : flat(end1) ? [end1, end0] : [end0, end1];
  return {shape: {kind: 'axes', origin: o, xEnd, yEnd}, reason: 'axes'};
}

/**
 * One axis as a single polyline: from the origin to the end, with a tick every
 * `spacing` px (out and back across the axis), ending before the arrow head.
 */
export function axisPoints(origin: P, end: P, spacing: number, tick: number, headRoom: number): P[] {
  const len = dist(origin, end);
  const u = {x: (end.x - origin.x) / len, y: (end.y - origin.y) / len};
  const n = {x: -u.y, y: u.x};
  const at = (d: number, off = 0) => ({x: origin.x + d * u.x + off * n.x, y: origin.y + d * u.y + off * n.y});
  const pts = [origin];
  for (let d = spacing; d <= len - headRoom - spacing / 2; d += spacing) {
    pts.push(at(d), at(d, tick), at(d, -tick), at(d));
  }
  pts.push(end);
  return pts;
}
