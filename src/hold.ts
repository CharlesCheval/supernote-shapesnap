/**
 * Measures the pause at the end of a stroke from pen touch events
 * (registerMotionListener, toolType 2): time between the last significant
 * movement and the pen lifting. Pure logic, unit-tested.
 */

export const TOOL_PEN = 2;
const ACTION_DOWN = 0;
const ACTION_UP = 1;

export type PenMotion = {
  action: number;
  x: number;
  y: number;
  eventTime: number;
  downTime: number;
  toolType: number;
};

export class HoldTracker {
  private downTime = Number.NaN;
  private anchor = {x: 0, y: 0};
  private anchorTime = 0;
  /** True once a pen event has been received: the host does forward pen events. */
  penSeen = false;
  /** Last pen lift: final still duration and time received. */
  lastUp: {stillMs: number; receivedAt: number} | null = null;

  private upWaiters: (() => void)[] = [];

  constructor(private readonly radius: () => number) {}

  /** Resolves at the next pen lift (no timer: timers can stall once the plugin view was shown). */
  nextUp(): Promise<void> {
    return new Promise(resolve => this.upWaiters.push(resolve));
  }

  feed(e: PenMotion, now: number) {
    if (e.toolType !== TOOL_PEN) {
      return;
    }
    this.penSeen = true;
    if (e.downTime !== this.downTime || e.action === ACTION_DOWN) {
      this.downTime = e.downTime;
      this.anchor = {x: e.x, y: e.y};
      this.anchorTime = e.eventTime;
      this.lastUp = null;
    } else if (Math.hypot(e.x - this.anchor.x, e.y - this.anchor.y) > this.radius()) {
      this.anchor = {x: e.x, y: e.y};
      this.anchorTime = e.eventTime;
    }
    if (e.action === ACTION_UP) {
      this.lastUp = {stillMs: e.eventTime - this.anchorTime, receivedAt: now};
      const waiters = this.upWaiters;
      this.upWaiters = [];
      waiters.forEach(fn => fn());
    }
  }

  /** Still duration of the stroke that just ended, if recent. */
  takeRecent(now: number, maxAgeMs = 1500): number | null {
    const up = this.lastUp;
    if (!up || now - up.receivedAt > maxAgeMs) {
      return null;
    }
    this.lastUp = null;
    return up.stillMs;
  }
}
