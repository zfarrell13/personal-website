import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { PeelController, type PeelTransition } from './PeelController';

const make = () => {
  const wave = { peelSpeed: SURF_CONFIG.wave.peelSpeed };
  const cfg = structuredClone(SURF_CONFIG.sections);
  const peak = structuredClone(SURF_CONFIG.peak);
  return { wave, cfg, peakCfg: peak, peel: new PeelController(wave, cfg, peak) };
};

interface Section {
  start: number;
  pitch: number;
  surged: number;
  end: number;
  riderX: number;
  x0: number;
  xPitch: number;
  raceTime: number;
  riseTime: number;
  surgeTime: number;
  /** Peak x / amp right after the pitch's surge. */
  xAtSurged: number;
}

/** Step 120 Hz sim time for `seconds` with the rider at frame x `riderX(t)`, recording each section. */
function run(peel: PeelController, seconds: number, riderX: (t: number) => number = () => 10) {
  const sections: Section[] = [];
  const speeds: number[] = [];
  const peaks: Array<{ x: number; amp: number }> = [];
  let cur: Partial<Section> = {};
  for (let i = 1; i <= seconds * 120; i++) {
    const t = i / 120;
    const tr: PeelTransition = peel.update(t, riderX(t));
    const pk = peel.peak;
    if (tr === 'start') cur = { start: t, riderX: riderX(t), x0: pk.x0, xPitch: pk.xPitch, raceTime: pk.raceTime, riseTime: pk.riseTime, surgeTime: pk.surgeTime };
    if (tr === 'pitch') cur.pitch = t;
    if (tr === 'surged') {
      cur.surged = t;
      cur.xAtSurged = pk.x;
    }
    if (tr === 'end') {
      cur.end = t;
      sections.push(cur as Section);
      cur = {};
    }
    speeds.push(peel.speed);
    peaks.push({ x: pk.x, amp: pk.amp });
  }
  return { sections, speeds, peaks };
}

