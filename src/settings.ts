import {FileUtils, PluginManager} from 'sn-plugin-lib';

/**
 * Persistent settings. The SDK has no API to write a text file, so the JSON is
 * stored as the NAME of an empty folder in the plugin's private directory.
 */

export type Settings = {
  enabled: boolean;
  /** Still pause at the end of a stroke that triggers the snap (ms). */
  holdMs: number;
  /** Radius within which the pen counts as still (px). */
  stillRadius: number;
  /** Recognition tolerance, 1 (strict) to 5 (lenient). */
  tolerance: number;
  rect: boolean;
  /** Rectangles tilted less than this are straightened to the page axes (0 = never). */
  rectSnapDegrees: number;
  circle: boolean;
  /** Straight arrow: a shaft with a small head drawn at its end, in one stroke. */
  arrow: boolean;
  /** Arrows within this angle of horizontal / vertical are snapped to it (0 = never). */
  arrowSnapDegrees: number;
  /** Arrow head size, percent of the size set by the pen width. */
  arrowHeadPct: number;
  /** Curly brace, in any of the four directions. */
  brace: boolean;
  /** Square root sign, its bar as long as drawn. */
  sqrt: boolean;
  /** Coordinate axes, drawn as an "L". */
  axes: boolean;
  /** Axes arrow head size, percent of the size set by the pen width. */
  axesHeadPct: number;
  /** Draw ticks on the axes. */
  axesTicks: boolean;
  /** Tick line width, percent of the axis line width. */
  axesTickWidthPct: number;
  /** Distance between ticks (mm). */
  axesTickMm: number;
  /** Lasso-select the shape right after creating it (to resize it). */
  lassoAfter: boolean;
  /**
   * What happens to the hand-drawn stroke once the shape is inserted:
   * number = deleted by element number (works over writing, but resets undo history) ·
   * keep = left under the shape (keeps undo history).
   * The former `lasso` mode is gone: driving the lasso from a plugin could clash
   * with the user's own lasso selection.
   */
  replaceMode: ReplaceMode;
};

export type ReplaceMode = 'number' | 'keep';
export const REPLACE_MODES: ReplaceMode[] = ['number', 'keep'];

export const DEFAULTS: Settings = {
  enabled: true,
  holdMs: 0,
  stillRadius: 12,
  tolerance: 3,
  rect: true,
  rectSnapDegrees: 12,
  circle: true,
  arrow: true,
  arrowSnapDegrees: 8,
  arrowHeadPct: 100,
  brace: true,
  sqrt: true,
  axes: true,
  axesHeadPct: 100,
  axesTicks: true,
  axesTickWidthPct: 50,
  axesTickMm: 5,
  lassoAfter: true,
  replaceMode: 'number',
};

export const LIMITS = {
  holdMs: {min: 0, max: 1000, step: 25},
  stillRadius: {min: 4, max: 40, step: 2},
  tolerance: {min: 1, max: 5, step: 1},
  arrowSnapDegrees: {min: 0, max: 20, step: 1},
  rectSnapDegrees: {min: 0, max: 20, step: 1},
  arrowHeadPct: {min: 30, max: 200, step: 10},
  axesHeadPct: {min: 30, max: 200, step: 10},
  axesTickWidthPct: {min: 20, max: 100, step: 10},
  axesTickMm: {min: 2, max: 20, step: 1},
};

let current: Settings = {...DEFAULTS};
const listeners = new Set<() => void>();

export const getSettings = () => current;

/** Saved settings merged over the defaults; unknown modes (e.g. the removed `lasso`) fall back to the default. */
export function normalize(saved: Partial<Settings>): Settings {
  const s = {...DEFAULTS, ...saved};
  if (!REPLACE_MODES.includes(s.replaceMode)) {
    s.replaceMode = DEFAULTS.replaceMode;
  }
  for (const [k, {min, max}] of Object.entries(LIMITS) as [keyof typeof LIMITS, {min: number; max: number}][]) {
    const v = s[k];
    s[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULTS[k];
  }
  return s;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Storage: one folder per setting, named `key=value` (value as encoded JSON),
 * plus a `~complete` marker. The whole settings as ONE folder name (the former
 * format) grew past the 255-character limit of a file name once the per-shape
 * settings were added: every save then deleted the old folder and failed to
 * create the new one. Names here stay short whatever the number of settings.
 */
const COMPLETE = '~complete';

export function encodeEntries(s: Settings): string[] {
  return [
    ...Object.entries(s).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`),
    COMPLETE,
  ];
}

/** Settings read back from folder names; null when the set is incomplete or unreadable. */
export function decodeEntries(names: string[]): Partial<Settings> | null {
  if (names.includes(COMPLETE)) {
    const out: Record<string, unknown> = {};
    for (const name of names) {
      const at = name.indexOf('=');
      if (at > 0) {
        try {
          out[name.slice(0, at)] = JSON.parse(decodeURIComponent(name.slice(at + 1)));
        } catch {
          // unreadable value: its default is used
        }
      }
    }
    return out as Partial<Settings>;
  }
  // Former format: the whole JSON as one folder name.
  for (const name of names) {
    try {
      const saved = JSON.parse(decodeURIComponent(name));
      if (saved && typeof saved === 'object') {
        return saved;
      }
    } catch {
      // not a settings entry
    }
  }
  return null;
}

async function baseDir(): Promise<string | null> {
  return (await PluginManager.getPluginDirPath()) ?? null;
}

async function entryNames(dir: string): Promise<string[]> {
  if (!(await FileUtils.exists(dir))) {
    return [];
  }
  // Typed as strings, but the native module returns {path, type} objects.
  const entries: unknown[] = (await FileUtils.listFiles(dir)) ?? [];
  const names: string[] = [];
  for (const entry of entries) {
    const path = typeof entry === 'string' ? entry : (entry as {path?: string} | null)?.path;
    if (typeof path === 'string') {
      const name = path.replace(/\/+$/, '');
      names.push(name.slice(name.lastIndexOf('/') + 1));
    }
  }
  return names;
}

export async function loadSettings() {
  try {
    const base = await baseDir();
    if (!base) {
      return;
    }
    // `settings.new` is a save that was not renamed into place (interrupted).
    for (const dir of [`${base}/settings`, `${base}/settings.new`]) {
      const saved = decodeEntries(await entryNames(dir));
      if (saved) {
        current = normalize(saved);
        listeners.forEach(fn => fn());
        return;
      }
    }
  } catch (e) {
    console.warn('[ShapeSnap] loadSettings', e);
  }
}

let writes: Promise<void> = Promise.resolve();

export function updateSettings(patch: Partial<Settings>) {
  current = {...current, ...patch};
  listeners.forEach(fn => fn());
  const snapshot = current;
  writes = writes
    .then(async () => {
      if (snapshot !== current) {
        return; // a newer value will be written
      }
      const base = await baseDir();
      if (!base) {
        return;
      }
      // Written aside first: the saved settings are replaced only by a complete set.
      const next = `${base}/settings.new`;
      await FileUtils.deleteDir(next);
      if (!(await FileUtils.makeDir(next))) {
        return;
      }
      for (const name of encodeEntries(snapshot)) {
        if (!(await FileUtils.makeDir(`${next}/${name}`))) {
          console.warn('[ShapeSnap] saveSettings: could not write', name);
          return;
        }
      }
      await FileUtils.deleteDir(`${base}/settings`);
      await FileUtils.renameToFile(next, `${base}/settings`);
    })
    .catch(e => console.warn('[ShapeSnap] saveSettings', e));
}
