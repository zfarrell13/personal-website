export type FrameFn = (dt: number, nowSec: number) => void;

/**
 * One requestAnimationFrame loop for the whole booth (engine tick, screens, club, LED states).
 * Callbacks live in an array that is replaced (copy-on-write) only on add/remove, so the per-frame
 * path allocates nothing and add/remove from inside a callback is safe. start()/stop() are idempotent
 * and stop() cancels the pending frame, so a StrictMode mount/cleanup/mount leaves exactly one loop.
 */
export class FrameLoop {
  private fns: readonly FrameFn[] = [];
  private raf = 0;
  private last = -1;
  frames = 0;

  private readonly onFrame = (t: number): void => {
    this.step(t);
    this.raf = requestAnimationFrame(this.onFrame);
  };

  add(fn: FrameFn): () => void {
    this.fns = [...this.fns, fn];
    return () => {
      this.fns = this.fns.filter((f) => f !== fn);
    };
  }

  /** Runs every callback once (used by start() and by tests). */
  step(nowMs: number): void {
    const now = nowMs / 1000;
    const dt = this.last < 0 ? 1 / 60 : Math.min(0.1, now - this.last);
    this.last = now;
    this.frames++;
    const fns = this.fns; // snapshot: add/remove during the frame take effect next frame
    for (let i = 0; i < fns.length; i++) fns[i]!(dt, now);
  }

  start(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = -1;
  }
}
