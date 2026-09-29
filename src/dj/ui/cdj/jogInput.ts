import { JogTracker, jogZone, type JogZone } from './jogMath';

/** A held pointer that has not moved for longer than this reports zero velocity (seconds). */
export const JOG_STALL_SEC = 0.05;

/** Receives jog messages: top plate touched, signed revolutions per second, input from the outer ring. */
export type JogSink = (touch: boolean, revPerSec: number, ring: boolean) => void;

export interface JogGeometry {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * One jog wheel's pointer → jog messages. Each wheel owns a single pointer, so two hands on two
 * jogs (or a jog and a fader) work independently. The engine keeps the last jog velocity until it
 * is told otherwise, so every way a hand can leave — up, cancel, lost capture, blur, unmount — sends
 * a final untouched zero at once, and a hand that holds still reports zero after JOG_STALL_SEC.
 */
export class JogInput {
  private readonly tracker = new JogTracker();
  private pointerId: number | null = null;
  private zone: JogZone = null;
  private moved = false;
  private stillSec = 0;

  constructor(private readonly send: JogSink) {}

  /** The pointer holding the jog (null = free). */
  get pointer(): number | null {
    return this.pointerId;
  }

  /** A hand is on the top plate (drives the jog display's touch ring). */
  get touchingTop(): boolean {
    return this.pointerId !== null && this.zone === 'top';
  }

  /** Returns true when the pointer took the jog (inside the wheel and the jog was free). */
  down(pointerId: number, x: number, y: number, g: JogGeometry): boolean {
    if (this.pointerId !== null) return false;
    const zone = jogZone(x, y, g.cx, g.cy, g.radius);
    if (!zone) return false;
    this.pointerId = pointerId;
    this.zone = zone;
    this.moved = false;
    this.stillSec = 0;
    this.tracker.begin(x, y, g.cx, g.cy);
    this.send(zone === 'top', 0, zone === 'ring'); // a touch stops the platter now, not next frame
    return true;
  }

  move(pointerId: number, x: number, y: number, g: JogGeometry): void {
    if (pointerId !== this.pointerId) return;
    this.tracker.move(x, y, g.cx, g.cy);
    this.moved = true;
  }

  /** Pointer up / cancel / lost capture pass the pointer id; blur and unmount pass none (release whatever is held). */
  release(pointerId?: number): void {
    if (this.pointerId === null || (pointerId !== undefined && pointerId !== this.pointerId)) return;
    this.pointerId = null;
    this.zone = null;
    this.tracker.end();
    this.tracker.halt();
    this.send(false, 0, false);
  }

  /** Once per animation frame while mounted. */
  frame(dt: number): void {
    if (this.pointerId === null) return;
    this.stillSec = this.moved ? 0 : this.stillSec + dt;
    this.moved = false;
    let v = this.tracker.sample(dt);
    if (this.stillSec > JOG_STALL_SEC) {
      this.tracker.halt();
      v = 0;
    }
    this.send(this.zone === 'top', v, this.zone === 'ring');
  }
}
