import { describe, expect, it } from 'vitest';
import { applyDetent, dragValue, positionToValue, valueToAngle, valueToFraction, wheelValue } from './knobMath';

const R = { min: 0, max: 1 };
const BI = { min: -1, max: 1 };

describe('knob math', () => {
  it('drag up increases, 200 px = full sweep, SHIFT is 10× finer', () => {
    expect(dragValue(0, -100, R, false)).toBeCloseTo(0.5, 9);
    expect(dragValue(0.5, -100, R, true)).toBeCloseTo(0.55, 9);
    expect(dragValue(0.9, -500, R, false)).toBe(1);
  });
  it('wheel steps 2 % (0.2 % fine)', () => {
    expect(wheelValue(0.5, -1, R, false)).toBeCloseTo(0.52, 9);
    expect(wheelValue(0.5, 1, R, true)).toBeCloseTo(0.498, 9);
  });
  it('centre detent is magnetic within ±2 %', () => {
    expect(applyDetent(0.51, 0.5, R)).toBe(0.5);
    expect(applyDetent(0.53, 0.5, R)).toBe(0.53);
    expect(applyDetent(0.03, 0, BI)).toBe(0);
    expect(applyDetent(0.3, null, R)).toBe(0.3);
  });
  it('maps values to ±135°', () => {
    expect(valueToAngle(0, R)).toBe(-135);
    expect(valueToAngle(0.5, R)).toBe(0);
    expect(valueToAngle(1, BI)).toBe(135);
  });
  it('fader position ↔ value', () => {
    expect(positionToValue(150, 100, 200, R, false)).toBeCloseTo(0.25, 9);
    expect(positionToValue(100, 100, 200, R, true)).toBe(1);
    expect(positionToValue(500, 100, 200, BI, false)).toBe(1);
    expect(valueToFraction(0, BI)).toBe(0.5);
  });
});
