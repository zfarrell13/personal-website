import { describe, expect, it } from 'vitest';
import { motorKnobToSec, motorSecToKnob } from './JogControls';

describe('vinyl speed adjust mapping', () => {
  it('round-trips and spans 0..2 s', () => {
    expect(motorKnobToSec(0)).toBe(0);
    expect(motorKnobToSec(1)).toBe(2);
    expect(motorKnobToSec(motorSecToKnob(0.15))).toBeCloseTo(0.15, 12);
  });
});
