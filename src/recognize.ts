/**
 * Rectangle / circle recognition from the points of a single stroke (pixels).
 * Pure logic, no SDK, so it can be unit-tested.
 *
 * Pipeline:
 *  1. resample the stroke at equal spacing;
 *  2. cut the overshoot: keep the path up to where it comes back closest to its start;
 *  3. count sharp corners along the closed loop;
 *  4. fit a circle (least squares) and a minimum-area rectangle, and measure both errors;
 *  5. rectangle = ~4 corners + small rectangle error, circle = no corners + small circle error.
 *
 * Arrows (open strokes): a straight shaft, then a small head drawn at its far end
 * without lifting the pen (see recognizeArrow).
 */

export type P = {x: number; y: number};

export type Shape =
  | {kind: 'rect'; corners: [P, P, P, P]}
  | {kind: 'circle'; cx: number; cy: number; r: number}
  | {kind: 'arrow'; tail: P; tip: P};

export type RecognizeOptions = {
  /** 1 (strict) to 5 (lenient). */
  tolerance: number;
  /** Minimum shape size (px): anything smaller is handwriting. */
  minSize: number;
  rect: boolean;
  circle: boolean;
  arrow: boolean;
};

export type Metrics = {
  width: number;
  height: number;
  /** Distance between start and closest return point, relative to shape size. */
  gap: number;
  corners: number;
  rectErr: number;
  circErr: number;
  /** Rotation of the fitted rectangle, degrees. */
  angle: number;
};

export type Recognition = {shape: Shape | null; reason: string; metrics?: Metrics};

/** Rectangles and arrows tilted less than this are snapped to the page axes. */
const SNAP_DEGREES = 12;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Number of final points that stayed within `radius` of the last point. */
export function trailingStillCount(points: P[], radius: number): number {
  if (!points.length) {
    return 0;
  }
  const end = points[points.length - 1];
  let n = 0;
  for (let i = points.length - 1; i >= 0 && dist(points[i], end) <= radius; i--) {
    n++;
  }
  return n;
}

/** Resample to `n` points evenly spaced along the path. */
export function resample(points: P[], n: number): P[] {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  if (total === 0) {
    return Array.from({length: n}, () => points[0]);
  }
  const step = total / (n - 1);
  const out: P[] = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length && out.length < n; i++) {
    let prev = points[i - 1];
    const cur = points[i];
    let d = dist(prev, cur);
    while (d > 0 && acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      prev = {x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y)};
      out.push(prev);
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < n) {
    out.push(points[points.length - 1]);
  }
  return out;
}

/** Sharp turns (> minTurn degrees) along a closed loop of evenly spaced points. */
export function countCorners(loop: P[], window = 4, minTurn = 50): number {
  const n = loop.length;
  const at = (i: number) => loop[((i % n) + n) % n];
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = at(i - window);
    const b = at(i);
    const c = at(i + window);
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) {
      d = 2 * Math.PI - d;
    }
    turn.push((d * 180) / Math.PI);
  }
  let corners = 0;
  for (let i = 0; i < n; i++) {
    if (turn[i] < minTurn) {
      continue;
    }
    let isPeak = true;
    for (let k = 1; k <= window && isPeak; k++) {
      const l = turn[(i - k + n) % n];
      const r = turn[(i + k) % n];
      // strict on one side so that a flat plateau counts once
      if (l >= turn[i] || r > turn[i]) {
        isPeak = false;
      }
    }
    if (isPeak) {
      corners++;
    }
  }
  return corners;
}

/** Least-squares circle fit (Kasa). */
export function fitCircle(pts: P[]): {cx: number; cy: number; r: number; err: number} {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  // center the data for numerical stability
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  for (const p of pts) {
    const x = p.x - mx;
    const y = p.y - my;
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F]^T = -[sxz syz sz]^T
  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) {
      if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) {
        piv = r;
      }
    }
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r !== c && m[c][c] !== 0) {
        const f = m[r][c] / m[c][c];
        for (let k = c; k < 4; k++) {
          m[r][k] -= f * m[c][k];
        }
      }
    }
  }
  const D = m[0][3] / m[0][0];
  const E = m[1][3] / m[1][1];
  const F = m[2][3] / m[2][2];
  const cx = -D / 2;
  const cy = -E / 2;
  const r = Math.sqrt(Math.max(0, cx * cx + cy * cy - F));
  const err = r > 0 ? pts.reduce((s, p) => s + Math.abs(Math.hypot(p.x - mx - cx, p.y - my - cy) - r), 0) / n / r : 1;
  return {cx: cx + mx, cy: cy + my, r, err};
}

const rotate = (p: P, a: number): P => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

