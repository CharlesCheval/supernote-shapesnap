/**
 * Which strokes ShapeSnap may touch. Pure logic, unit-tested.
 *
 * The host sends event_pen_up for lasso paths too, as a stroke element, and the
 * lasso APIs (getLassoRect…) answer "not allowed" (code 102) while the lasso tool
 * is active, so a lasso cannot be detected through them. What does tell them
 * apart is the stroke's penType: 4 for a lasso path (measured on a Manta,
 * undocumented). Only the ink pens documented by the SDK are accepted, so any
 * other or future tool is ignored rather than guessed.
 */

export const LASSO_PEN_TYPE = 4;

/** SDK: 1 = pressure pen, 10 = fineliner, 11 = marker, 15 = calligraphy. */
export const INK_PEN_TYPES: readonly number[] = [1, 10, 11, 15];

export type StrokeOrigin = 'ink' | 'lasso' | 'unknown';

export function strokeOrigin(penType: unknown): StrokeOrigin {
  if (penType === LASSO_PEN_TYPE) {
    return 'lasso';
  }
  return typeof penType === 'number' && INK_PEN_TYPES.includes(penType) ? 'ink' : 'unknown';
}

export const isInk = (penType: unknown) => strokeOrigin(penType) === 'ink';
