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
  test('quick chevron "<" is a brace', () =>
    expect(kind(polyline([{x: 500, y: 100}, {x: 400, y: 350}, {x: 500, y: 600}]))).toBe('brace'));
  test('"S" is not a brace', () =>
    expect(kind(polyline([{x: 400, y: 100}, {x: 300, y: 200}, {x: 400, y: 300}, {x: 500, y: 400}, {x: 400, y: 500}]))).toBeNull());
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

/**
 * Strokes traced from real drawings on a Manta (screenshot coordinates, 1500 px
 * wide, scaled to the 1920 px screen), smoothed into dense polylines.
 */
const real = (pts: [number, number][]) =>
  polyline(
    pts.map(([x, y]) => ({x: x * 1.28, y: y * 1.28})),
    8,
  );

describe('real drawings', () => {
  test('tilted "L" with a long leg is not a brace', () =>
    expect(kind(real([[1120, 585], [1128, 640], [1135, 700], [1140, 755], [1180, 785], [1240, 812]]))).toBeNull());
  test.each([
    ['two arcs and a zigzag', [[418, 1645], [400, 1660], [385, 1685], [382, 1705], [390, 1728], [405, 1745], [395, 1755], [390, 1762], [400, 1770], [408, 1778], [395, 1795], [392, 1815], [400, 1840], [418, 1860]]],
    ['wide arcs, small notch', [[290, 620], [265, 640], [242, 665], [233, 690], [236, 715], [250, 735], [270, 748], [287, 757], [280, 765], [273, 775], [277, 790], [272, 800], [262, 820], [256, 845], [258, 870], [268, 890], [283, 905]]],
    ['underbrace', [[820, 1530], [822, 1550], [835, 1570], [850, 1577], [870, 1568], [895, 1560], [905, 1565], [910, 1578], [915, 1567], [925, 1567], [940, 1578], [960, 1580], [980, 1570], [995, 1552], [998, 1538]]],
    ['chevron with curved arms', [[390, 1043], [375, 1080], [350, 1120], [322, 1160], [345, 1185], [365, 1210], [380, 1240], [405, 1292]]],
  ] as [string, [number, number][]][])('brace: %s', (_, pts) => expect(kind(real(pts))).toBe('brace'));

  test.each([
    ['"‾|" entry', [[975, 1683], [990, 1683], [1003, 1688], [1005, 1700], [1003, 1712], [1002, 1720], [1006, 1700], [1010, 1675], [1013, 1656], [1015, 1655], [1100, 1653], [1180, 1651], [1255, 1651]]],
    ['hooked entry, rising bar', [[1060, 623], [1085, 622], [1105, 625], [1108, 640], [1105, 662], [1110, 640], [1113, 610], [1115, 597], [1200, 595], [1297, 591]]],
    ['leaning rise', [[1040, 890], [1060, 888], [1073, 892], [1072, 905], [1065, 920], [1072, 895], [1077, 860], [1078, 848], [1150, 846], [1247, 847]]],
    ['bar drooping at the end', [[842, 1032], [870, 1034], [890, 1037], [882, 1060], [872, 1085], [878, 1050], [876, 1000], [950, 998], [1030, 1000], [1075, 1012]]],
  ] as [string, [number, number][]][])('square root: %s', (_, pts) => expect(kind(real(pts))).toBe('sqrt'));
});
