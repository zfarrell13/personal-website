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
    expect(frameToView(p, 'right', new Vector3()).equals(p.clone().applyMatrix4(new Matrix4().makeScale(sideSign('right'), 1, 1)))).toBe(true);
    expect(sideSign('left')).toBe(1);
    expect(sideSign('right')).toBe(-1);
  });
  it("a RIGHT peels to the surfer's right as they face the beach (standard naming), a LEFT to their left", () => {
    // The rider travels +x in the canonical frame; facing shore (+z) with +y up, their right hand is forward × up.
    const travel = new Vector3(1, 0, 0);
    const rightHand = new Vector3(0, 0, 1).cross(new Vector3(0, 1, 0));
    expect(frameToView(travel, 'right', new Vector3()).dot(rightHand)).toBeGreaterThan(0);
    expect(frameToView(travel, 'left', new Vector3()).dot(rightHand)).toBeLessThan(0);
  });
});
