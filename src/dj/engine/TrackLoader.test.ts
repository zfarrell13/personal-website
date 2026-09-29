import { describe, expect, it, vi } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { encodeWaveform } from '@/shared/waveform';
import { LruCache, pcmForDeck, pcmTransferList, TrackLoader } from './TrackLoader';

const entry = (id: string): TrackEntry => ({
  id,
  title: id,
  artist: 'T',
  bpm: 120,
  key: '8A',
  firstBeatSec: 0.25,
  memoryCues: [],
  surf: false,
  durationSec: 10,
  sampleRate: 44100,
  audioUrl: `/tracks/${id}/audio.m4a`,
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: `/tracks/${id}/waveform.bin`,
  overviewUrl: `/tracks/${id}/overview.bin`,
});

const wf = encodeWaveform({ binsPerSec: 150, binCount: 1, low: new Uint8Array([1]), mid: new Uint8Array([2]), high: new Uint8Array([3]) });

function fakes() {
  const fetchFn = vi.fn(async (url: string) => new Response(url.endsWith('.bin') ? wf.slice() : new Uint8Array([1, 2, 3])));
  const decoder = { decodeAudioData: vi.fn(async (_buf: ArrayBuffer) => ({ duration: 10 }) as AudioBuffer) };
  return { fetchFn, decoder, loader: new TrackLoader(decoder, fetchFn as unknown as typeof fetch) };
}

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.keys()).toEqual(['a', 'c']);
  });
});

describe('TrackLoader', () => {
  it('decodes once and serves reloads from the cache', async () => {
    const { fetchFn, decoder, loader } = fakes();
    await loader.decode(entry('a'));
    await loader.decode(entry('a'));
    expect(decoder.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 4 decoded tracks', async () => {
    const { decoder, loader } = fakes();
    for (const id of ['a', 'b', 'c', 'd', 'e']) await loader.decode(entry(id));
    expect(loader.cachedIds()).toEqual(['b', 'c', 'd', 'e']);
    await loader.decode(entry('a'));
    expect(decoder.decodeAudioData).toHaveBeenCalledTimes(6);
  });

  it('fetches both waveform files', async () => {
    const { fetchFn, loader } = fakes();
    const w = await loader.waveforms(entry('a'));
    expect(w.detail.binCount).toBe(1);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['/tracks/a/waveform.bin', '/tracks/a/overview.bin']);
  });

  it('forgets failed decodes so they can be retried', async () => {
    const { decoder, loader } = fakes();
    decoder.decodeAudioData.mockRejectedValueOnce(new Error('bad'));
    await expect(loader.decode(entry('x'))).rejects.toThrow('bad');
    await new Promise((r) => setTimeout(r, 0));
    await expect(loader.decode(entry('x'))).resolves.toBeTruthy();
  });
});

describe('pcmForDeck', () => {
  const fakeBuffer = (chans: Float32Array[]) =>
    ({ numberOfChannels: chans.length, getChannelData: (i: number) => chans[i]! }) as unknown as AudioBuffer;

  it('copies both channels so the cached AudioBuffer survives the transfer', () => {
    const l = new Float32Array([1, 2]);
    const r = new Float32Array([3, 4]);
    const pcm = pcmForDeck(fakeBuffer([l, r]));
    expect([...pcm.left]).toEqual([1, 2]);
    expect([...pcm.right]).toEqual([3, 4]);
    expect(pcm.left.buffer).not.toBe(l.buffer);
    expect(pcm.right.buffer).not.toBe(r.buffer);
  });

  it('duplicates mono into two distinct transferable buffers', () => {
    const pcm = pcmForDeck(fakeBuffer([new Float32Array([5, 6])]));
    expect([...pcm.right]).toEqual([5, 6]);
    expect(pcm.right.buffer).not.toBe(pcm.left.buffer);
  });
});

describe('pcmTransferList', () => {
  it('lists each underlying buffer once (a repeated buffer throws DataCloneError)', () => {
    const a = new Float32Array(4);
    expect(pcmTransferList({ left: a, right: a })).toEqual([a.buffer]);
    const b = new Float32Array(4);
    const list: ArrayBuffer[] = pcmTransferList({ left: a, right: b });
    expect(list).toEqual([a.buffer, b.buffer]);
  });
});
