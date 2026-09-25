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
  /** Lasso-select the shape right after creating it (to resize it). */
  lassoAfter: boolean;
  /**
   * How the hand-drawn stroke is removed once the shape is inserted:
   * lasso = lasso-deleted when alone in its area (keeps undo history, brief flicker) ·
   * keep = left under the shape (keeps undo history) ·
   * number = deleted by element number (works over writing, but resets undo history).
   */
  replaceMode: ReplaceMode;
};

export type ReplaceMode = 'number' | 'lasso' | 'keep';
export const REPLACE_MODES: ReplaceMode[] = ['lasso', 'keep', 'number'];

export const DEFAULTS: Settings = {
  enabled: true,
  holdMs: 0,
  stillRadius: 12,
  tolerance: 3,
  rect: true,
  circle: true,
  lassoAfter: true,
  replaceMode: 'lasso',
};

export const LIMITS = {
  holdMs: {min: 0, max: 1000, step: 25},
  stillRadius: {min: 4, max: 40, step: 2},
  tolerance: {min: 1, max: 5, step: 1},
};

let current: Settings = {...DEFAULTS};
const listeners = new Set<() => void>();

export const getSettings = () => current;

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
    const entries = (await FileUtils.listFiles(dir)) ?? [];
    for (const entry of entries) {
      const name = entry.replace(/\/+$/, '');
      try {
        const saved = JSON.parse(decodeURIComponent(name.slice(name.lastIndexOf('/') + 1)));
        current = {...DEFAULTS, ...saved};
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
