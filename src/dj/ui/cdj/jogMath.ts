export type JogZone = "top" | "ring" | null;

/** The top plate is the inner 78 % of the jog radius; the outer ring is the rest. */
export const TOP_PLATE_FRACTION = 0.78;

export function jogZone(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
): JogZone {
  const r = Math.hypot(x - cx, y - cy) / radius;
  if (r <= TOP_PLATE_FRACTION) return "top";
  if (r <= 1.02) return "ring";
  return null;
}

/** Signed smallest angle from a to b in radians, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/**
 * Accumulates pointer rotation about the jog centre (clockwise = forward) and
 * turns it into revolutions per second once per animation frame, with light smoothing.
 */
export class JogTracker {
  private lastAngle = 0;
  private accum = 0;
  private velocity = 0;
  private active = false;

  begin(x: number, y: number, cx: number, cy: number): void {
    this.lastAngle = Math.atan2(y - cy, x - cx);
    this.accum = 0;
    this.velocity = 0;
    this.active = true;
  }

  move(x: number, y: number, cx: number, cy: number): void {
    if (!this.active) return;
    const a = Math.atan2(y - cy, x - cx);
    this.accum += angleDelta(this.lastAngle, a); // screen y points down → positive = clockwise
    this.lastAngle = a;
  }

  end(): void {
    this.active = false;
    this.accum = 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Call once per frame with the frame time in seconds; returns revolutions per second. */
  sample(dt: number): number {
    if (dt <= 0) return this.velocity;
    const instant = this.accum / (2 * Math.PI) / dt;
    this.accum = 0;
    this.velocity += (instant - this.velocity) * 0.5;
    if (Math.abs(this.velocity) < 1e-3) this.velocity = 0;
    return this.velocity;
  }
}

/** Platter angle (radians) for a playback position: one revolution per 1.8 s. */
export const platterAngle = (posSec: number, secPerRev: number): number =>
  ((posSec / secPerRev) % 1) * 2 * Math.PI;
