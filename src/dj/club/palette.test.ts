import { describe, expect, it } from 'vitest';
import { dominantColor, paletteFrom } from './palette';

const image = (pixels: Array<[number, number, number]>) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('palette', () => {
  it('finds the saturated colour and ignores grey', () => {
    const px: Array<[number, number, number]> = [...Array(10).fill([128, 128, 128]), ...Array(10).fill([255, 64, 0])];
    const [r, g, b] = dominantColor(image(px));
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(64 / 255, 2);
    expect(b).toBe(0);
  });
  it('builds a bright main colour and a complementary accent', () => {
    const p = paletteFrom([0.5, 0.25, 0]);
    expect(p.a[0]).toBeCloseTo(0.95, 6);
    expect(p.b[2]).toBeCloseTo(1, 6);
  });
  it('falls back to a default for empty data', () => {
    expect(dominantColor(new Uint8ClampedArray(0))).toEqual([0.5, 0.3, 1]);
  });
});
