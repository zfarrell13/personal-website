import { describe, expect, it } from 'vitest';
import { GUIDE_KEY, loadGuide, saveGuide } from './guidePref';

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
}
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('GUIDE preference', () => {
  it('defaults to on, round-trips off and on', () => {
    const st = memory();
    expect(loadGuide(st)).toBe(true);
    saveGuide(st, false);
    expect(st.getItem(GUIDE_KEY)).toBe('off');
    expect(loadGuide(st)).toBe(false);
    saveGuide(st, true);
    expect(loadGuide(st)).toBe(true);
  });

  it('works without storage (null or throwing): on, and saving is a no-op', () => {
    expect(loadGuide(null)).toBe(true);
    expect(loadGuide(throwing)).toBe(true);
    expect(() => saveGuide(null, false)).not.toThrow();
    expect(() => saveGuide(throwing, false)).not.toThrow();
  });
});
