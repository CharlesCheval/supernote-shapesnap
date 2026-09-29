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

/**
 * A brace goes from one end to the other (the chord) and bulges to one side:
 * both arms run parallel to the chord at about half the depth, and the middle
 * comes to a sharp point at full depth. This tells it apart from an arc "("
 * (no sharp point, no flat arms) and from a "V" (no flat arms).
 */
export function recognizeBrace(path: P[], minSize: number, k: number): Result {
  const s = path[0];
  const e = path[path.length - 1];
  const len = dist(s, e);
  if (len < minSize) {
    return {shape: null, reason: 'brace: too short'};
  }
  const u = {x: (e.x - s.x) / len, y: (e.y - s.y) / len};
  const along = path.map(p => (p.x - s.x) * u.x + (p.y - s.y) * u.y);
  const lat = path.map(p => (p.x - s.x) * -u.y + (p.y - s.y) * u.x);

  // It must progress from one end to the other (small curls at the ends allowed).
  let furthest = -Infinity;
  let back = 0;
  for (const a of along) {
    furthest = Math.max(furthest, a);
    back = Math.max(back, furthest - a);
  }
  if (back > 0.1 * len) {
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
  if (depth < 0.05 * len || depth > 0.45 * len) {
    return {shape: null, reason: 'brace: wrong depth'};
  }
  if (Math.min(...lat.map(v => v * side)) < -0.25 * depth) {
    return {shape: null, reason: 'brace: bulges on both sides'};
  }
  const peakAt = along[m] / len;
  if (peakAt < 0.3 || peakAt > 0.7) {
    return {shape: null, reason: 'brace: point not in the middle'};
  }

  // Sharp point in the middle.
  const w = 6;
  const before = path[Math.max(0, m - w)];
  const after = path[Math.min(path.length - 1, m + w)];
  const a1 = Math.atan2(path[m].y - before.y, path[m].x - before.x);
  const a2 = Math.atan2(after.y - path[m].y, after.x - path[m].x);
  let turn = Math.abs(a2 - a1);
  if (turn > Math.PI) {
    turn = 2 * Math.PI - turn;
  }
  if (deg(turn) < 45) {
    return {shape: null, reason: 'brace: no point in the middle'};
  }

  // Flat arms: the side offset barely changes along each arm.
  const offsetAt = (f: number) => {
    const near = lat.filter((_, i) => Math.abs(along[i] - f * len) <= 0.05 * len).map(v => v * side);
    return near.length ? near.reduce((x, y) => x + y, 0) / near.length : NaN;
  };
  const arms = [
    [0.2, 0.4],
    [0.6, 0.8],
  ].map(([f1, f2]) => Math.abs(offsetAt(f1) - offsetAt(f2)) / depth);
  if (arms.some(d => !(d <= 0.3 * k))) {
    return {shape: null, reason: 'brace: arms not straight'};
  }
  if ([0.15, 0.85].some(f => !(offsetAt(f) >= 0.25 * depth))) {
    return {shape: null, reason: 'brace: ends do not curl'};
  }

  // Clean brace, straightened to the page axes when close to them.
  const dir = snapUnit(s, e, 12);
  const normal = {x: -dir.y * side, y: dir.x * side};
  const pts = braceOutline(len, Math.min(Math.max(depth, 0.08 * len), 0.25 * len)).map(q => ({
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
 * √ drawn upright in one stroke: a short stroke down to the lowest point,
 * a long straight rise, then a horizontal bar to the right. The bar keeps the
 * drawn length, so it covers what is written under it.
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
  const h = low.y - end.y;
  if (b === 0 || b === path.length - 1 || h < 0.5 * minSize) {
    return {shape: null, reason: 'sqrt: no rise'};
  }
  // Corner at the top of the rise: first point after the bottom that reaches the bar height.
  const barY = end.y;
  const tol = 0.15 * k * h;
  let t = b;
  while (t < path.length - 1 && path[t].y > barY + tol) {
    t++;
  }
  const top = path[t];
  const bar = path.slice(t);
  const barLen = end.x - top.x;
  if (barLen < 0.3 * h) {
    return {shape: null, reason: 'sqrt: no bar'};
  }
  if (bar.some(p => Math.abs(p.y - barY) > tol) || maxDeviation(bar, top, end) > tol) {
    return {shape: null, reason: 'sqrt: bar not straight'};
  }
  const rise = path.slice(b, t + 1);
  const riseAngle = deg(Math.atan2(low.y - top.y, top.x - low.x));
  if (riseAngle < 45 || riseAngle > 89) {
    return {shape: null, reason: `sqrt: rise at ${Math.round(riseAngle)}°`};
  }
  if (maxDeviation(rise, low, top) > 0.12 * k * dist(low, top)) {
    return {shape: null, reason: 'sqrt: rise not straight'};
  }
  // Left stroke: from its highest point down to the bottom, going right.
  const lead = path.slice(0, b + 1);
  let s = 0;
  for (let i = 1; i < lead.length; i++) {
    if (lead[i].y < lead[s].y) {
      s = i;
    }
  }
  const start = lead[s];
  const tick = dist(start, low);
  if (start.x >= low.x || tick < 0.1 * h || tick > 0.8 * h) {
    return {shape: null, reason: 'sqrt: no left stroke'};
  }
  if (start.y < top.y + 0.2 * h) {
    return {shape: null, reason: 'sqrt: left stroke too high'};
  }
  if (lead.some(p => p.x > low.x + 0.1 * h)) {
    return {shape: null, reason: 'sqrt: left stroke goes right of the bottom'};
  }
  if (maxDeviation(lead.slice(s), start, low) > 0.25 * k * tick) {
    return {shape: null, reason: 'sqrt: left stroke not straight'};
  }
  // Clean radical: a small serif, the left stroke, the rise, a horizontal bar.
  const serif = {x: start.x - 0.15 * tick, y: start.y + 0.1 * tick};
  const corner = {x: top.x, y: barY};
  return {shape: {kind: 'sqrt', points: [serif, start, low, corner, {x: end.x, y: barY}]}, reason: 'sqrt'};
}

// ---------------------------------------------------------------------------
// Coordinate axes ("L")
// ---------------------------------------------------------------------------

/**
 * Two straight legs at a right angle, one vertical and one horizontal, drawn
 * in one stroke. The corner is the origin; each leg becomes an axis in the
 * direction it was drawn.
 */
export function recognizeAxes(path: P[], minSize: number, k: number): Result {
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
  const angleOf = (p: P) => deg(Math.atan2(p.y - o.y, p.x - o.x));
  const offAxis = (a: number) => Math.abs(a - Math.round(a / 90) * 90);
  const [a0, a1] = [angleOf(s), angleOf(e)];
  if (offAxis(a0) > 7 * k || offAxis(a1) > 7 * k) {
    return {shape: null, reason: 'axes: legs not horizontal / vertical'};
  }
  const vertical0 = Math.abs(Math.round(a0 / 90)) % 2 === 1;
  const vertical1 = Math.abs(Math.round(a1 / 90)) % 2 === 1;
  if (vertical0 === vertical1) {
    return {shape: null, reason: 'axes: legs not perpendicular'};
  }
  const [vEnd, hEnd] = vertical0 ? [s, e] : [e, s];
  return {
    shape: {kind: 'axes', origin: o, xEnd: {x: hEnd.x, y: o.y}, yEnd: {x: o.x, y: vEnd.y}},
    reason: 'axes',
  };
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
