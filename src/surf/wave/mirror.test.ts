import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { frameToView, sideSign } from './mirror';
import { WaveShape } from './WaveShape';

describe('mirror', () => {
  it('produces symmetric results for LEFT and RIGHT', () => {
    const w = new WaveShape(structuredClone(SURF_CONFIG.wave));
    const l = new Vector3();
    const r = new Vector3();
    for (const x of [-10, -3, 0, 5, 30, 80]) {
      for (const t of [0, 0.3, 0.7, 1]) {
        const p = w.surfacePoint(x, t);
        frameToView(p, 'left', l);
        frameToView(p, 'right', r);
        expect(l.x).toBeCloseTo(-r.x, 9);
        expect(l.y).toBe(r.y);
        expect(l.z).toBe(r.z);
      }
    }
  });
  it('matches the frame group transform (scale.x = sideSign)', () => {
    const p = new Vector3(12, 1.4, 2.2);
    const viaMatrix = p.clone().applyMatrix4(new Matrix4().makeScale(sideSign('left'), 1, 1));
    expect(frameToView(p, 'left', new Vector3()).equals(viaMatrix)).toBe(true);
    expect(sideSign('right')).toBe(1);
  });
});
