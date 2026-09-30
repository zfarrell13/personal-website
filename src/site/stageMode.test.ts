import { describe, expect, it } from 'vitest';
import { stageModeFor } from './stageMode';

describe('stageModeFor', () => {
  it('plays on /surf and anything under it', () => {
    expect(stageModeFor('/surf')).toBe('play');
    expect(stageModeFor('/surf?x')).toBe('play');
    expect(stageModeFor('/surf/')).toBe('play');
    expect(stageModeFor('/surf/replay')).toBe('play');
  });

  it('is attract everywhere else', () => {
    expect(stageModeFor('/')).toBe('attract');
    expect(stageModeFor('/career')).toBe('attract');
    expect(stageModeFor('/surfing')).toBe('attract');
    expect(stageModeFor('/projects/surf')).toBe('attract');
  });
});
