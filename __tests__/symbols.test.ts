import {P, recognize} from '../src/recognize';
import {braceOutline} from '../src/symbols';

const opts = {
  tolerance: 3,
  minSize: 60,
  rect: true,
  circle: true,
  arrow: true,
  arrowSnapDegrees: 8,
  brace: true,
  sqrt: true,
  axes: true,
};

function hand(points: P[], amp: number, seed = 11): P[] {
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

function polyline(vertices: P[], perSide = 30): P[] {
  const out: P[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    for (let j = 0; j < perSide; j++) {
      const t = j / perSide;
      out.push({x: vertices[i].x + t * (vertices[i + 1].x - vertices[i].x), y: vertices[i].y + t * (vertices[i + 1].y - vertices[i].y)});
    }
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

/** Dense brace from `a` to `b`, pointing to the left of a→b (depth > 0) or right (< 0). */
function brace(a: P, b: P, depth: number): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = {x: (b.x - a.x) / len, y: (b.y - a.y) / len};
  const n = {x: -u.y * Math.sign(depth), y: u.x * Math.sign(depth)};
  const out = braceOutline(len, Math.abs(depth), 12).map(q => ({x: a.x + q.x * u.x + q.y * n.x, y: a.y + q.x * u.y + q.y * n.y}));
  return polyline(out, 4);
}

const kind = (pts: P[], o = opts) => recognize(pts, o).shape?.kind ?? null;

describe('braces', () => {
  test('{ drawn top to bottom', () => expect(kind(hand(brace({x: 400, y: 100}, {x: 400, y: 600}, 60), 3))).toBe('brace'));
  test('} drawn bottom to top', () => expect(kind(hand(brace({x: 400, y: 600}, {x: 400, y: 100}, -60), 3))).toBe('brace'));
  test('underbrace, slightly tilted, is straightened', () => {
    const res = recognize(hand(brace({x: 100, y: 500}, {x: 700, y: 530}, -50), 3), opts);
    expect(res.shape?.kind).toBe('brace');
    if (res.shape?.kind === 'brace') {
      const first = res.shape.points[0];
      const last = res.shape.points[res.shape.points.length - 1];
      expect(last.y).toBeCloseTo(first.y, 5);
    }
  });
  test('deep brace', () => expect(kind(hand(brace({x: 300, y: 100}, {x: 300, y: 400}, 70), 2))).toBe('brace'));

  test('arc "(" is not a brace', () => {
    const arc = Array.from({length: 120}, (_, i) => {
      const t = -Math.PI / 3 + (i / 119) * ((2 * Math.PI) / 3);
      return {x: 700 - 300 * Math.cos(t), y: 400 + 300 * Math.sin(t)};
    });
    expect(kind(hand(arc, 2))).not.toBe('brace');
  });
  test('"<" is not a brace', () => expect(kind(polyline([{x: 500, y: 100}, {x: 400, y: 350}, {x: 500, y: 600}]))).toBeNull());
  test('disabled', () => expect(kind(brace({x: 400, y: 100}, {x: 400, y: 600}, 60), {...opts, brace: false})).toBeNull());
});

describe('square roots', () => {
  const sqrt = (x: number, y: number, h: number, bar: number, tick = 0.35) =>
    polyline([
      {x, y: y - tick * h},
      {x: x + 0.3 * h, y},
      {x: x + 0.3 * h + 0.35 * h, y: y - h},
      {x: x + 0.65 * h + bar, y: y - h},
    ]);

  test('√ with a long bar', () => {
    const res = recognize(hand(sqrt(100, 500, 200, 500), 3), opts);
    expect(res.shape?.kind).toBe('sqrt');
    if (res.shape?.kind === 'sqrt') {
      const pts = res.shape.points;
      expect(pts[3].y).toBeCloseTo(pts[4].y, 5); // horizontal bar
      expect(pts[4].x).toBeGreaterThan(700); // keeps the drawn length
    }
  });
  test('small √', () => expect(kind(hand(sqrt(100, 300, 70, 90), 1))).toBe('sqrt'));
  test('tall √ over two lines', () => expect(kind(hand(sqrt(100, 700, 400, 300), 4))).toBe('sqrt'));

  test('check mark (no bar) is not a √', () =>
    expect(kind(polyline([{x: 100, y: 300}, {x: 160, y: 380}, {x: 330, y: 120}]))).toBeNull());
  test('disabled', () => expect(kind(sqrt(100, 500, 200, 500), {...opts, sqrt: false})).toBeNull());
});

describe('axes', () => {
  test('L drawn top → corner → right', () => {
    const res = recognize(hand(polyline([{x: 200, y: 100}, {x: 205, y: 700}, {x: 900, y: 690}]), 3), opts);
    expect(res.shape?.kind).toBe('axes');
    if (res.shape?.kind === 'axes') {
      expect(res.shape.xEnd.y).toBe(res.shape.origin.y);
      expect(res.shape.yEnd.x).toBe(res.shape.origin.x);
      expect(res.shape.xEnd.x).toBeGreaterThan(800);
      expect(res.shape.yEnd.y).toBeLessThan(200);
    }
  });
  test('drawn the other way (right → corner → top)', () =>
    expect(kind(hand(polyline([{x: 900, y: 700}, {x: 200, y: 700}, {x: 200, y: 100}]), 3))).toBe('axes'));
  test('slanted legs are not axes', () =>
    expect(kind(polyline([{x: 200, y: 100}, {x: 300, y: 700}, {x: 900, y: 600}]))).toBeNull());
  test('small "L" (handwriting) is not axes', () =>
    expect(kind(polyline([{x: 100, y: 100}, {x: 100, y: 180}, {x: 150, y: 180}]))).toBeNull());
});
