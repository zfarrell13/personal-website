import { describe, expect, it } from 'vitest';
import { emptySlots, getStorage, hotCueKey, loadHotCues, saveHotCues } from './hotcueStorage';

const mem = () => {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

describe('hot cue storage', () => {
  it('round-trips per track', () => {
    const s = mem();
    const slots = emptySlots();
    slots[2] = { sec: 12.5, color: '#28e214' };
    saveHotCues(s, 'test-tidal', slots);
    expect(Object.keys(s.data)).toEqual([hotCueKey('test-tidal')]);
    expect(loadHotCues(s, 'test-tidal')).toEqual(slots);
    expect(loadHotCues(s, 'other')).toEqual(emptySlots());
  });
  it('ignores corrupt data and throwing storage', () => {
    const s = mem();
    s.data[hotCueKey('x')] = '{nope';
    expect(loadHotCues(s, 'x')).toHaveLength(8);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadHotCues(broken, 'x')).toEqual(emptySlots());
    expect(() => saveHotCues(broken, 'x', emptySlots())).not.toThrow();
  });
  it('getStorage returns null when the localStorage accessor throws (SecurityError)', () => {
    const g = globalThis as { localStorage?: unknown };
    const had = Object.getOwnPropertyDescriptor(g, 'localStorage');
    Object.defineProperty(g, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    try {
      expect(getStorage()).toBeNull();
      expect(loadHotCues(getStorage(), 'x')).toEqual(emptySlots());
      expect(() => saveHotCues(getStorage(), 'x', emptySlots())).not.toThrow();
    } finally {
      if (had) Object.defineProperty(g, 'localStorage', had);
      else delete g.localStorage;
    }
  });
});
