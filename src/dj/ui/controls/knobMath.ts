export interface Range {
  min: number;
  max: number;
}

export const clampTo = (v: number, r: Range): number => Math.min(r.max, Math.max(r.min, v));

/** Pixels of vertical drag for a full sweep (×10 with SHIFT for fine control). */
export const KNOB_DRAG_PX = 200;
/** Magnetic centre detent: ±2 % of the range snaps to the detent. */
export const DETENT_FRACTION = 0.02;

export function dragValue(startValue: number, dyPx: number, r: Range, fine: boolean): number {
  const span = r.max - r.min;
  return clampTo(startValue - (dyPx / KNOB_DRAG_PX) * span * (fine ? 0.1 : 1), r);
}

export function wheelValue(value: number, deltaY: number, r: Range, fine: boolean): number {
  const span = r.max - r.min;
  const step = span * (fine ? 0.002 : 0.02) * Math.sign(deltaY);
  return clampTo(value - step, r);
}

export function applyDetent(value: number, detent: number | null, r: Range): number {
  if (detent === null) return value;
  return Math.abs(value - detent) <= (r.max - r.min) * DETENT_FRACTION ? detent : value;
}

/** Knob pointer angle in degrees: −135° at min, +135° at max. */
export function valueToAngle(value: number, r: Range): number {
  return -135 + ((clampTo(value, r) - r.min) / (r.max - r.min)) * 270;
}

/** Fader: pointer coordinate along the track → value. `invert`: top/left = max. */
export function positionToValue(pos: number, trackStart: number, trackLength: number, r: Range, invert: boolean): number {
  const t = Math.min(1, Math.max(0, (pos - trackStart) / Math.max(1, trackLength)));
  const f = invert ? 1 - t : t;
  return r.min + f * (r.max - r.min);
}

export function valueToFraction(value: number, r: Range): number {
  return (clampTo(value, r) - r.min) / (r.max - r.min);
}
