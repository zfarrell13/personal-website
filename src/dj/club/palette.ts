/** Shared fallback colour (also the default LED wall palette source). */
const FALLBACK_RGB: readonly [number, number, number] = [0.45, 0.2, 1];
const BINS = 64;
/** Below this vibrancy (saturation × brightness) a cover counts as greyscale. */
const MIN_VIBRANCY = 0.12;
const TOP_FRACTION = 0.2;

/**
 * Dominant colour of RGBA pixel data: average of the most vibrant ~20% of the
 * opaque pixels (ignores greys and transparency). Greyscale/empty → fallback.
 * Single pass with a fixed-size histogram, no per-pixel allocation.
 */
export function dominantColor(rgba: Uint8ClampedArray): [number, number, number] {
  const count = new Float64Array(BINS);
  const sr = new Float64Array(BINS);
  const sg = new Float64Array(BINS);
  const sb = new Float64Array(BINS);
  let n = 0;
  let best = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const vib = max === 0 ? 0 : ((max - Math.min(r, g, b)) / max) * max;
    const bin = Math.min(BINS - 1, Math.floor(vib * BINS));
    count[bin]! += 1;
    sr[bin]! += r;
    sg[bin]! += g;
    sb[bin]! += b;
    if (vib > best) best = vib;
    n++;
  }
  if (n === 0 || best < MIN_VIBRANCY) return [FALLBACK_RGB[0], FALLBACK_RGB[1], FALLBACK_RGB[2]];
  const want = Math.max(1, Math.ceil(n * TOP_FRACTION));
  let taken = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let bin = BINS - 1; bin >= 0 && taken < want; bin--) {
    taken += count[bin]!;
    r += sr[bin]!;
    g += sg[bin]!;
    b += sb[bin]!;
  }
  return [r / taken, g / taken, b / taken];
}

/** LED wall palette: the dominant colour (brightened) and its complementary accent. */
export function paletteFrom(rgb: readonly [number, number, number]): { a: [number, number, number]; b: [number, number, number] } {
  const max = Math.max(...rgb, 1e-3);
  const a = rgb.map((c) => Math.min(1, (c / max) * 0.95)) as [number, number, number];
  const b: [number, number, number] = [1 - a[0] * 0.8, 1 - a[1] * 0.8, 1 - a[2] * 0.8];
  return { a, b };
}

export const DEFAULT_PALETTE = paletteFrom(FALLBACK_RGB);
