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
  circle: boolean;
  /** Straight arrow: a shaft with a small head drawn at its end, in one stroke. */
  arrow: boolean;
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
  circle: true,
  arrow: true,
  lassoAfter: true,
  replaceMode: 'number',
};

export const LIMITS = {
  holdMs: {min: 0, max: 1000, step: 25},
  stillRadius: {min: 4, max: 40, step: 2},
  tolerance: {min: 1, max: 5, step: 1},
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
  return s;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function settingsDir(): Promise<string | null> {
  const dir = await PluginManager.getPluginDirPath();
  return dir ? `${dir}/settings` : null;
}

export async function loadSettings() {
  try {
    const dir = await settingsDir();
    if (!dir || !(await FileUtils.exists(dir))) {
      return;
    }
    // Typed as strings, but the native module returns {path, type} objects.
    const entries: unknown[] = (await FileUtils.listFiles(dir)) ?? [];
    for (const entry of entries) {
      const path = typeof entry === 'string' ? entry : (entry as {path?: string} | null)?.path;
      if (typeof path !== 'string') {
        continue;
      }
      const name = path.replace(/\/+$/, '');
      try {
        const saved = JSON.parse(decodeURIComponent(name.slice(name.lastIndexOf('/') + 1)));
        current = normalize(saved);
        listeners.forEach(fn => fn());
        return;
      } catch {
        // unreadable entry: try the next one
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
      const dir = await settingsDir();
      if (!dir) {
        return;
      }
      await FileUtils.deleteDir(dir);
      await FileUtils.makeDir(dir);
      await FileUtils.makeDir(`${dir}/${encodeURIComponent(JSON.stringify(snapshot))}`);
    })
    .catch(e => console.warn('[ShapeSnap] saveSettings', e));
}
