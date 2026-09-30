import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage } from './storage';

describe('browserStorage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns null without a window', () => {
    expect(browserStorage()).toBeNull();
  });
  it('returns null when the localStorage getter throws', () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('blocked'); } }));
    expect(browserStorage()).toBeNull();
  });
  it('returns window.localStorage when available', () => {
    const ls = { getItem: () => null } as unknown as Storage;
    vi.stubGlobal('window', { localStorage: ls });
    expect(browserStorage()).toBe(ls);
  });
});
