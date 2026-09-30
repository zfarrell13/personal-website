import { describe, expect, it } from 'vitest';
import { attractFpsFor, stageModeFor } from './stageMode';

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

describe('attractFpsFor', () => {
  it('keeps the title menu at 30 fps: the wave is the backdrop there', () => {
    expect(attractFpsFor('/')).toBe(30);
    expect(attractFpsFor('/?tracks=test')).toBe(30);
  });

  it('drops to 12 fps behind the section screens (their panels cover almost all of it)', () => {
    for (const path of ['/profile', '/career', '/trophies', '/credits', '/career/', '/credits?x', '/trophies#surf']) {
      expect(attractFpsFor(path), path).toBe(12);
    }
  });

  it('is 30 anywhere else (a 404, a dev page, a path that only starts like a section)', () => {
    expect(attractFpsFor('/careers')).toBe(30);
    expect(attractFpsFor('/dev/retro')).toBe(30);
    expect(attractFpsFor('/nope')).toBe(30);
  });
});
