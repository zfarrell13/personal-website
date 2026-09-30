import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { bumpConfig, configVersion, SURF_CONFIG } from '../config';
import { clamp, DEG, lerp, smoothstep, wrapAngle } from './scalar';
import { springStep, springStepVec3 } from './spring';

describe('scalar helpers', () => {
  it('clamp / lerp / smoothstep', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
  it('wraps angles into (−π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-190 * DEG)).toBeCloseTo(170 * DEG);
    expect(wrapAngle(360 * DEG)).toBeCloseTo(0);
  });
});

describe('critically damped spring', () => {
  it('converges without overshoot', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 300; i++) {
      springStep(s, 1, 5, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeCloseTo(1, 4);
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('is stable for huge time steps', () => {
    const s = { x: 0, v: 0 };
    springStep(s, 1, 50, 10);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeCloseTo(1, 3);
  });
  it('works per component on vectors', () => {
    const p = new Vector3();
    const v = new Vector3();
    for (let i = 0; i < 600; i++) springStepVec3(p, v, new Vector3(1, 2, 3), 6, 1 / 60);
    expect(p.distanceTo(new Vector3(1, 2, 3))).toBeLessThan(1e-3);
  });
});

describe('config', () => {
  it('carries the spec numbers', () => {
    expect(SURF_CONFIG.wave).toMatchObject({ height: 2.4, peelSpeed: 8, tubeDepth: 5, shoulderLength: 45, taperEnd: 90, taperMin: 0.4, xMin: -30, xMax: 90 });
    expect(SURF_CONFIG.physics).toMatchObject({ hz: 120, stallDragMultiplier: 4, pumpPeriod: 0.6, launchSpeed: 3, snapWindow: 0.6, snapTopFrac: 0.7, snapCarveBoost: 2, carveRate: 6, carveHalfSpeed: 15, ollieImpulse: 4, spinRate: 540, landTolerance: 40, grabGrace: 0.1, tubeXMax: 1, tubeHeightFrac: 0.6, kickOutX: 70, kickOutTime: 2 });
    expect(SURF_CONFIG.scoring).toEqual({ comboWindow: 1.5, repeatFactor: 0.5 });
    expect(SURF_CONFIG.mesh).toEqual({ columns: 160, rows: 64 });
  });
  it('bumps a version when edited', () => {
    const v = configVersion();
    bumpConfig();
    expect(configVersion()).toBe(v + 1);
  });
});
