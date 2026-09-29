import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { DEBUG_PARAMS, getConfigPath, setConfigPath } from './debugParams';

describe('debug params', () => {
  it('every path exists and its default lies inside the slider range', () => {
    for (const [path, min, max] of DEBUG_PARAMS) {
      const v = getConfigPath(SURF_CONFIG, path);
      expect(v, path).toBeGreaterThanOrEqual(min);
      expect(v, path).toBeLessThanOrEqual(max);
    }
  });
  it('sets nested numbers and rejects bad paths', () => {
    const cfg = structuredClone(SURF_CONFIG);
    setConfigPath(cfg, 'wave.height', 3);
    expect(cfg.wave.height).toBe(3);
    expect(() => setConfigPath(cfg, 'wave.nope', 1)).toThrow();
  });
});
