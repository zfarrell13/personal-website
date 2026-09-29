import { describe, expect, it } from 'vitest';
import { BOOTH_H, BOOTH_W, fitScale, isCompact, panelAt } from './layout';

describe('layout', () => {
  it('fits the booth into the viewport', () => {
    expect(fitScale(BOOTH_W, BOOTH_H, 1440, 900 - 64)).toBeCloseTo((900 - 64 - 32) / 900, 6);
    expect(fitScale(BOOTH_W, BOOTH_H, 1280, 1080)).toBeCloseTo((1280 - 32) / 1380, 6);
  });
  it('switches to panels on phones', () => {
    expect(isCompact(844, 390)).toBe(true);
    expect(isCompact(1440, 900)).toBe(false);
  });
  it('picks the snapped panel', () => {
    expect(panelAt(0, 800)).toBe(0);
    expect(panelAt(790, 800)).toBe(1);
    expect(panelAt(5000, 800)).toBe(2);
  });
});
