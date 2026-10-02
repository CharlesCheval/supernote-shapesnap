import {Element, PluginCommAPI, PluginFileAPI, PluginManager, PluginNoteAPI, PointUtils} from 'sn-plugin-lib';
import {isInk, strokeOrigin} from './guard';
import {HoldTracker, PenMotion} from './hold';
import {P, Recognition, Shape, arrowPoints, recognize, trailingStillCount} from './recognize';
import {axisPoints} from './symbols';
import {getSettings} from './settings';

/**
 * Flow: stroke finished (event_pen_up) -> drawn with an ink pen (not the lasso)?
 *       -> long enough final pause? -> shape recognized?
 *       -> delete the stroke by element number -> insert a native geometry drawn
 *          with the active pen, selected with the lasso so it can be resized right away.
 *
 * The plugin never drives the lasso itself (no lassoElements / setLassoBoxState /
 * deleteLassoElements): doing so could clash with the user's own lasso selection.
 */

/** Assumed pen sampling rate, only used when no pen clock is available (fallback). */
const ASSUMED_POINTS_PER_SECOND = 100;
const TAIL_POINTS = 200;
const MIN_SHAPE_SIZE = 60;
/**
 * Tiny shapes (setting): down to about 2 mm, but only after a pause at the end
 * of the stroke, so that letters such as "o" or "0" written at speed stay ink.
 */
const TINY_SHAPE_SIZE = 24;
const TINY_HOLD_MS = 300;

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

/**
 * The stroke's points in some roughly-pixel-scaled space, and how to map a point
 * of that space back to page pixels (where geometries are inserted).
 */
type PointSet = {label: string; points: P[]; toPixel: (p: P) => P};

const identity = (p: P) => p;

/** Stroke points from every source the SDK offers, tried in order. */
async function pointSets(el: Element, size: number): Promise<PointSet[]> {
  const sets: PointSet[] = [];
  const stroke = el.stroke!;
  // 1. Recognition points: already in pixels.
  try {
    const n = await stroke.recognPoints.size();
    if (n >= 8) {
      const data = await stroke.recognPoints.getRange(0, n);
      sets.push({label: 'recogn', points: data.map(d => ({x: d.X, y: d.Y})), toPixel: identity});
    }
  } catch {
    // not available on this stroke
  }
  // 2. Sample points in EMR coordinates, converted to pixels with the page size.
  // 3. The same raw EMR points, only scaled: immune to a wrong page size (zoom, landscape).
  try {
    const ps = await pageSize(el.pageNum);
    const emr = await stroke.points.getRange(0, size);
    if (ps) {
      sets.push({
        label: `emr→px ${ps.width}×${ps.height}`,
        points: emr.map(p => PointUtils.emrPoint2Android(p, ps)),
        toPixel: identity,
      });
      const k = (Math.max(ps.width, ps.height) - 1) / PointUtils.getRealMaxX(ps);
      sets.push({
        label: 'emr (raw)',
        points: emr.map(p => ({x: p.x * k, y: p.y * k})),
        toPixel: q => PointUtils.emrPoint2Android({x: q.x / k, y: q.y / k}, ps),
      });
    }
  } catch (e: any) {
    sets.push({label: `emr failed: ${e?.message ?? e}`, points: [], toPixel: identity});
  }
  return sets;
}

