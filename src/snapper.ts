import {Element, PluginCommAPI, PluginFileAPI, PluginManager, PluginNoteAPI, PointUtils} from 'sn-plugin-lib';
import {HoldTracker, PenMotion} from './hold';
import {P, Recognition, Shape, recognize, trailingStillCount} from './recognize';
import {getSettings} from './settings';

/**
 * Flow: stroke finished (event_pen_up) -> long enough final pause? -> shape recognized?
 *       -> delete the stroke -> insert a native geometry drawn with the active pen,
 *          selected with the lasso so it can be resized right away.
 */

/** Assumed pen sampling rate, only used when no pen clock is available (fallback). */
const ASSUMED_POINTS_PER_SECOND = 100;
const TAIL_POINTS = 200;
const MIN_SHAPE_SIZE = 60;

const hold = new HoldTracker(() => getSettings().stillRadius);

// ---------------------------------------------------------------------------
// Last measurement, shown on the settings screen
// ---------------------------------------------------------------------------

export type Measure = {
  at: number;
  stillMs: number;
  holdSource: 'clock' | 'points';
  result: string;
  details: string[];
};

export let lastMeasure: Measure | null = null;
const listeners = new Set<() => void>();

export function subscribeMeasures(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function report(m: Omit<Measure, 'at'>) {
  lastMeasure = {...m, at: Date.now()};
  listeners.forEach(fn => fn());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function ok<T>(res: any): T | null {
  return res?.success ? (res.result as T) : null;
}

function errorText(res: any): string {
  return res?.error ? `${res.error.message ?? 'unknown'} (code ${res.error.code ?? '?'})` : 'no result';
}

type Size = {width: number; height: number};

const validSize = (s: any): s is Size => s && s.width > 1 && s.height > 1;

/** Page size in pixels, used to convert EMR points. Integer values are required by PointUtils. */
async function pageSize(page: number): Promise<Size | null> {
  let size = ok<Size>(await PluginCommAPI.getPageDisplaySize());
  if (!validSize(size)) {
    const path = ok<string>(await PluginCommAPI.getCurrentFilePath());
    size = path ? ok<Size>(await PluginFileAPI.getPageSize(path, page)) : null;
  }
  return validSize(size) ? {width: Math.round(size.width), height: Math.round(size.height)} : null;
}

type PointSet = {label: string; points: P[]};

/** Stroke points in page pixels, from every source the SDK offers. */
async function pixelPointSets(el: Element, size: number): Promise<PointSet[]> {
  const sets: PointSet[] = [];
  const stroke = el.stroke!;
  // 1. Recognition points: already in pixels.
  try {
    const n = await stroke.recognPoints.size();
    if (n >= 8) {
      const data = await stroke.recognPoints.getRange(0, n);
      sets.push({label: 'recogn', points: data.map(d => ({x: d.X, y: d.Y}))});
    }
  } catch {
    // not available on this stroke
  }
  // 2. Sample points in EMR coordinates, converted to pixels.
  try {
    const ps = await pageSize(el.pageNum);
    if (ps) {
      const emr = await stroke.points.getRange(0, size);
      sets.push({label: `emr→px ${ps.width}×${ps.height}`, points: emr.map(p => PointUtils.emrPoint2Android(p, ps))});
    }
  } catch (e: any) {
    sets.push({label: `emr→px failed: ${e?.message ?? e}`, points: []});
  }
  return sets;
}

function describe(label: string, r: Recognition): string {
  const m = r.metrics;
  if (!m) {
    return `${label}: ${r.reason}`;
  }
  return (
    `${label}: ${r.reason} — ${Math.round(m.width)}×${Math.round(m.height)} px, gap ${(m.gap * 100).toFixed(0)}%, ` +
    `corners ${m.corners}, rect err ${(m.rectErr * 100).toFixed(1)}%, circle err ${(m.circErr * 100).toFixed(1)}%, ` +
    `angle ${m.angle}°`
  );
}

function geometryFor(shape: Shape, pen: {type: number; color: number; width: number}, lasso: boolean) {
  const base = {
    showLassoAfterInsert: lasso,
    penColor: pen.color,
    penType: pen.type,
    penWidth: Math.max(100, pen.width),
  };
  if (shape.kind === 'circle') {
    return {
      ...base,
      type: 'GEO_circle',
      points: [],
      ellipseCenterPoint: {x: Math.round(shape.cx), y: Math.round(shape.cy)},
      ellipseMajorAxisRadius: Math.round(shape.r),
      ellipseMinorAxisRadius: Math.round(shape.r),
      ellipseAngle: 0,
    };
  }
  const pts = shape.corners.map(p => ({x: Math.round(p.x), y: Math.round(p.y)}));
  return {
    ...base,
    type: 'GEO_polygon',
    points: [...pts, pts[0]],
    ellipseCenterPoint: null,
    ellipseMajorAxisRadius: 0,
    ellipseMinorAxisRadius: 0,
    ellipseAngle: 0,
  };
}

// ---------------------------------------------------------------------------
// Stroke handling
// ---------------------------------------------------------------------------

async function measureHold(stroke: NonNullable<Element['stroke']>, size: number, page: number) {
  let stillMs = hold.takeRecent(Date.now());
  if (stillMs == null && hold.penSeen) {
    await sleep(80); // the pen-up motion event may arrive just after the stroke event
    stillMs = hold.takeRecent(Date.now());
  }
  if (stillMs != null) {
    return {stillMs, holdSource: 'clock' as const};
  }
  // Fallback: count still points at the end of the stroke.
  const count = Math.min(TAIL_POINTS, size);
  const ps = await pageSize(page);
  const tail = ps ? (await stroke.points.getRange(size - count, count)).map(p => PointUtils.emrPoint2Android(p, ps)) : [];
  const still = trailingStillCount(tail, getSettings().stillRadius);
  return {stillMs: Math.round((still * 1000) / ASSUMED_POINTS_PER_SECOND), holdSource: 'points' as const};
}

// Deleting an element by number counts as a file write (code 1501 without FILE:WRITE).
const PERMISSIONS = ['plugin.permission.FILE:READ', 'plugin.permission.FILE:WRITE'];
let fileAccess: boolean | null = null;

/** Asks once for file access; "Always allow" makes it permanent. */
async function ensureFileAccess(): Promise<boolean> {
  if (fileAccess) {
    return true;
  }
  for (const permission of PERMISSIONS) {
    if ((await PluginManager.hasPermission(permission)) >= 1) {
      continue;
    }
    const choice = await PluginManager.requestPermission(
      permission,
      'ShapeSnap replaces your stroke with a clean shape, which requires editing the page.',
    );
    if (choice !== 1 && choice !== 2) {
      fileAccess = false;
      return false;
    }
  }
  fileAccess = true;
  return true;
}

type StrokeSignature = {size: number; first: P; last: P};

async function signatureOf(el: Element): Promise<StrokeSignature | null> {
  const points = el.stroke?.points;
  if (el.type !== Element.TYPE_STROKE || !points) {
    return null;
  }
  const size = await points.size();
  if (size < 1) {
    return null;
  }
  const [first, last] = await Promise.all([points.get(0), points.get(size - 1)]);
  return first && last ? {size, first, last} : null;
}

const samePoint = (a: P, b: P) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

/** Same stroke = same first and last sample point (EMR coordinates are copied verbatim). */
async function matches(candidate: Element, target: StrokeSignature): Promise<boolean> {
  const sig = await signatureOf(candidate);
  return !!sig && samePoint(sig.first, target.first) && samePoint(sig.last, target.last);
}

/**
 * The element delivered by event_pen_up has no page number yet (numInPage = 0):
 * the host assigns it when the stroke is committed, so we look for the committed copy.
 * Fast path: the page's last element. It is not always our stroke, e.g. when
 * geometries are on the page, hence the scan below.
 */
async function findByLastElement(target: StrokeSignature, page: number): Promise<{num: number | null; why: string}> {
  const res: any = await PluginFileAPI.getLastElement();
  const last = ok<Element>(res);
  if (!last) {
    return {num: null, why: `last element: ${errorText(res)}`};
  }
  try {
    if (last.numInPage >= 1 && (last.pageNum == null || last.pageNum === page) && (await matches(last, target))) {
      return {num: last.numInPage, why: 'last element'};
    }
    return {num: null, why: `last element is another one (type ${last.type})`};
  } finally {
    PluginCommAPI.recycleElement(last.uuid);
  }
}

/**
 * Last resort: scans the page's elements, newest first. It needs the note saved
 * to disk first, and saving resets Supernote's undo history, so it only runs when
 * the in-memory lookups (last element, lasso) both failed.
 */
async function findByScan(target: StrokeSignature, page: number): Promise<{num: number | null; why: string}> {
  const path = ok<string>(await PluginCommAPI.getCurrentFilePath());
  if (!path) {
    return {num: null, why: 'scan: no current file'};
  }
  if (path.toLowerCase().endsWith('.note')) {
    await PluginNoteAPI.saveCurrentNote(); // file reads need the latest stroke on disk
  }
  const listRes: any = await PluginFileAPI.getElementNumList(path, page);
  const list = ok<number[]>(listRes);
  if (!list) {
    return {num: null, why: `scan: ${errorText(listRes)}`};
  }
  const newest = [...list].sort((a, b) => b - a).slice(0, 40);
  for (const n of newest) {
    const e = ok<Element>(await PluginFileAPI.getElement(path, page, n));
    if (!e) {
      continue;
    }
    try {
      if (await matches(e, target)) {
        return {num: n, why: `scan (${list.length} elements, note saved: undo history reset)`};
      }
    } finally {
      PluginCommAPI.recycleElement(e.uuid);
    }
  }
  return {num: null, why: `scan: not found among the ${newest.length} newest elements`};
}

/**
 * Lasso deletion, the only removal that keeps Supernote's undo history.
 * The lasso box is hidden right away to limit flicker; the stroke is deleted only
 * if it is the sole element in its bounding box (never someone else's writing).
 */
async function lassoDeleteIfAlone(page: number, points: P[]): Promise<{ok: boolean; how: string}> {
  const ps = await pageSize(page);
  if (!ps || !points.length) {
    return {ok: false, how: 'lasso: no page size'};
  }
  const pad = 6;
  const rect = {
    left: Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - pad)),
    top: Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - pad)),
    right: Math.min(ps.width, Math.ceil(Math.max(...points.map(p => p.x)) + pad)),
    bottom: Math.min(ps.height, Math.ceil(Math.max(...points.map(p => p.y)) + pad)),
  };
  await PluginCommAPI.setLassoBoxState(2).catch(() => undefined); // drop the previous shape's lasso
  const lassoRes: any = await PluginCommAPI.lassoElements(rect);
  if (!ok<boolean>(lassoRes)) {
    return {ok: false, how: `lasso failed: ${errorText(lassoRes)}`};
  }
  await PluginCommAPI.setLassoBoxState(1).catch(() => undefined); // hide the box: less flicker
  const selected = ok<Element[]>(await PluginCommAPI.getLassoElements()) ?? [];
  selected.forEach(e => e?.uuid && PluginCommAPI.recycleElement(e.uuid));
  if (selected.length !== 1) {
    await PluginCommAPI.setLassoBoxState(2).catch(() => undefined);
    return {ok: false, how: `lasso: ${selected.length} elements in the area, stroke kept`};
  }
  const del: any = await PluginCommAPI.deleteLassoElements();
  return ok<boolean>(del) ? {ok: true, how: 'lasso delete'} : {ok: false, how: `lasso delete failed: ${errorText(del)}`};
}

