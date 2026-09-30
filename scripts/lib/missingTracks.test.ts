import { describe, expect, it } from 'vitest';
import { missingTracksPolicy } from './missingTracks';

const missing = ['a.mp3', 'b.mp3'];

describe('missingTracksPolicy', () => {
  it('nothing missing: build the real tracks, wherever it runs', () => {
    expect(missingTracksPolicy([], {})).toEqual({ action: 'real' });
    expect(missingTracksPolicy([], { CI: 'true', VERCEL: '1' })).toEqual({ action: 'real' });
  });

  it('on a local machine, missing files fall back to the placeholders with a warning', () => {
    const p = missingTracksPolicy(missing, {});
    expect(p.action).toBe('placeholder');
    expect(p.action === 'placeholder' && p.message).toMatch(/2 track file\(s\) missing.*a\.mp3, b\.mp3.*placeholder/);
  });

  it('in CI or on Vercel, missing files fail the build with how to fix it', () => {
    for (const env of [{ CI: 'true' }, { CI: '1' }, { VERCEL: '1' }, { CI: '1', VERCEL: '1' }]) {
      const p = missingTracksPolicy(missing, env);
      expect(p.action, JSON.stringify(env)).toBe('fail');
      expect(p.action === 'fail' && p.message).toMatch(/a\.mp3, b\.mp3/);
      expect(p.action === 'fail' && p.message).toMatch(/ALLOW_PLACEHOLDER_TRACKS=1/);
    }
  });

  it('ALLOW_PLACEHOLDER_TRACKS=1 lets a CI or Vercel build ship the placeholders (with the warning)', () => {
    expect(missingTracksPolicy(missing, { CI: 'true', ALLOW_PLACEHOLDER_TRACKS: '1' }).action).toBe('placeholder');
    expect(missingTracksPolicy(missing, { VERCEL: '1', ALLOW_PLACEHOLDER_TRACKS: '1' }).action).toBe('placeholder');
    expect(missingTracksPolicy(missing, { VERCEL: '1', ALLOW_PLACEHOLDER_TRACKS: 'yes' }).action).toBe('fail'); // only "1"
  });

  it('an empty CI / VERCEL variable counts as unset', () => {
    expect(missingTracksPolicy(missing, { CI: '', VERCEL: '' }).action).toBe('placeholder');
  });
});
