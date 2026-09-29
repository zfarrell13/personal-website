import { describe, expect, it } from 'vitest';
import { FixedStepper } from './FixedStepper';

describe('FixedStepper', () => {
  it('runs whole steps and returns the leftover fraction', () => {
    const s = new FixedStepper(1 / 120);
    let n = 0;
    const alpha = s.advance(1 / 60 + 1 / 240, () => n++);
    expect(n).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });
  it('accumulates across frames', () => {
    const s = new FixedStepper(0.01);
    let n = 0;
    for (let i = 0; i < 10; i++) s.advance(0.004, () => n++);
    expect(n).toBe(4);
  });
  it('clamps huge frames', () => {
    const s = new FixedStepper(0.01, 0.25);
    let n = 0;
    s.advance(10, () => n++);
    expect(n).toBe(25);
  });
});
