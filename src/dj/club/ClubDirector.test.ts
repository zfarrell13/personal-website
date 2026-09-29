import { describe, expect, it } from 'vitest';
import { ClubDirector, type DirectorInput } from './ClubDirector';

const base: DirectorInput = { dt: 1 / 60, lowRms: 0.2, playing: true, beat: 0, filterSweep: 0, lowCut: 0, beatFxDepth: 0 };
function run(d: ClubDirector, seconds: number, over: Partial<DirectorInput>) {
  let beat = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    beat += (124 / 60) / 60;
    d.update({ ...base, beat, ...over });
  }
  return d.state;
}

describe('ClubDirector', () => {
  it('idles without music', () => {
    const d = new ClubDirector();
    const s = run(d, 2, { playing: false });
    expect(s.idle).toBe(true);
    expect(s.energy).toBeLessThan(0.01);
    expect(s.strobe).toBe(0);
  });

  it('energy follows the bass', () => {
    const d = new ClubDirector();
    expect(run(d, 3, { lowRms: 0.25 }).energy).toBeGreaterThan(0.9);
    expect(run(d, 6, { lowRms: 0.02 }).energy).toBeLessThan(0.2);
  });

  it('a filter sweep builds tension and lasers', () => {
    const d = new ClubDirector();
    const s = run(d, 4, { filterSweep: 0.9 });
    expect(s.tension).toBeGreaterThan(0.5);
    expect(s.laser).toBeGreaterThan(0);
  });

  it('releasing the filter while the bass returns fires one drop', () => {
    const d = new ClubDirector();
    run(d, 4, { filterSweep: 0.9, lowCut: 1, lowRms: 0.03 });
    const s = run(d, 0.5, { filterSweep: 0, lowCut: 0, lowRms: 0.25 });
    expect(s.dropCount).toBe(1);
    expect(s.drop).toBeGreaterThan(0.5);
    run(d, 3, {});
    expect(d.state.dropCount).toBe(1);
    expect(d.state.drop).toBe(0);
  });

  it('no drop without a build-up', () => {
    const d = new ClubDirector();
    run(d, 2, { lowRms: 0.02 });
    expect(run(d, 2, { lowRms: 0.25 }).dropCount).toBe(0);
  });

  it('no drop if the bass does not come back within 2 s', () => {
    const d = new ClubDirector();
    run(d, 4, { filterSweep: 1, lowRms: 0.03 });
    run(d, 3, { filterSweep: 0, lowRms: 0.03 });
    expect(run(d, 1, { lowRms: 0.25 }).dropCount).toBe(0);
  });

  it('a rising Beat FX depth builds tension', () => {
    const d = new ClubDirector();
    let depth = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      depth = Math.min(1, depth + 1 / 60 / 2);
      d.update({ ...base, beatFxDepth: depth });
    }
    expect(d.state.tension).toBeGreaterThan(0.3);
  });

  it('phases follow the beat', () => {
    const d = new ClubDirector();
    d.update({ ...base, beat: 5.25 });
    expect(d.state.beatPhase).toBeCloseTo(0.25, 6);
    expect(d.state.barPhase).toBeCloseTo(0.3125, 6);
    d.update({ ...base, beat: -0.25 });
    expect(d.state.beatPhase).toBeCloseTo(0.75, 6);
  });

  it('survives NaN / Infinity inputs without poisoning the state', () => {
    const d = new ClubDirector();
    run(d, 1, {});
    d.update({ dt: NaN, lowRms: NaN, playing: true, beat: NaN, filterSweep: NaN, lowCut: Infinity, beatFxDepth: NaN });
    d.update({ ...base, dt: Infinity, lowRms: Infinity, beat: Infinity });
    for (const v of Object.values(d.state)) expect(Number.isFinite(Number(v))).toBe(true);
    run(d, 2, { lowRms: 0.25 });
    expect(d.state.energy).toBeGreaterThan(0.9);
  });

  it('update() returns the same state object (no per-frame allocation)', () => {
    const d = new ClubDirector();
    expect(d.update(base)).toBe(d.state);
  });
});
