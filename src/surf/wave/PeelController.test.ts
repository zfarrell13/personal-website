import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { PeelController } from './PeelController';

const make = () => {
  const wave = { peelSpeed: SURF_CONFIG.wave.peelSpeed };
  const cfg = structuredClone(SURF_CONFIG.sections);
  return { wave, cfg, peel: new PeelController(wave, cfg) };
};

/** Step 120 Hz sim time for `seconds`, recording transitions and speeds. */
function run(peel: PeelController, seconds: number) {
  const starts: number[] = [];
  const ends: number[] = [];
  const speeds: number[] = [];
  for (let i = 1; i <= seconds * 120; i++) {
    const t = i / 120;
    const tr = peel.update(t);
    if (tr === 'start') starts.push(t);
    if (tr === 'end') ends.push(t);
    speeds.push(peel.speed);
  }
  return { starts, ends, speeds };
}

describe('PeelController', () => {
  it('starts every run at the base peel speed with no section on', () => {
    const { wave, peel } = make();
    peel.reset(1);
    expect(peel.update(0)).toBeNull();
    expect(peel.speed).toBe(wave.peelSpeed);
    expect(peel.active).toBe(false);
  });

  it('schedules fast sections 10–20 s apart, holding minHold–maxHold s at +minBoost–maxBoost with ramps', () => {
    const { wave, cfg, peel } = make();
    expect(cfg.minGap).toBe(10);
    expect(cfg.maxGap).toBe(20);
    peel.reset(42);
    const { starts, ends, speeds } = run(peel, 300);
    expect(starts.length).toBeGreaterThanOrEqual(10);
    expect(starts[0]!).toBeGreaterThanOrEqual(cfg.minGap);
    expect(starts[0]!).toBeLessThanOrEqual(cfg.maxGap);
    for (let k = 0; k < ends.length; k++) {
      const len = ends[k]! - starts[k]!;
      expect(len).toBeGreaterThanOrEqual(cfg.minHold + 2 * cfg.ramp - 1e-6); // hold + two ramps
      expect(len).toBeLessThanOrEqual(cfg.maxHold + 2 * cfg.ramp + 1e-6);
      if (k + 1 < starts.length) {
        expect(starts[k + 1]! - ends[k]!).toBeGreaterThanOrEqual(cfg.minGap - 1e-6);
        expect(starts[k + 1]! - ends[k]!).toBeLessThanOrEqual(cfg.maxGap + 1e-6);
      }
    }
    const peak = Math.max(...speeds);
    expect(peak).toBeGreaterThanOrEqual(wave.peelSpeed * (1 + cfg.minBoost) - 1e-9);
    expect(peak).toBeLessThanOrEqual(wave.peelSpeed * (1 + cfg.maxBoost) + 1e-9);
    // Ramps: never faster than maxBoost × Vp per `ramp` seconds.
    const maxStep = (wave.peelSpeed * cfg.maxBoost) / cfg.ramp / 120 + 1e-9;
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i]! - speeds[i - 1]!)).toBeLessThanOrEqual(maxStep);
  });

  it('stays inside the design envelope: +30–50% for 3–5 s', () => {
    const { cfg } = make();
    expect(cfg.minBoost).toBeGreaterThanOrEqual(0.3);
    expect(cfg.maxBoost).toBeLessThanOrEqual(0.5);
    expect(cfg.minBoost).toBeLessThanOrEqual(cfg.maxBoost);
    expect(cfg.minHold).toBeGreaterThanOrEqual(3);
    expect(cfg.maxHold).toBeLessThanOrEqual(5);
    expect(cfg.minHold).toBeLessThanOrEqual(cfg.maxHold);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = make();
    const b = make();
    a.peel.reset(7);
    b.peel.reset(7);
    expect(run(a.peel, 120).starts).toEqual(run(b.peel, 120).starts);
    const d = make();
    d.peel.reset(7);
    const e = make();
    e.peel.reset(8);
    expect(run(d.peel, 120).starts).not.toEqual(run(e.peel, 120).starts);
  });

  it('follows live edits of the base peel speed', () => {
    const { wave, peel } = make();
    peel.reset(3);
    wave.peelSpeed = 6;
    peel.update(1);
    expect(peel.speed).toBe(6);
  });
});