/** Maps a recognized shape from its point space to page pixels. */
function shapeToPixels(shape: Shape, toPixel: (p: P) => P): Shape {
  if (shape.kind === 'rect') {
    const [a, b, c, d] = shape.corners.map(toPixel);
    return {kind: 'rect', corners: [a, b, c, d]};
  }
  if (shape.kind === 'arrow') {
    return {kind: 'arrow', tail: toPixel(shape.tail), tip: toPixel(shape.tip)};
  }
  if (shape.kind === 'brace' || shape.kind === 'sqrt') {
    return {kind: shape.kind, points: shape.points.map(toPixel)};
  }
  if (shape.kind === 'axes') {
    return {kind: 'axes', origin: toPixel(shape.origin), xEnd: toPixel(shape.xEnd), yEnd: toPixel(shape.yEnd)};
  }
  const center = toPixel({x: shape.cx, y: shape.cy});
  const rx = toPixel({x: shape.cx + shape.r, y: shape.cy});
  const ry = toPixel({x: shape.cx, y: shape.cy + shape.r});
  const r = (Math.hypot(rx.x - center.x, rx.y - center.y) + Math.hypot(ry.x - center.x, ry.y - center.y)) / 2;
  return {kind: 'circle', cx: center.x, cy: center.y, r};
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

/**
 * Arrow head length (px), set by the pen width only, never by the drawn head.
 * Pen widths are about 100 units per pixel of line (0.5 pen ≈ 600 ≈ 6 px):
 * 0.2 → 34 px, 0.5 → 43 px, 1.0 → 62 px, 2.0 → 101 px.
 */
function arrowHeadLength(penWidth: number): number {
  return Math.round(Math.min(130, 24 + (3.2 * penWidth) / 100));
}

/** Screen pixels per millimetre (Manta: about 300 ppi). */
const PX_PER_MM = 300 / 25.4;

type Pen = {type: number; color: number; width: number};

type Look = {
  arrowHeadPct: number;
  axesHeadPct: number;
  axesTicks: boolean;
  axesTickWidthPct: number;
  axesTickMm: number;
};

/** Geometries to insert for a shape (axes need four: each axis and its ticks). */
function geometriesFor(shape: Shape, pen: Pen, lasso: boolean, look: Look): object[] {
  const base = {
    penColor: pen.color,
    penType: pen.type,
    penWidth: Math.max(100, pen.width),
  };
  const polyline = (pts: P[], select: boolean, width = base.penWidth) => ({
    ...base,
    penWidth: Math.max(100, Math.round(width)),
    showLassoAfterInsert: select,
    type: 'GEO_polygon',
    points: pts.map(p => ({x: Math.round(p.x), y: Math.round(p.y)})),
    ellipseCenterPoint: null,
    ellipseMajorAxisRadius: 0,
    ellipseMinorAxisRadius: 0,
    ellipseAngle: 0,
  });
  // Head length and fill spacing from the pen width (about penWidth / 100 px of line).
  const head = arrowHeadLength(base.penWidth);
  const fill = Math.max(2, (0.4 * base.penWidth) / 100);
  switch (shape.kind) {
    case 'arrow':
      // One polyline: shaft, triangular head, then rungs that fill the head.
      return [polyline(arrowPoints(shape.tail, shape.tip, (head * look.arrowHeadPct) / 100, fill), lasso)];
    case 'brace':
    case 'sqrt':
      return [polyline(shape.points, lasso)];
    case 'axes': {
      // Each axis: the line with its filled head, then its ticks as a separate,
      // thinner polyline (drawn out and back across the axis, travelling along it
      // underneath, where the thicker axis hides it).
      const axisHead = (head * look.axesHeadPct) / 100;
      const tick = Math.max(8, (2 * base.penWidth) / 100);
      const tickWidth = (base.penWidth * look.axesTickWidthPct) / 100;
      const out: object[] = [];
      for (const end of [shape.xEnd, shape.yEnd]) {
        // No lasso: it would only select one of the pieces.
        out.push(polyline(arrowPoints(shape.origin, end, axisHead, fill), false));
        const ticks = axisPoints(shape.origin, end, look.axesTickMm * PX_PER_MM, tick, axisHead).slice(0, -1);
        if (look.axesTicks && ticks.length > 1) {
          out.push(polyline(ticks, false, tickWidth));
        }
      }
      return out;
    }
    case 'circle':
      return [
        {
          ...base,
          showLassoAfterInsert: lasso,
          type: 'GEO_circle',
          points: [],
          ellipseCenterPoint: {x: Math.round(shape.cx), y: Math.round(shape.cy)},
          ellipseMajorAxisRadius: Math.round(shape.r),
          ellipseMinorAxisRadius: Math.round(shape.r),
          ellipseAngle: 0,
        },
      ];
    case 'rect':
      return [polyline([...shape.corners, shape.corners[0]], lasso)];
  }
}

const CREATED: Record<Shape['kind'], string> = {
  rect: '▭ rectangle created',
  circle: '◯ circle created',
  arrow: '→ arrow created',
  brace: '{ brace created',
  sqrt: '√ square root created',
  axes: '⊥ axes created',
};

// ---------------------------------------------------------------------------
// Stroke handling
// ---------------------------------------------------------------------------

async function measureHold(stroke: NonNullable<Element['stroke']>, size: number, page: number) {
  let stillMs = hold.takeRecent(Date.now());
  if (stillMs == null && hold.penSeen) {
    // The pen-up motion event may arrive just after the stroke event. Whichever
    // comes first: a short timer, or that event (timers can stall).
    await Promise.race([sleep(80), hold.nextUp()]);
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

/**
 * Same stroke = an ink stroke with the same first and last sample point
 * (EMR coordinates are copied verbatim).
 */
async function matches(candidate: Element, target: StrokeSignature): Promise<boolean> {
  if (!isInk(candidate.stroke?.penType)) {
    return false;
  }
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
 * the in-memory lookups (pen-up element, last element) both failed.
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
 * `removed: false` with `ok: true` means the stroke stays under the shape (keep mode).
 */
async function removeStroke(el: Element): Promise<{ok: boolean; removed: boolean; how: string}> {
  if (getSettings().replaceMode === 'keep') {
    return {ok: true, removed: false, how: 'kept under the shape'};
  }
  const r = await deleteByNumber(el);
  return {ok: r.ok, removed: r.ok, how: r.how};
}

async function lassoActive(): Promise<boolean> {
  try {
    return ok<object>(await PluginCommAPI.getLassoRect()) != null;
  } catch {
    return false;
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
  // Lasso paths arrive here too (penType 4): only strokes drawn with an ink pen are touched.
  const origin = strokeOrigin(stroke.penType);
  if (origin !== 'ink') {
    const result = origin === 'lasso' ? 'lasso path: ignored' : `pen type ${stroke.penType} is not an ink pen: ignored`;
    report({stillMs: 0, holdSource: 'clock', result, details: []});
    return;
  }
  // Second guard: a lasso selection right after the pen lifts means the user was selecting.
  if (await lassoActive()) {
    report({stillMs: 0, holdSource: 'clock', result: 'lasso selection active: ignored', details: []});
    return;
  }
  const place = await currentPlace();
  // Pen-downs so far: a higher count later means the user already writes again.
  const downsAtStart = hold.downs;
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
  details.push(`stroke: pen ${stroke.penType}, color ${stroke.penColor}, thickness ${el.thickness}, #${el.numInPage}`);
  let shape: Shape | null = null;
  let extent = Infinity;
  for (const set of await pointSets(el, size)) {
    if (set.points.length) {
      const xs = set.points.map(p => p.x);
      const ys = set.points.map(p => p.y);
      extent = Math.max(
        xs.reduce((a, b) => Math.max(a, b), -Infinity) - xs.reduce((a, b) => Math.min(a, b), Infinity),
        ys.reduce((a, b) => Math.max(a, b), -Infinity) - ys.reduce((a, b) => Math.min(a, b), Infinity),
      );
    }
    const r = recognize(set.points, {
      tolerance: settings.tolerance,
      minSize: settings.tinyShapes ? TINY_SHAPE_SIZE : MIN_SHAPE_SIZE,
      rect: settings.rect,
      circle: settings.circle,
      arrow: settings.arrow,
      arrowSnapDegrees: settings.arrowSnapDegrees,
      rectSnapDegrees: settings.rectSnapDegrees,
      brace: settings.brace,
      sqrt: settings.sqrt,
      axes: settings.axes,
    });
    details.push(describe(set.label, r));
    if (r.shape) {
      shape = shapeToPixels(r.shape, set.toPixel);
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
  // A tiny shape needs a pause at the end, even with a hold of 0 ms.
  if (extent < MIN_SHAPE_SIZE) {
    const held = settings.holdMs > 0 ? stillMs : (await measureHold(stroke, size, el.pageNum)).stillMs;
    details.push(`tiny shape (${Math.round(extent)} px): pause ${held} ms`);
    if (held < TINY_HOLD_MS) {
      report({stillMs: held, holdSource, result: `tiny shape kept as ink: hold the pen ${TINY_HOLD_MS} ms at the end`, details});
      return;
    }
  }

  // Active pen style; fall back to the stroke's own style.
  const pen = ok<{type: number; color: number; width: number}>(await PluginCommAPI.getPenInfo()) ?? {
    type: stroke.penType,
    color: stroke.penColor,
    width: 100,
  };

  // Never edit a page the user has already left (e.g. after a swipe to another file),
  // nor interfere with a lasso selection made in the meantime.
  if ((await currentPlace()) !== place || (await lassoActive())) {
    report({stillMs, holdSource, result: 'cancelled: file or page changed', details});
    return;
  }
  // Never change the page while the pen is writing the next stroke: the host
  // dropped that stroke (measured with a 150 ms hold). Wait for the pen to lift.
  if (hold.penDown) {
    details.push('waited for the next stroke to end');
    await hold.nextUp();
  }
  // Remove the stroke first (per setting), then insert the shape; restore the stroke if insertion fails.
  const deletion = await removeStroke(el);
  details.push(`removal: ${deletion.how}`);
  if (!deletion.ok) {
    report({stillMs, holdSource, result: 'not snapped: the stroke was not found on the page', details});
    return;
  }
  if ((await currentPlace()) !== place) {
    report({stillMs, holdSource, result: 'cancelled: file or page changed after deleting the stroke', details});
    return;
  }
  let inserted = 0;
  // No lasso on the shape if the user already writes again: the selection
  // would take the next stroke as a lasso gesture.
  const lassoAfter = settings.lassoAfter && hold.downs === downsAtStart && !hold.penDown;
  if (settings.lassoAfter && !lassoAfter) {
    details.push('not selected: writing resumed');
  }
  const geometries = geometriesFor(shape, pen, lassoAfter, settings);
  for (const g of geometries) {
    if (!ok<boolean>(await PluginCommAPI.insertGeometry(g as any))) {
      break;
    }
    inserted++;
  }
  if (inserted < geometries.length) {
    details.push(`inserted ${inserted} of ${geometries.length} geometries`);
  }
  if (!inserted) {
    if (deletion.removed) {
      await PluginCommAPI.insertPageElements([el], el.pageNum, el.layerNum);
    }
    report({stillMs, holdSource, result: 'failed: shape not inserted, stroke restored', details});
    return;
  }
  report({stillMs, holdSource, result: CREATED[shape.kind], details});
}

let queue: Promise<void> = Promise.resolve();
/** The stroke being handled: when it started, and its generation. */
let busy: {since: number; gen: number} | null = null;
let generation = 0;

/** A stuck host call must never block the strokes that follow. */
const STROKE_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    work.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function onPenUp(msg: unknown) {
  const elements = (Array.isArray(msg) ? msg : []) as Element[];
  const release = () => elements.forEach(e => e?.uuid && PluginCommAPI.recycleElement(e.uuid));
  if (!getSettings().enabled || !elements.length) {
    release();
    return;
  }
  const strokes = elements.filter(e => e?.type === Element.TYPE_STROKE && e.stroke);
  const last = strokes[strokes.length - 1];
  // Watchdog without timers: once the plugin view has been shown (settings),
  // the host may stall the plugin's timers, so a stuck host call could block
  // every following stroke for good, its timeout never firing. A stroke still
  // busy after the time limit is abandoned when the next one arrives.
  if (busy && Date.now() - busy.since > STROKE_TIMEOUT_MS) {
    const secs = Math.round((Date.now() - busy.since) / 1000);
    report({stillMs: 0, holdSource: 'clock', result: `previous stroke stuck ${secs} s: skipped`, details: []});
    busy = null;
    queue = Promise.resolve();
  }
  const gen = ++generation;
  queue = queue
    .then(() => {
      busy = {since: Date.now(), gen};
      return last ? withTimeout(handleStroke(last), STROKE_TIMEOUT_MS) : undefined;
    })
    .catch((e: any) =>
      report({stillMs: 0, holdSource: 'clock', result: `error: ${e?.message ?? e}`, details: []}),
    )
    .finally(() => {
      if (busy?.gen === gen) {
        busy = null;
      }
      release();
    });
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