/** Minimum-area enclosing rectangle over rotations of ±45°, and the mean distance of points to its edges. */
export function fitRect(pts: P[]) {
  let best = {area: Infinity, deg: 0, l: 0, t: 0, r: 0, b: 0};
  const box = (deg: number) => {
    const a = (-deg * Math.PI) / 180;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of pts) {
      const q = rotate(p, a);
      l = Math.min(l, q.x); r = Math.max(r, q.x); t = Math.min(t, q.y); b = Math.max(b, q.y);
    }
    return {area: (r - l) * (b - t), deg, l, t, r, b};
  };
  for (let deg = -45; deg < 45; deg++) {
    const c = box(deg);
    if (c.area < best.area) {
      best = c;
    }
  }
  if (Math.abs(best.deg) <= SNAP_DEGREES) {
    best = box(0);
  }
  const a = (-best.deg * Math.PI) / 180;
  const small = Math.max(1, Math.min(best.r - best.l, best.b - best.t));
  const err =
    pts.reduce((s, p) => {
      const q = rotate(p, a);
      return s + Math.min(Math.abs(q.x - best.l), Math.abs(q.x - best.r), Math.abs(q.y - best.t), Math.abs(q.y - best.b));
    }, 0) /
    pts.length /
    small;
  const back = (x: number, y: number) => rotate({x, y}, -a);
  const corners: [P, P, P, P] = [back(best.l, best.t), back(best.r, best.t), back(best.r, best.b), back(best.l, best.b)];
  return {corners, err, angle: best.deg, w: best.r - best.l, h: best.b - best.t};
}

/** Cumulative path length at each point. */
function cumulative(path: P[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1] + dist(path[i - 1], path[i]));
  }
  return out;
}

/**
 * Arrow drawn in one stroke: a straight shaft from the start, then a small head
 * at its far end (any usual way: tip → barb → tip → barb, a closed triangle…).
 * - tip = the point farthest from the start;
 * - the shaft (start → tip) must be straight;
 * - the head (after the tip) must stay small, go back behind the tip, and
 *   reach both sides of the shaft: a line ending with a one-sided hook is not an arrow.
 * The drawn head only proves the intent: its size is not kept (see arrowPoints).
 */
export function recognizeArrow(path: P[], minSize: number, k: number): {shape: Shape | null; reason: string} {
  const tail = path[0];
  // The head often passes through the tip again (tip → barb → tip → barb):
  // take the FIRST point that reaches the farthest distance, within a small slack.
  const far = Math.max(...path.map(q => dist(q, tail)));
  const slack = Math.max(4, 0.015 * far);
  const tipIdx = path.findIndex(q => dist(q, tail) >= far - slack);
  const tip = path[tipIdx];
  const chord = dist(tail, tip);
  if (chord < minSize) {
    return {shape: null, reason: 'arrow: shaft too short'};
  }
  const u = {x: (tip.x - tail.x) / chord, y: (tip.y - tail.y) / chord};
  const lateral = (q: P, o: P) => (q.x - o.x) * -u.y + (q.y - o.y) * u.x;
  const along = (q: P, o: P) => (q.x - o.x) * u.x + (q.y - o.y) * u.y;

  // Shaft straightness: largest and mean distance to the start → tip line.
  const shaft = path.slice(0, tipIdx + 1);
  const devs = shaft.map(q => Math.abs(lateral(q, tail)));
  const maxDev = Math.max(...devs) / chord;
  const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length / chord;
  // Hand-drawn shafts often bow slightly.
  if (maxDev > 0.09 * k || meanDev > 0.04 * k) {
    return {shape: null, reason: `arrow: shaft not straight (${(maxDev * 100).toFixed(0)}%)`};
  }

  // Head: everything drawn after the tip.
  const head = path.slice(tipIdx);
  const len = cumulative(path);
  const headLen = len[len.length - 1] - len[tipIdx];
  const span = Math.max(...head.map(q => dist(q, tip)));
  if (headLen < 15 || span < 10) {
    return {shape: null, reason: 'arrow: no head'};
  }
  if (span > 0.6 * chord) {
    return {shape: null, reason: 'arrow: head too big for the shaft'};
  }
  const back = -Math.min(...head.map(q => along(q, tip)));
  const left = Math.max(...head.map(q => lateral(q, tip)));
  const right = -Math.min(...head.map(q => lateral(q, tip)));
  // Wide heads (barbs up to ~70° from the shaft) go back only a little.
  if (back < 0.2 * span) {
    return {shape: null, reason: 'arrow: head does not point back'};
  }
  if (Math.min(left, right) < 0.25 * span) {
    return {shape: null, reason: 'arrow: head on one side only'};
  }
  return {shape: {kind: 'arrow', tail, tip: snapDirection(tail, tip)}, reason: 'arrow'};
}

