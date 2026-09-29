export function internalSize(viewW: number, viewH: number, internalHeight: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(viewW));
  const h = Math.max(1, Math.round(viewH));
  const height = Math.min(internalHeight, h);
  const width = Math.max(1, Math.round(height * (w / h)));
  return { width, height };
}

const fract = (v: number) => v - Math.floor(v);

function bayer2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return fract(fx * 0.5 + fy * fy * 0.75);
}

/** Ordered-dither threshold in [0, 1). Mirrors `bayer4` in shaders/post.ts exactly. */
export function bayer4(x: number, y: number): number {
  return bayer2(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y);
}

export function levelsFromBits(bits: readonly [number, number, number]): [number, number, number] {
  return [2 ** bits[0] - 1, 2 ** bits[1] - 1, 2 ** bits[2] - 1];
}
