jest.mock('sn-plugin-lib', () => ({FileUtils: {}, PluginManager: {}}));
import {DEFAULTS, normalize} from '../src/settings';

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
  expect(s.rectSnapDegrees).toBe(12);
  expect(normalize({}).axesTickWidthPct).toBe(50);
});