/** Delete by element number: works over writing, but resets the undo history. */
async function deleteByNumber(el: Element): Promise<{ok: boolean; how: string}> {
  if (!(await ensureFileAccess())) {
    return {ok: false, how: 'file access denied'};
  }
  const target = await signatureOf(el);
  if (!target) {
    return {ok: false, how: 'stroke has no points'};
  }
  let found: {num: number | null; why: string} =
    el.numInPage >= 1 ? {num: el.numInPage, why: 'pen-up element'} : await findByLastElement(target, el.pageNum);
  const tried = [found.why];
  if (found.num == null) {
    found = await findByScan(target, el.pageNum);
    tried.push(found.why);
  }
  if (found.num == null) {
    return {ok: false, how: tried.join('; ')};
  }
  const res: any = await PluginCommAPI.deletePageElements([found.num], el.pageNum, el.layerNum);
  return ok<boolean>(res)
    ? {ok: true, how: `#${found.num} via ${tried.join(' → ')}`}
    : {ok: false, how: `#${found.num} via ${tried.join(' → ')}: ${errorText(res)}`};
}

/**
 * Removes the hand-drawn stroke according to the "Stroke removal" setting.
 * `removed: false` means the stroke stays under the shape (keep mode, or lasso
 * mode when other elements share the area), which is not an error.
 */
