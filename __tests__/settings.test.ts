jest.mock('sn-plugin-lib', () => ({FileUtils: {}, PluginManager: {}}));
import {DEFAULTS, decodeEntries, encodeEntries, normalize} from '../src/settings';

test('stroke removal defaults to number', () => {
  expect(DEFAULTS.replaceMode).toBe('number');
});

test('the removed lasso mode migrates to number', () => {
  expect(normalize({replaceMode: 'lasso' as any}).replaceMode).toBe('number');
});

test('keep is preserved, other settings are merged over the defaults', () => {
  const s = normalize({replaceMode: 'keep', holdMs: 300});
  expect(s.replaceMode).toBe('keep');
  expect(s.holdMs).toBe(300);
  expect(s.circle).toBe(DEFAULTS.circle);
});

test('new per-shape settings: defaults, and saved values brought back in range', () => {
  const s = normalize({arrowHeadPct: 999, axesTickMm: 0, rectSnapDegrees: 'x' as any});
  expect(s.arrowHeadPct).toBe(200);
  expect(s.axesTickMm).toBe(2);
  expect(s.rectSnapDegrees).toBe(8);
  expect(normalize({}).axesTickWidthPct).toBe(50);
});

test('saved as short folder names (a file name is limited to 255 characters)', () => {
  const names = encodeEntries({...DEFAULTS, arrowHeadPct: 140, replaceMode: 'keep'});
  expect(Math.max(...names.map(n => n.length))).toBeLessThan(60);
  const back = normalize(decodeEntries(names)!);
  expect(back).toEqual({...DEFAULTS, arrowHeadPct: 140, replaceMode: 'keep'});
});

test('an incomplete save is not read; the former one-name format still is', () => {
  const names = encodeEntries(DEFAULTS).filter(n => n !== '~complete');
  expect(decodeEntries(names)).toBeNull();
  const legacy = encodeURIComponent(JSON.stringify({holdMs: 300, replaceMode: 'keep'}));
  expect(normalize(decodeEntries([legacy])!).holdMs).toBe(300);
});
