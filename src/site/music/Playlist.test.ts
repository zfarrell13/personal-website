import { describe, expect, it } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { mulberry32 } from '@/surf/audio/synth';
import { Playlist } from './Playlist';

const track = (id: string, surf = true): TrackEntry => ({
  id,
  title: id,
  artist: 'Test',
  bpm: 120,
  key: '8A',
  firstBeatSec: 0,
  memoryCues: [],
  surf,
  durationSec: 180,
  sampleRate: 44100,
  audioUrl: `/tracks/${id}/audio.m4a`,
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: '',
  overviewUrl: '',
});

describe('Playlist', () => {
  it('only plays surf tracks, each once per cycle, never the same twice in a row', () => {
    const p = new Playlist([track('a'), track('b'), track('c'), track('dj-only', false)], mulberry32(3));
    let prev = '';
    for (let cycle = 0; cycle < 20; cycle++) {
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const t = p.next()!;
        expect(t.id).not.toBe(prev);
        expect(t.id).not.toBe('dj-only');
        seen.add(t.id);
        prev = t.id;
      }
      expect(seen.size).toBe(3);
    }
  });
  it('is empty-safe', () => {
    expect(new Playlist([track('x', false)]).next()).toBeNull();
  });
});