async function removeStroke(el: Element, points: P[]): Promise<{ok: boolean; removed: boolean; how: string}> {
  switch (getSettings().replaceMode) {
    case 'keep':
      return {ok: true, removed: false, how: 'kept under the shape'};
    case 'lasso': {
      const r = await lassoDeleteIfAlone(el.pageNum, points);
      return {ok: true, removed: r.ok, how: r.how};
    }
    case 'number': {
      const r = await deleteByNumber(el);
      return {ok: r.ok, removed: r.ok, how: r.how};
    }
  }
}

async function currentPlace(): Promise<string> {
  const [path, page] = await Promise.all([PluginCommAPI.getCurrentFilePath(), PluginCommAPI.getCurrentPageNum()]);
  return `${ok<string>(path) ?? '?'}#${ok<number>(page) ?? '?'}`;
}

async function handleStroke(el: Element) {
  const settings = getSettings();
  const stroke = el.stroke;
  if (!stroke) {
    return;
  }
  const place = await currentPlace();
  const size = await stroke.points.size();
  if (size < 8) {
    return;
  }
  // Hold of 0 ms: snap as soon as the pen lifts, no need to measure.
  const {stillMs, holdSource} =
    settings.holdMs > 0 ? await measureHold(stroke, size, el.pageNum) : {stillMs: 0, holdSource: 'clock' as const};
  if (stillMs < settings.holdMs) {
    report({stillMs, holdSource, result: 'no pause: stroke kept', details: []});
    return;
  }

  // Try each point source; keep the first that yields a shape.
  const details: string[] = [];
  let shape: Shape | null = null;
  let shapePoints: P[] = [];
  for (const set of await pixelPointSets(el, size)) {
    const r = recognize(set.points, {
      tolerance: settings.tolerance,
      minSize: MIN_SHAPE_SIZE,
      rect: settings.rect,
      circle: settings.circle,
    });
    details.push(describe(set.label, r));
    if (r.shape) {
      shape = r.shape;
      shapePoints = set.points;
      break;
    }
    if (r.reason.startsWith('too small')) {
      break; // handwriting: the other source would say the same
    }
  }
  if (!shape) {
    report({stillMs, holdSource, result: 'pause detected, shape not recognized', details});
    return;
  }

  // Active pen style; fall back to the stroke's own style.
  const pen = ok<{type: number; color: number; width: number}>(await PluginCommAPI.getPenInfo()) ?? {
    type: stroke.penType,
    color: stroke.penColor,
    width: 100,
  };

  // Never edit a page the user has already left (e.g. after a swipe to another file).
  if ((await currentPlace()) !== place) {
    report({stillMs, holdSource, result: 'cancelled: file or page changed', details});
    return;
  }
  // Remove the stroke first (per setting), then insert the shape; restore the stroke if insertion fails.
  const deletion = await removeStroke(el, shapePoints);
  details.push(`stroke: ${deletion.how}`);
  if (!deletion.ok) {
    report({stillMs, holdSource, result: 'failed: stroke could not be deleted', details});
    return;
  }
  if ((await currentPlace()) !== place) {
    report({stillMs, holdSource, result: 'cancelled: file or page changed after deleting the stroke', details});
    return;
  }
  const inserted = ok<boolean>(await PluginCommAPI.insertGeometry(geometryFor(shape, pen, settings.lassoAfter) as any));
  if (!inserted) {
    if (deletion.removed) {
      await PluginCommAPI.insertPageElements([el], el.pageNum, el.layerNum);
    }
    report({stillMs, holdSource, result: 'failed: shape not inserted, stroke restored', details});
    return;
  }
  report({stillMs, holdSource, result: shape.kind === 'rect' ? '▭ rectangle created' : '◯ circle created', details});
}

let queue: Promise<void> = Promise.resolve();

function onPenUp(msg: unknown) {
  const elements = (Array.isArray(msg) ? msg : []) as Element[];
  const release = () => elements.forEach(e => e?.uuid && PluginCommAPI.recycleElement(e.uuid));
  if (!getSettings().enabled || !elements.length) {
    release();
    return;
  }
  const strokes = elements.filter(e => e?.type === Element.TYPE_STROKE && e.stroke);
  const last = strokes[strokes.length - 1];
  queue = queue
    .then(() => (last ? handleStroke(last) : undefined))
    .catch((e: any) =>
      report({stillMs: 0, holdSource: 'clock', result: `error: ${e?.message ?? e}`, details: []}),
    )
    .finally(release);
}

export function start() {
  PluginManager.registerMotionListener(1, {
    onMsg(msg: unknown) {
      const e = msg as PenMotion;
      if (e && typeof e.eventTime === 'number') {
        hold.feed(e, Date.now());
      }
    },
  });
  PluginManager.registerEventListener('event_pen_up', 1, {onMsg: onPenUp});
}
