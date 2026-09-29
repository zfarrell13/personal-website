import { describe, expect, it } from 'vitest';
import { BeatClock } from './BeatClock';

describe('BeatClock', () => {
  it('extrapolates the posted beat by frames', () => {
    const c = new BeatClock(48000);
    c.update(48000, 10, 120);
    expect(c.beatAt(48000 + 24000)).toBeCloseTo(11, 12);
    expect(c.framesPerBeat).toBe(24000);
  });
  it('shifts beats back by the Master Tempo latency', () => {
    const c = new BeatClock(48000);
    c.update(0, 0, 120);
    c.latencyFrames = 2400;
    expect(c.beatAt(24000)).toBeCloseTo(0.9, 12);
  });
  it('runs at 120 BPM from frame 0 before any deck plays', () => {
    const c = new BeatClock(48000);
    expect(c.beatAt(24000)).toBe(1);
  });
});
