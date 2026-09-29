import { describe, expect, it } from 'vitest';
import { FrameGrid, wrapHalf } from './grid';

// 120 BPM at 1000 Hz → 500 frames per beat, beat 0 at frame 250.
const g = new FrameGrid({ bpm: 120, firstBeatSec: 0.25 }, 1000);

describe('FrameGrid', () => {
  it('converts frames ↔ beats', () => {
    expect(g.framesPerBeat).toBe(500);
    expect(g.beatAt(750)).toBe(1);
    expect(g.frameAt(-0.5)).toBe(0);
  });
  it('snaps to the nearest grid point at any resolution', () => {
    expect(g.snap(990, 1)).toBe(750);
    expect(g.snap(1010, 1)).toBe(1250);
    expect(g.snap(1010, 0.25)).toBe(1000);
  });
  it('floors to the previous grid point', () => {
    expect(g.floor(1240, 1)).toBe(750);
    expect(g.floor(1250, 1)).toBe(1250);
  });
  it('measures the phase offset from the grid', () => {
    expect(g.phaseOffset(1260, 1)).toBe(10);
    expect(g.phaseOffset(1240, 1)).toBe(-10);
  });
  it('wraps to [-0.5, 0.5)', () => {
    expect(wrapHalf(0.7)).toBeCloseTo(-0.3, 12);
    expect(wrapHalf(-0.2)).toBeCloseTo(-0.2, 12);
    expect(wrapHalf(3.5)).toBeCloseTo(-0.5, 12);
  });
});
