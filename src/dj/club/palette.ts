/** Dominant colour of RGBA pixel data: average of the most saturated half of the pixels (ignores greys). */
export function dominantColor(rgba: Uint8ClampedArray): [number, number, number] {
  const px: Array<[number, number, number, number]> = [];
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    px.push([r, g, b, sat * max]);
  }
  if (px.length === 0) return [0.5, 0.3, 1];
  px.sort((a, b) => b[3] - a[3]);
  const top = px.slice(0, Math.max(1, Math.ceil(px.length / 2)));
  const sum = top.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as [number, number, number], [0, 0, 0] as [number, number, number]);
  return [sum[0] / top.length, sum[1] / top.length, sum[2] / top.length];
}

/** LED wall palette: the dominant colour (brightened) and its complementary accent. */
export function paletteFrom(rgb: [number, number, number]): { a: [number, number, number]; b: [number, number, number] } {
  const max = Math.max(...rgb, 1e-3);
  const a = rgb.map((c) => Math.min(1, (c / max) * 0.95)) as [number, number, number];
  const b: [number, number, number] = [1 - a[0] * 0.8, 1 - a[1] * 0.8, 1 - a[2] * 0.8];
  return { a, b };
}

export const DEFAULT_PALETTE = paletteFrom([0.45, 0.2, 1]);
