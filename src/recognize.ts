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
 */

export type P = {x: number; y: number};

export type Shape =
  | {kind: 'rect'; corners: [P, P, P, P]}
  | {kind: 'circle'; cx: number; cy: number; r: number};

export type RecognizeOptions = {
  /** 1 (strict) to 5 (lenient). */
  tolerance: number;
  /** Minimum shape size (px): anything smaller is handwriting. */
  minSize: number;
  rect: boolean;
  circle: boolean;
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

/** Rectangles tilted less than this are snapped to the page axes. */
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

  if (gap > 0.25 * k) {
    return {shape: null, reason: 'shape not closed', metrics};
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
  return {shape: null, reason: 'shape not recognized', metrics};
}
