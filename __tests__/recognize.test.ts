import {P, arrowPoints, recognize, snapDirection, trailingStillCount} from '../src/recognize';

const opts = {tolerance: 3, minSize: 60, rect: true, circle: true, arrow: true, arrowSnapDegrees: 8};

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
    expect(kind(hand(arrow({x: 100, y: 300}, {x: 700, y: 300}, 50, 'barb-tip-barb'), 3), {...opts, arrow: false})).toBeNull();
  });
});

test('final dwell: still points are counted', () => {
  const stroke = [...rect(100, 100, 700, 400), ...Array.from({length: 40}, () => ({x: 101, y: 111}))];
  expect(trailingStillCount(stroke, 10)).toBeGreaterThanOrEqual(40);
  expect(kind(stroke)).toBe('rect');
});

/** Hand-drawn arrow: shaft from `a` to `b`, then a head of size `h` drawn in one of the usual ways. */
function arrow(a: P, b: P, h: number, style: 'barb-tip-barb' | 'triangle' | 'open-v', deg = 30, bow = 0): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const bx = (a.x - b.x) / len;
  const by = (a.y - b.y) / len;
  const r = (deg * Math.PI) / 180;
  const barb = (s: number) => ({
    x: b.x + h * (bx * Math.cos(s * r) - by * Math.sin(s * r)),
    y: b.y + h * (bx * Math.sin(s * r) + by * Math.cos(s * r)),
  });
  const heads = {
    'barb-tip-barb': [b, barb(1), b, barb(-1)],
    triangle: [b, barb(1), barb(-1), b],
    'open-v': [b, barb(1), barb(-1)],
  };
  // Optional bow: the shaft passes through a midpoint pushed sideways by `bow` × its length.
  const mid = {x: (a.x + b.x) / 2 - by * bow * len, y: (a.y + b.y) / 2 + bx * bow * len};
  const shaft = bow ? [a, mid] : [a];
  return polyline([...shaft, ...heads[style]], 30);
}

describe('arrows', () => {
  const tail = {x: 100, y: 300};
  test('barb → tip → barb head', () => expect(kind(hand(arrow(tail, {x: 800, y: 330}, 60, 'barb-tip-barb'), 3))).toBe('arrow'));
  test('closed triangle head', () => expect(kind(hand(arrow(tail, {x: 700, y: 700}, 50, 'triangle'), 3))).toBe('arrow'));
  test('open V head', () => expect(kind(hand(arrow({x: 500, y: 900}, {x: 500, y: 200}, 40, 'open-v'), 3))).toBe('arrow'));
  // Measured from real drawings: wide triangular heads, slightly bowed shafts.
  test('wide triangle head (55°), bowed shaft', () =>
    expect(kind(hand(arrow({x: 480, y: 550}, {x: 770, y: 440}, 45, 'triangle', 55, 0.05), 2))).toBe('arrow'));
  test('very wide triangle head (65°), up-left', () =>
    expect(kind(hand(arrow({x: 640, y: 1500}, {x: 530, y: 1380}, 50, 'triangle', 65), 2))).toBe('arrow'));
  test('short arrow with a big head', () => expect(kind(hand(arrow(tail, {x: 260, y: 300}, 45, 'barb-tip-barb'), 2))).toBe('arrow'));

  test('near-horizontal shaft is snapped, tail kept', () => {
    const res = recognize(hand(arrow(tail, {x: 800, y: 380}, 50, 'barb-tip-barb'), 3), opts);
    expect(res.shape?.kind).toBe('arrow');
    if (res.shape?.kind === 'arrow') {
      expect(res.shape.tip.y).toBeCloseTo(res.shape.tail.y, 5);
      expect(Math.abs(res.shape.tail.x - 100)).toBeLessThan(10);
    }
  });
  test('diagonal shaft stays free', () => {
    const res = recognize(hand(arrow(tail, {x: 600, y: 700}, 50, 'barb-tip-barb'), 3), opts);
    expect(res.shape?.kind).toBe('arrow');
    if (res.shape?.kind === 'arrow') {
      expect(Math.abs(res.shape.tip.y - res.shape.tail.y)).toBeGreaterThan(300);
    }
  });

  test('straight line without a head', () => expect(kind(hand(polyline([tail, {x: 800, y: 320}]), 3))).toBeNull());
  test('line ending with a one-sided hook', () =>
    expect(kind(polyline([tail, {x: 800, y: 300}, {x: 760, y: 330}], 30))).toBeNull());
  test('curved shaft', () => expect(kind(polyline([tail, {x: 450, y: 450}, {x: 800, y: 300}, {x: 760, y: 280}, {x: 800, y: 300}, {x: 770, y: 340}], 30))).toBeNull());
  test('zigzag is not an arrow', () =>
    expect(kind(polyline([tail, {x: 250, y: 200}, {x: 400, y: 300}, {x: 550, y: 200}, {x: 700, y: 300}], 30))).toBeNull());
});

test('arrow head has a fixed size, whatever was drawn', () => {
  const pts = arrowPoints({x: 0, y: 0}, {x: 500, y: 0}, 40);
  expect(pts).toHaveLength(5);
  expect(pts[1]).toEqual({x: 500, y: 0});
  expect(pts[4]).toEqual({x: 500, y: 0}); // closed head
  for (const b of [pts[2], pts[3]]) {
    expect(Math.hypot(b.x - 500, b.y)).toBeCloseTo(40, 5);
    expect(b.x).toBeLessThan(500);
  }
  expect(pts[2].y).toBeCloseTo(-pts[3].y, 5);
});

test('filled head: rungs stay inside the triangle, spaced as asked, ending on the base', () => {
  const pts = arrowPoints({x: 0, y: 0}, {x: 500, y: 0}, 40, 4);
  const rungs = pts.slice(5);
  const depth = 40 * Math.cos(Math.PI / 6);
  expect(rungs.length).toBe(2 * Math.ceil(depth / 4));
  for (const p of rungs) {
    const back = 500 - p.x;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThanOrEqual(depth + 1e-9);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(back * Math.tan(Math.PI / 6) + 1e-9);
  }
  for (let i = 2; i < rungs.length; i += 2) {
    expect(rungs[i - 2].x - rungs[i].x).toBeLessThanOrEqual(4 + 1e-9);
  }
  expect(500 - rungs[rungs.length - 1].x).toBeCloseTo(depth, 5);
});

test('same head size on short and long arrows', () => {
  const size = (pts: P[]) => Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
  expect(size(arrowPoints({x: 0, y: 0}, {x: 120, y: 0}, 100))).toBeCloseTo(100, 5);
  expect(size(arrowPoints({x: 0, y: 0}, {x: 900, y: 0}, 100))).toBeCloseTo(100, 5);
});

test('arrow snapping angle is configurable', () => {
  const tail = {x: 0, y: 0};
  const at = (deg: number) => ({x: 500 * Math.cos((deg * Math.PI) / 180), y: 500 * Math.sin((deg * Math.PI) / 180)});
  expect(snapDirection(tail, at(7), 8).y).toBe(0);
  expect(snapDirection(tail, at(10), 8)).toEqual(at(10));
  expect(snapDirection(tail, at(10), 12).y).toBe(0);
  expect(snapDirection(tail, at(85), 8).x).toBe(0);
  expect(snapDirection(tail, at(3), 0)).toEqual(at(3));
});
