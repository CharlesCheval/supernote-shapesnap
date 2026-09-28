import {strokeOrigin, isInk} from '../src/guard';

test('lasso paths (penType 4) are never treated as ink', () => {
  expect(strokeOrigin(4)).toBe('lasso');
  expect(isInk(4)).toBe(false);
});

test('documented ink pens are accepted', () => {
  for (const t of [1, 10, 11, 15]) {
    expect(isInk(t)).toBe(true);
  }
});

test('unknown or missing pen types are ignored', () => {
  for (const t of [0, 2, 3, 5, 99, -1, undefined, null, '1']) {
    expect(strokeOrigin(t)).not.toBe('ink');
  }
});
