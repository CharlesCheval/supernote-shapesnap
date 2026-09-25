import {HoldTracker} from '../src/hold';

const pen = (action: number, x: number, y: number, t: number) => ({action, x, y, eventTime: t, downTime: 1, toolType: 2});

test('final pause measured between last movement and pen lift', () => {
  const h = new HoldTracker(() => 10);
  h.feed(pen(0, 0, 0, 1000), 0);
  for (let i = 1; i <= 20; i++) {
    h.feed(pen(2, i * 20, 0, 1000 + i * 10), 0); // fast stroke
  }
  h.feed(pen(2, 403, 2, 1300), 0); // jitter < 10 px
  h.feed(pen(1, 404, 1, 1800), 5000);
  expect(h.takeRecent(5100)).toBe(600);
  expect(h.takeRecent(5100)).toBeNull(); // consumed
});

test('no pause, stale measurement, finger ignored', () => {
  const h = new HoldTracker(() => 10);
  h.feed(pen(0, 0, 0, 0), 0);
  h.feed(pen(2, 100, 0, 50), 0);
  h.feed(pen(1, 100, 0, 60), 1000);
  expect(h.takeRecent(1100)).toBe(10);
  h.feed(pen(1, 100, 0, 60), 1000);
  expect(h.takeRecent(9000)).toBeNull();
  const f = new HoldTracker(() => 10);
  f.feed({...pen(1, 0, 0, 0), toolType: 1}, 0);
  expect(f.penSeen).toBe(false);
});
