import { describe, expect, it } from 'vitest';
import { equalPowerCurves, mtSemitones, mtWetAllowed, semitonesChanged } from './masterTempo';

const playing = { scratching: false, releasing: false, rate: 1.05, motor: 1, state: 'PLAYING' as const };

describe('master tempo', () => {
  it('cancels the varispeed pitch', () => {
    expect(mtSemitones(1)).toBeCloseTo(0, 12);
    expect(mtSemitones(2)).toBeCloseTo(-12, 12);
    expect(mtSemitones(0.5)).toBeCloseTo(12, 12);
    expect(mtSemitones(1.06)).toBeCloseTo(-1.0088, 3);
    expect(mtSemitones(0.01)).toBe(24);
  });
  it('goes dry while scratching, releasing, reversing, stopped or ramping', () => {
    expect(mtWetAllowed(true, playing, false)).toBe(true);
    expect(mtWetAllowed(false, playing, false)).toBe(false);
    expect(mtWetAllowed(true, { ...playing, scratching: true }, false)).toBe(false);
    expect(mtWetAllowed(true, { ...playing, releasing: true }, false)).toBe(false); // post-scratch hand-back glide
    expect(mtWetAllowed(true, playing, true)).toBe(false);
    expect(mtWetAllowed(true, { ...playing, motor: 0.5 }, false)).toBe(false);
    expect(mtWetAllowed(true, { ...playing, state: 'PAUSED' }, false)).toBe(false);
    expect(mtWetAllowed(true, { ...playing, rate: 2.5 }, false)).toBe(false);
  });
  it('equal-power curves keep constant power', () => {
    const [up, down] = equalPowerCurves(16);
    expect(up[0]).toBe(0);
    expect(down[15]).toBeCloseTo(0, 6);
    for (let i = 0; i < 16; i++) expect(up[i]! ** 2 + down[i]! ** 2).toBeCloseTo(1, 6);
  });
  it('throttles tiny semitone changes', () => {
    expect(semitonesChanged(0, 0.005)).toBe(false);
    expect(semitonesChanged(0, 0.02)).toBe(true);
  });
});
