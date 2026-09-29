import { describe, expect, it } from 'vitest';
import { resolveTrackSource } from './resolveTrackSource';

const enoent = () => {
  throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
};
const track = { id: 'a', title: 'A', artist: 'B', file: 'a.wav', bpm: 120, key: '8A', firstBeatSec: 0 };

describe('resolveTrackSource', () => {
  it('missing file -> test', () => expect(resolveTrackSource(enoent)).toBe('test'));
  it('empty tracks -> test', () => expect(resolveTrackSource(() => '{"tracks":[]}')).toBe('test'));
  it('valid track -> real', () => expect(resolveTrackSource(() => JSON.stringify({ tracks: [track] }))).toBe('real'));
  it('trailing comma throws', () => {
    expect(() => resolveTrackSource(() => '{"tracks":[],}')).toThrow(/tracks\.json/);
  });
  it('invalid bpm throws mentioning field', () => {
    expect(() => resolveTrackSource(() => JSON.stringify({ tracks: [{ ...track, bpm: -1 }] }))).toThrow(/tracks\[0\]\.bpm/);
  });
  it('other read errors propagate', () => {
    expect(() =>
      resolveTrackSource(() => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    ).toThrow(/denied/);
  });
});
