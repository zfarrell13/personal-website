import { describe, expect, it } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { Playlist } from './Playlist';
import { fillImpulse, hootVoices, mulberry32, shuffle, sprayParams, tubeCutoffHz } from './synth';

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

describe('synth helpers', () => {
  it('shuffles deterministically without losing items', () => {
    const a = shuffle([1, 2, 3, 4, 5], mulberry32(1));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(1))).toEqual(a);
  });
  it('maps tube depth to 20 kHz → 800 Hz', () => {
    expect(tubeCutoffHz(0)).toBeCloseTo(20000);
    expect(tubeCutoffHz(1)).toBeCloseTo(800);
    expect(tubeCutoffHz(0.5)).toBeLessThan(5000);
  });
  it('raises spray pitch and level with speed and carving', () => {
    const slow = sprayParams(3, 0);
    const fast = sprayParams(12, 1);
    expect(fast.freq).toBeGreaterThan(slow.freq);
    expect(fast.gain).toBeGreaterThan(slow.gain);
    expect(sprayParams(100, 5).gain).toBeLessThanOrEqual(0.4);
  });
  it('builds plausible hoot voices', () => {
    const v = hootVoices(7);
    expect(v).toHaveLength(6);
    for (const h of v) {
      expect(h.f0).toBeGreaterThan(150);
      expect(h.f1[1]).toBeGreaterThan(h.f1[0]);
      expect(Math.abs(h.pan)).toBeLessThanOrEqual(0.8);
    }
  });
  it('decays the impulse response by ~60 dB', () => {
    const n = 44100;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    fillImpulse(l, r, 44100, 1);
    const peak = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(l, 0, 1000)).toBeGreaterThan(0.5);
    expect(peak(l, n - 1000, n)).toBeLessThan(0.002);
  });
});
