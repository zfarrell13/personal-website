import { describe, expect, it, vi } from 'vitest';
import { beatAtTime, beatTimeSec, loadManifest, parseManifest, parseTrackSources, secondsPerBeat } from './tracks';

const source = {
  id: 'sunset-drive',
  title: 'Sunset Drive',
  artist: 'Zach Farrell',
  file: 'sunset-drive.wav',
  bpm: 124,
  key: '8A',
  firstBeatSec: 0.05,
};

const entry = {
  ...source,
  memoryCues: [],
  surf: true,
  durationSec: 200,
  sampleRate: 44100,
  audioUrl: '/tracks/sunset-drive/audio.m4a',
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: '/tracks/sunset-drive/waveform.bin',
  overviewUrl: '/tracks/sunset-drive/overview.bin',
};

describe('parseTrackSources', () => {
  it('accepts valid sources and applies defaults', () => {
    const [t] = parseTrackSources({ tracks: [source] });
    expect(t).toMatchObject({ id: 'sunset-drive', bpm: 124, memoryCues: [], surf: false });
  });
  it('rejects bad fields with a path', () => {
    expect(() => parseTrackSources({ tracks: [{ ...source, bpm: -1 }] })).toThrow('tracks[0].bpm');
    expect(() => parseTrackSources({ tracks: [{ ...source, key: 'H9' }] })).toThrow('tracks[0].key');
    expect(() => parseTrackSources({ tracks: [{ ...source, id: 'Bad Id' }] })).toThrow('tracks[0].id');
    expect(() => parseTrackSources({ tracks: [source, source] })).toThrow('duplicate id');
    expect(() => parseTrackSources({})).toThrow('tracks');
  });
});

describe('manifest', () => {
  it('parses a manifest', () => {
    expect(parseManifest({ version: 1, tracks: [entry] }).tracks[0]!.id).toBe('sunset-drive');
  });
  it('rejects wrong versions', () => {
    expect(() => parseManifest({ version: 2, tracks: [] })).toThrow('version');
  });
  it('loads over fetch', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ version: 1, tracks: [entry] })));
    const m = await loadManifest(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('/tracks/manifest.json');
    expect(m.tracks).toHaveLength(1);
  });
  it('reports HTTP failures', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(loadManifest(fetchFn as unknown as typeof fetch)).rejects.toThrow('404');
  });
});

describe('beat math', () => {
  it('converts between beats and seconds', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(beatTimeSec({ bpm: 120, firstBeatSec: 0.25 }, 4)).toBeCloseTo(2.25);
    expect(beatAtTime({ bpm: 120, firstBeatSec: 0.25 }, 2.25)).toBeCloseTo(4);
    expect(beatAtTime({ bpm: 120, firstBeatSec: 0.25 }, 0)).toBeCloseTo(-0.5);
  });
});
