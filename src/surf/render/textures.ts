import { DataTexture, RGBAFormat } from 'three';
import { retroTexture } from '@/retro/retroMaterial';

/** Radial glow texture (no canvas needed): white core fading to transparent. */
export function makeRadialTexture(size: number, rgb: [number, number, number], falloff = 2): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x - c, y - c) / c);
      const a = Math.pow(1 - d, falloff);
      data.set([rgb[0], rgb[1], rgb[2], Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  return retroTexture(tex);
}
