import { describe, expect, it } from 'vitest';
import { MODE_ROUTES, MODE_STORAGE_KEY, otherMode, readMode, writeMode } from './mode';

const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
};

describe('mode', () => {
  it('uses the stored value when valid', () => {
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'dark' }), false)).toBe('dark');
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'light' }), true)).toBe('light');
  });
  it('falls back to the system preference', () => {
    expect(readMode(memory(), true)).toBe('dark');
    expect(readMode(memory(), false)).toBe('light');
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'purple' }), true)).toBe('dark');
    expect(readMode(null, false)).toBe('light');
  });
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readMode(broken, true)).toBe('dark');
    expect(() => writeMode(broken, 'dark')).not.toThrow();
  });
  it('writes the mode', () => {
    const m = memory();
    writeMode(m, 'dark');
    expect(m.data[MODE_STORAGE_KEY]).toBe('dark');
  });
  it('maps modes to routes and flips', () => {
    expect(MODE_ROUTES).toEqual({ light: '/surf', dark: '/dj' });
    expect(otherMode('light')).toBe('dark');
    expect(otherMode('dark')).toBe('light');
  });
});