describe('PeelController', () => {
  it('starts every run at the base peel speed with no section and no peak', () => {
    const { wave, peel } = make();
    peel.reset(1);
    expect(peel.update(0)).toBeNull();
    expect(peel.speed).toBe(wave.peelSpeed);
    expect(peel.active).toBe(false);
    expect(peel.peak.phase).toBe('none');
    expect(peel.peak.amp).toBe(0);
  });

  it('schedules fast sections 10–20 s apart: start → pitch after the 3.5–4.5 s race → surged → end after the ramp down', () => {
    const { cfg, peakCfg, peel } = make();
    expect(cfg.minGap).toBe(10);
    expect(cfg.maxGap).toBe(20);
    peel.reset(42);
    const { sections } = run(peel, 300);
    expect(sections.length).toBeGreaterThanOrEqual(10);
    expect(sections[0]!.start).toBeGreaterThanOrEqual(cfg.minGap);
    expect(sections[0]!.start).toBeLessThanOrEqual(cfg.maxGap);
    for (let k = 0; k < sections.length; k++) {
      const s = sections[k]!;
      // The race (playtest 5: "about 3.5–4.5 s").
      expect(s.pitch - s.start).toBeGreaterThanOrEqual(3.5 - 1 / 120 - 1e-9);
      expect(s.pitch - s.start).toBeLessThanOrEqual(4.5 + 1 / 120 + 1e-9);
      expect(s.raceTime).toBeGreaterThanOrEqual(cfg.minRace);
      expect(s.raceTime).toBeLessThanOrEqual(cfg.maxRace);
      // It grows over 2–3 s.
      expect(s.riseTime).toBeGreaterThanOrEqual(peakCfg.minRise);
      expect(s.riseTime).toBeLessThanOrEqual(peakCfg.maxRise);
      // The surge: at least minSurge, about xPitch / surgeSpeed.
      expect(s.surged - s.pitch).toBeCloseTo(s.surgeTime, 1);
      expect(s.surgeTime).toBeGreaterThanOrEqual(peakCfg.minSurge);
      expect(s.end - s.surged).toBeCloseTo(cfg.ramp, 1);
      if (k + 1 < sections.length) {
        expect(sections[k + 1]!.start - s.end).toBeGreaterThanOrEqual(cfg.minGap - 1e-6);
        expect(sections[k + 1]!.start - s.end).toBeLessThanOrEqual(cfg.maxGap + 1e-6);
      }
    }
  });

  it('the peak forms 15–25 m ahead of the rider and pitches at the rider\'s start x − allowance × race time; the surge carries the curl to it', () => {
    const { peakCfg, peel } = make();
    peel.reset(9);
    const { sections } = run(peel, 300, (t) => 20 + 5 * Math.sin(t / 7));
    expect(sections.length).toBeGreaterThan(5);
    for (const s of sections) {
      expect(s.x0 - s.riderX).toBeGreaterThanOrEqual(peakCfg.minAhead - 1e-9);
      expect(s.x0 - s.riderX).toBeLessThanOrEqual(peakCfg.maxAhead + 1e-9);
      expect(s.xPitch).toBeCloseTo(s.riderX - peakCfg.allowance * s.raceTime, 9);
      // At the end of the surge the peak is at the curl (it pitched there: the new barrel).
      expect(Math.abs(s.xAtSurged)).toBeLessThan(1e-6);
    }
  });

  it('clamps the peak: never formed beyond maxSpawnX, never pitched closer than minPitchX, always approaching', () => {
    const { peakCfg, peel } = make();
    for (const x of [-3, 2, 68, 85]) {
      peel.reset(5);
      const { sections } = run(peel, 40, () => x);
      for (const s of sections) {
        expect(s.x0).toBeLessThanOrEqual(peakCfg.maxSpawnX + 1e-9);
        expect(s.xPitch).toBeGreaterThanOrEqual(peakCfg.minPitchX - 1e-9);
        expect(s.x0 - s.xPitch).toBeGreaterThanOrEqual(peakCfg.minApproach * s.raceTime - 1e-6);
      }
    }
  });

  it('the boost is +minBoost–maxBoost through the race; the peel never jumps (the surge eases in and out)', () => {
    const { wave, cfg, peel } = make();
    peel.reset(42);
    const { speeds } = run(peel, 120);
    const base = wave.peelSpeed;
    // Every tick's change is smooth: the ramps (maxBoost × Vp per `ramp` s) or the surge's smoothstep
    // (6 × xPitch / surgeTime² per s at most).
    let maxStep = 0;
    for (let i = 1; i < speeds.length; i++) maxStep = Math.max(maxStep, Math.abs(speeds[i]! - speeds[i - 1]!));
    expect(maxStep).toBeLessThan(1.6);
    // Outside the surges the boost stays in the design envelope.
    const sorted = [...speeds].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(base, 9);
    expect(speeds.some((v) => v >= base * (1 + cfg.minBoost) - 1e-9)).toBe(true);
  });

  it('the peak grows smoothly from nothing to full height over the rise, holds, then blends back to nothing by the end', () => {
    const { peakCfg, peel } = make();
    peel.reset(3);
    const { peaks, sections } = run(peel, 60, () => 15);
    const s = sections[0]!;
    const at = (t: number) => peaks[Math.round(t * 120) - 1]!;
    expect(at(s.start).amp).toBeLessThan(0.01);
    expect(at(s.start + s.riseTime / 2).amp).toBeCloseTo(peakCfg.height / 2, 2);
    expect(at(s.pitch - 0.05).amp).toBeCloseTo(peakCfg.height, 6);
    expect(at(s.end).amp).toBeLessThan(1e-6);
    let maxDx = 0;
    let maxDa = 0;
    for (let i = Math.round(s.start * 120); i < Math.round(s.end * 120) - 1; i++) {
      maxDx = Math.max(maxDx, Math.abs(peaks[i + 1]!.x - peaks[i]!.x));
      maxDa = Math.max(maxDa, Math.abs(peaks[i + 1]!.amp - peaks[i]!.amp));
    }
    // Frame to frame (120 Hz): the peak moves at most the surge's top speed (1.5 × xPitch / surgeTime) per
    // tick, and its height changes by a small fraction.
    expect(maxDx).toBeLessThanOrEqual((1.5 * s.xPitch) / s.surgeTime / 120 + 1e-6);
    expect(maxDa).toBeLessThan(0.01);
  });

  it('stays inside the design envelope: +30–50% for 3–5 s', () => {
    const { cfg } = make();
    expect(cfg.minBoost).toBeGreaterThanOrEqual(0.3);
    expect(cfg.maxBoost).toBeLessThanOrEqual(0.5);
    expect(cfg.minBoost).toBeLessThanOrEqual(cfg.maxBoost);
    expect(cfg.minRace - cfg.ramp).toBeGreaterThanOrEqual(3);
    expect(cfg.maxRace).toBeLessThanOrEqual(5);
    expect(cfg.minRace).toBeLessThanOrEqual(cfg.maxRace);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = make();
    const b = make();
    a.peel.reset(7);
    b.peel.reset(7);
    expect(run(a.peel, 120).sections).toEqual(run(b.peel, 120).sections);
    const d = make();
    d.peel.reset(7);
    const e = make();
    e.peel.reset(8);
    expect(run(d.peel, 120).sections.map((s) => s.start)).not.toEqual(run(e.peel, 120).sections.map((s) => s.start));
  });

  it('follows live edits of the base peel speed', () => {
    const { wave, peel } = make();
    peel.reset(3);
    wave.peelSpeed = 6;
    peel.update(1);
    expect(peel.speed).toBe(6);
  });
});
