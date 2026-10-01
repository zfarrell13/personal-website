/**
 * The section peak's shape: a temporary bump in the one wave shape (playtest 5). Physics
 * (WaveShape.heightScale) and the render (the wave shader, PEAK_GLSL) use these same formulas, so
 * what you see is what you ride on the peak too.
 *
 * The bump scales the wave's height at column x by 1 + amp · bell((x − peak x) / width): taller, and
 * with the same footprint (z unchanged) steeper. bell(u) = (1 − u²)³ on |u| < 1, 0 outside: C2 at the
 * edges, so the surface, its normals and the rider's motion over it never jump.
 */
export interface PeakShape {
  /** Frame x of the top of the bump (m). */
  x: number;
  /** Extra height at the top, as a fraction of the wave's height there (0 = no peak). */
  amp: number;
  /** Half-width of the bump along the wave (m). */
  width: number;
}

export const NO_PEAK: Readonly<PeakShape> = Object.freeze({ x: 0, amp: 0, width: 1 });

/** (1 − u²)³ on |u| < 1, else 0. */
export function peakBell(u: number): number {
  const a = 1 - u * u;
  return a > 0 ? a * a * a : 0;
}

/** d/du of peakBell. */
export function peakBellSlope(u: number): number {
  const a = 1 - u * u;
  return a > 0 ? -6 * u * a * a : 0;
}

/** The bump's height (fraction of the wave's height) at column x: amp · bell. */
export function peakBump(p: Readonly<PeakShape>, x: number): number {
  return p.amp > 0 ? p.amp * peakBell((x - p.x) / p.width) : 0;
}

/**
 * The GPU twin (vertex shader; `uPeak` = vec3(x, amp, width) in frame coordinates, the rest shape in
 * `position` / `objectNormal`). PEAK_NORMAL_GLSL goes after <beginnormal_vertex>: the scaled surface's
 * normal is the inverse transpose of (x, y, z) → (x, k(x) y, z) applied to the rest normal,
 * (n.x − n.y · y · k′ / k, n.y / k, n.z). PEAK_POSITION_GLSL goes after <begin_vertex>.
 */
export const PEAK_GLSL_HEADER = /* glsl */ `
uniform vec3 uPeak;
float peakU() { return (position.x - uPeak.x) / uPeak.z; }
float peakScale() {
  float a = max(0.0, 1.0 - peakU() * peakU());
  return 1.0 + uPeak.y * a * a * a;
}
float peakScaleSlope() {
  float u = peakU();
  float a = max(0.0, 1.0 - u * u);
  return uPeak.y * -6.0 * u * a * a / uPeak.z;
}
`;

export const PEAK_NORMAL_GLSL = /* glsl */ `
  if (uPeak.y > 0.0) {
    float pk = peakScale();
    objectNormal = normalize(vec3(objectNormal.x - objectNormal.y * position.y * peakScaleSlope() / pk, objectNormal.y / pk, objectNormal.z));
  }
`;

export const PEAK_POSITION_GLSL = /* glsl */ `
  transformed.y *= peakScale();
`;

/**
 * The CPU twin of PEAK_NORMAL_GLSL + PEAK_POSITION_GLSL (same formula, for tests): applies the peak to
 * a rest-shape vertex in place — y scaled by k(x) = 1 + bump, the normal by the inverse transpose.
 */
export function applyPeakToVertex(p: Readonly<PeakShape>, pos: { x: number; y: number }, normal?: { x: number; y: number; z: number }): void {
  if (p.amp <= 0) return;
  const u = (pos.x - p.x) / p.width;
  const k = 1 + p.amp * peakBell(u);
  const dk = (p.amp * peakBellSlope(u)) / p.width;
  if (normal) {
    const nx = normal.x - (normal.y * pos.y * dk) / k;
    const ny = normal.y / k;
    const len = Math.hypot(nx, ny, normal.z);
    normal.x = nx / len;
    normal.y = ny / len;
    normal.z /= len;
  }
  pos.y *= k;
}
