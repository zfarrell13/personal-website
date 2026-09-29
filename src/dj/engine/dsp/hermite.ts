/**
 * 4-point, 3rd-order Hermite (Catmull-Rom) interpolation.
 * Returns the value between y1 (t = 0) and y2 (t = 1).
 */
export function hermite4(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/** Reads `data` at fractional index `pos` with Hermite interpolation; out-of-range samples are 0. */
export function readHermite(data: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const t = pos - i;
  const n = data.length;
  const y0 = i - 1 >= 0 && i - 1 < n ? data[i - 1]! : 0;
  const y1 = i >= 0 && i < n ? data[i]! : 0;
  const y2 = i + 1 >= 0 && i + 1 < n ? data[i + 1]! : 0;
  const y3 = i + 2 >= 0 && i + 2 < n ? data[i + 2]! : 0;
  return hermite4(y0, y1, y2, y3, t);
}