/** Keeps the tail; turns the shaft to horizontal / vertical when it is within SNAP_DEGREES. */
export function snapDirection(tail: P, tip: P): P {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const off = Math.abs(deg - Math.round(deg / 90) * 90);
  if (off > SNAP_DEGREES) {
    return tip;
  }
  return Math.abs(dx) >= Math.abs(dy) ? {x: tip.x, y: tail.y} : {x: tail.x, y: tip.y};
}

/** Angle between each barb and the shaft. */
const BARB_DEGREES = 30;

/**
 * Arrow as one polyline: tail → tip → barb → barb → tip, then the head is filled.
 * Geometries cannot be filled, so the polyline zigzags across the triangle,
 * rung after rung from the tip to the base, `fillSpacing` apart: with rungs
 * closer than the line width, they merge into a solid head.
 * `headLength` is fixed by the caller (from the pen width), whatever the drawn head size.
 */
export function arrowPoints(tail: P, tip: P, headLength: number, fillSpacing = 0): P[] {
  const len = Math.max(1, dist(tail, tip));
  const h = Math.min(headLength, len / 2);
  const bx = (tail.x - tip.x) / len;
  const by = (tail.y - tip.y) / len;
  const a = (BARB_DEGREES * Math.PI) / 180;
  const barb = (s: number) => ({
    x: tip.x + h * (bx * Math.cos(s * a) - by * Math.sin(s * a)),
    y: tip.y + h * (bx * Math.sin(s * a) + by * Math.cos(s * a)),
  });
  const left = barb(1);
  const right = barb(-1);
  const pts = [tail, tip, left, right, tip];
  if (fillSpacing > 0) {
    const rungs = Math.ceil((h * Math.cos(a)) / fillSpacing);
    const along = (end: P, f: number) => ({x: tip.x + f * (end.x - tip.x), y: tip.y + f * (end.y - tip.y)});
    for (let i = 1; i <= rungs; i++) {
      const f = i / rungs;
      pts.push(...(i % 2 ? [along(left, f), along(right, f)] : [along(right, f), along(left, f)]));
    }
  }
  return pts;
}

export function recognize(raw: P[], opts: RecognizeOptions): Recognition {
  if (raw.length < 8) {
    return {shape: null, reason: 'stroke too short'};
  }
  const path = resample(raw, 128);
  const xs = path.map(p => p.x);
  const ys = path.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const big = Math.max(width, height);
  if (!(big >= opts.minSize)) {
    return {shape: null, reason: `too small (${Math.round(width)}×${Math.round(height)} px)`};
  }
  // Tolerance 1..5 -> factor 0.6..1.4 applied to every threshold.
  const k = 0.4 + 0.2 * Math.min(5, Math.max(1, opts.tolerance));

  // Where does the path come back closest to its start (second half)? Cut the overshoot there.
  let end = path.length - 1;
  for (let j = path.length / 2; j < path.length; j++) {
    if (dist(path[j], path[0]) < dist(path[end], path[0])) {
      end = j;
    }
  }
  const gap = dist(path[end], path[0]) / big;
  const loop = resample([...path.slice(0, end + 1), path[0]], 65).slice(0, 64);

  const corners = countCorners(loop);
  const circle = fitCircle(loop);
  const rect = fitRect(loop);
  const metrics: Metrics = {width, height, gap, corners, rectErr: rect.err, circErr: circle.err, angle: rect.angle};

  const tryArrow = (why: string): Recognition => {
    if (!opts.arrow) {
      return {shape: null, reason: why, metrics};
    }
    const a = recognizeArrow(path, opts.minSize, k);
    return {shape: a.shape, reason: a.shape ? a.reason : `${why}; ${a.reason}`, metrics};
  };

  if (gap > 0.25 * k) {
    return tryArrow('shape not closed');
  }
  const rectOk =
    opts.rect &&
    Math.min(rect.w, rect.h) >= opts.minSize / 2 &&
    ((corners >= 3 && corners <= 6 && rect.err <= 0.07 * k) || (rect.err <= 0.03 * k && circle.err > 0.05));
  if (rectOk && rect.err <= circle.err) {
    return {shape: {kind: 'rect', corners: rect.corners}, reason: 'rectangle', metrics};
  }
  const aspect = Math.max(rect.w, rect.h) / Math.max(1, Math.min(rect.w, rect.h));
  const circleOk = opts.circle && corners <= 3 && circle.err <= 0.09 * k && aspect <= 1 + 0.5 * k;
  if (circleOk) {
    // Always a perfect circle, even from a slightly oval stroke.
    return {shape: {kind: 'circle', cx: circle.cx, cy: circle.cy, r: circle.r}, reason: 'circle', metrics};
  }
  return tryArrow('shape not recognized');
}
