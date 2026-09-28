import {P, recognize, trailingStillCount} from '../src/recognize';

const opts = {tolerance: 3, minSize: 60, rect: true, circle: true};

/** Deterministic low-frequency wobble + noise, like a real hand. */
function hand(points: P[], amp: number, seed = 7): P[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  let dx = 0;
  let dy = 0;
  return points.map(p => {
    dx = dx * 0.9 + rnd() * amp * 0.3;
    dy = dy * 0.9 + rnd() * amp * 0.3;
    return {x: p.x + dx + rnd() * amp * 0.3, y: p.y + dy + rnd() * amp * 0.3};
  });
}

function polyline(vertices: P[], perSide = 40): P[] {
  const out: P[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    for (let j = 0; j < perSide; j++) {
      const t = j / perSide;
      out.push({x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y)});
    }
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

function arc(cx: number, cy: number, rx: number, ry: number, turns: number, start = 0, n = 150): P[] {
  return Array.from({length: n}, (_, i) => {
    const a = start + (i / (n - 1)) * turns * 2 * Math.PI;
    return {x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a)};
  });
}

function rotateAll(points: P[], deg: number, c: P): P[] {
  const a = (deg * Math.PI) / 180;
  return points.map(p => ({
    x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
    y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a),
  }));
}

/** Rectangle drawn from top-left, clockwise; `end` = where the pen stops. */
const rect = (l: number, t: number, r: number, b: number, end: P = {x: l, y: t + 10}) =>
  polyline([{x: l, y: t}, {x: r, y: t}, {x: r, y: b}, {x: l, y: b}, end]);

/** Rounded rectangle (corner radius rr). */
function roundRect(l: number, t: number, r: number, b: number, rr: number): P[] {
  const pts: P[] = [];
  const corner = (cx: number, cy: number, a0: number) => pts.push(...arc(cx, cy, rr, rr, 0.25, a0, 12));
  pts.push(...polyline([{x: l + rr, y: t}, {x: r - rr, y: t}], 30));
  corner(r - rr, t + rr, -Math.PI / 2);
  pts.push(...polyline([{x: r, y: t + rr}, {x: r, y: b - rr}], 30));
  corner(r - rr, b - rr, 0);
  pts.push(...polyline([{x: r - rr, y: b}, {x: l + rr, y: b}], 30));
  corner(l + rr, b - rr, Math.PI / 2);
  pts.push(...polyline([{x: l, y: b - rr}, {x: l, y: t + rr}], 30));
  corner(l + rr, t + rr, Math.PI);
  return pts;
}

const kind = (pts: P[], o = opts) => recognize(pts, o).shape?.kind ?? null;

describe('rectangles', () => {
  test('wobbly rectangle', () => expect(kind(hand(rect(100, 100, 700, 400), 8))).toBe('rect'));
  test('wide banner', () => expect(kind(hand(rect(100, 100, 900, 230), 5))).toBe('rect'));
  test('square', () => expect(kind(hand(rect(200, 200, 600, 600), 8))).toBe('rect'));
  test('overshoot past the start', () =>
    expect(kind(hand(rect(100, 100, 700, 400, {x: 100, y: 60}), 6).concat(polyline([{x: 100, y: 60}, {x: 170, y: 60}], 10)))).toBe('rect'));
  test('not quite closed (gap ~ 12%)', () => expect(kind(hand(rect(100, 100, 700, 450, {x: 100, y: 180}), 6))).toBe('rect'));
  test('rounded corners', () => expect(kind(hand(roundRect(100, 100, 700, 450, 35), 5))).toBe('rect'));
  test('tilted 6°: snapped to the axes', () => {
    const res = recognize(hand(rotateAll(rect(100, 100, 700, 450), 6, {x: 400, y: 275}), 6), opts);
    expect(res.shape?.kind).toBe('rect');
    if (res.shape?.kind === 'rect') {
      expect(res.shape.corners[0].y).toBeCloseTo(res.shape.corners[1].y, 5);
    }
  });
  test('tilted 25°: kept tilted', () => {
    const res = recognize(hand(rotateAll(rect(100, 100, 700, 450), 25, {x: 400, y: 275}), 5), opts);
    expect(res.shape?.kind).toBe('rect');
    expect(Math.abs(res.metrics!.angle)).toBeGreaterThan(15);
  });
  test('page-sized rectangle is still a rectangle', () => expect(kind(hand(rect(40, 40, 1360, 1820), 10))).toBe('rect'));
  test('counter-clockwise, starting bottom-right', () =>
    expect(kind(hand(polyline([{x: 700, y: 400}, {x: 700, y: 100}, {x: 100, y: 100}, {x: 100, y: 400}, {x: 690, y: 400}]), 6))).toBe('rect'));
});

describe('circles', () => {
  test('wobbly circle -> perfect circle with the right radius', () => {
    const res = recognize(hand(arc(500, 500, 200, 200, 1), 8), opts);
    expect(res.shape?.kind).toBe('circle');
    if (res.shape?.kind === 'circle') {
      expect(Math.abs(res.shape.r - 200)).toBeLessThan(20);
    }
  });
  test('overlapping end (1.15 turns)', () => expect(kind(hand(arc(500, 500, 200, 200, 1.15), 6))).toBe('circle'));
  test('not quite closed (0.92 turn)', () => expect(kind(hand(arc(500, 500, 200, 200, 0.92), 6))).toBe('circle'));
  test('slightly oval -> circle', () => expect(kind(hand(arc(500, 500, 230, 180, 1.02), 6))).toBe('circle'));
  test('small circle (90 px)', () => expect(kind(hand(arc(300, 300, 45, 45, 1.05), 2))).toBe('circle'));
});

describe('rejected', () => {
  test('triangle', () =>
    expect(kind(polyline([{x: 200, y: 700}, {x: 500, y: 200}, {x: 800, y: 700}, {x: 205, y: 695}]))).toBeNull());
  test('open L-shaped stroke', () => expect(kind(polyline([{x: 100, y: 100}, {x: 600, y: 100}, {x: 600, y: 500}]))).toBeNull());
  test('straight line', () => expect(kind(polyline([{x: 100, y: 100}, {x: 800, y: 120}]))).toBeNull());
  test('very flat ellipse', () => expect(kind(arc(500, 500, 400, 110, 1.02))).toBeNull());
  test('handwriting-sized loop', () => expect(recognize(arc(100, 100, 15, 15, 1.05), opts).reason).toMatch(/too small/));
  test('disabled shapes', () => {
    expect(kind(rect(100, 100, 700, 400), {...opts, rect: false})).not.toBe('rect');
    expect(kind(arc(500, 500, 200, 200, 1.05), {...opts, circle: false})).toBeNull();
  });
});

test('final dwell: still points are counted', () => {
  const stroke = [...rect(100, 100, 700, 400), ...Array.from({length: 40}, () => ({x: 101, y: 111}))];
  expect(trailingStillCount(stroke, 10)).toBeGreaterThanOrEqual(40);
  expect(kind(stroke)).toBe('rect');
});
