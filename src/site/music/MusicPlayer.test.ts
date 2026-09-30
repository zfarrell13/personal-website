import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { mulberry32 } from '@/shared/random';
import { MUTE_STORAGE_KEY, MusicPlayer, type MusicDeps, type MusicState } from './MusicPlayer';

// --- Minimal HTMLAudioElement / Web Audio fakes (node has neither). ---------

class FakeAudio {
  src = '';
  preload = '';
  paused = true;
  /** When true, play() rejects as a browser does for an undecodable file (and `error` fires). */
  broken = false;
  play = vi.fn(() => {
    if (this.broken) return Promise.reject(Object.assign(new Error('undecodable'), { name: 'NotSupportedError' }));
    this.paused = false;
    this.fire('playing');
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
  private readonly handlers = new Map<string, Array<() => void>>();
  addEventListener(type: string, cb: () => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }
  removeEventListener(type: string, cb: () => void) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== cb));
  }
  fire(type: 'ended' | 'error' | 'playing' | 'pause') {
    for (const h of this.handlers.get(type) ?? []) h();
  }
}

const param = (value: number) => ({ value, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() });
type Param = ReturnType<typeof param>;

class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = { connect: vi.fn() };
  filters: Array<{ type: string; frequency: Param }> = [];
  gains: Array<{ gain: Param }> = [];
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => Promise.resolve());
  createMediaElementSource = vi.fn(() => ({ connect: (n: unknown) => n }));
  createBiquadFilter = vi.fn(() => {
    const f = { type: '', frequency: param(350), Q: param(1), connect: (n: unknown) => n };
    this.filters.push(f);
    return f;
  });
  createGain = vi.fn(() => {
    const g = { gain: param(1), connect: (n: unknown) => n };
    this.gains.push(g);
    return g;
  });
}

const track = (id: string): TrackEntry => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  bpm: 120,
  key: '8A',
  firstBeatSec: 0,
  memoryCues: [],
  surf: true,
  durationSec: 180,
  sampleRate: 44100,
  audioUrl: `/tracks/${id}/audio.m4a`,
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: '',
  overviewUrl: '',
});
const TRACKS = [track('a'), track('b'), track('c')];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  };
}

function setup(over: Partial<MusicDeps> = {}) {
  const audios: FakeAudio[] = [];
  const contexts: FakeContext[] = [];
  const loadTracks = vi.fn(() => Promise.resolve(TRACKS));
  const deps: Partial<MusicDeps> = {
    createAudio: () => {
      const a = new FakeAudio();
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    loadTracks,
    storage: memoryStorage(),
    random: mulberry32(7),
    ...over,
  };
  const player = new MusicPlayer(deps);
  players.push(player);
  return { player, audios, contexts, loadTracks, audio: () => audios[0]!, ctx: () => contexts[0]! };
}

const players: MusicPlayer[] = [];
afterEach(() => {
  players.splice(0).forEach((p) => p.dispose());
  vi.restoreAllMocks();
});

const idOf = (s: MusicState) => s.track?.id;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('MusicPlayer', () => {
  it('is idempotent: one element, one context; the first track plays', async () => {
    const { player, audios, contexts, loadTracks } = setup();
    expect(player.context).toBeNull();
    expect(player.audioElement).toBeNull();
    await Promise.all([player.start(), player.start()]);
    await player.start();
    expect(audios).toHaveLength(1);
    expect(contexts).toHaveLength(1);
    expect(loadTracks).toHaveBeenCalledTimes(1);
    expect(player.context).toBe(contexts[0]);
    expect(player.audioElement).toBe(audios[0]);
    expect(contexts[0]!.resume).toHaveBeenCalled();
    const s = player.getState();
    expect(s.playing).toBe(true);
    expect(s.muted).toBe(false);
    expect(s.trackKey).toBe(1);
    expect(s.track).toEqual({ id: idOf(s), title: `Title ${idOf(s)}`, artist: `Artist ${idOf(s)}` });
    expect(audios[0]!.src).toBe(`/tracks/${idOf(s)}/audio.m4a`);
    expect(audios[0]!.play).toHaveBeenCalledTimes(1);
  });

  it('advances on `ended`, playing each of the 3 tracks once per cycle', async () => {
    const { player, audio } = setup();
    await player.start();
    const first = idOf(player.getState());
    audio().fire('ended');
    const s = player.getState();
    expect(s.trackKey).toBe(2);
    expect(idOf(s)).not.toBe(first);
    const cycle = new Set([first, idOf(s)]);
    audio().fire('ended');
    cycle.add(idOf(player.getState()));
    expect(cycle).toEqual(new Set(['a', 'b', 'c']));
    expect(player.getState().trackKey).toBe(3);
    expect(player.getState().playing).toBe(true);
  });

  it('skip() advances to another track', async () => {
    const { player, audio } = setup();
    await player.start();
    const first = idOf(player.getState());
    player.skip();
    expect(player.getState().trackKey).toBe(2);
    expect(idOf(player.getState())).not.toBe(first);
    expect(audio().play).toHaveBeenCalledTimes(2);
  });

  it('mute pauses and persists; a muted player never plays until unmuted', async () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    await a.player.start();
    a.player.setMuted(true);
    expect(a.audio().pause).toHaveBeenCalled();
    expect(a.audio().paused).toBe(true);
    expect(a.player.getState()).toMatchObject({ muted: true, playing: false });
    expect(storage.data.get(MUTE_STORAGE_KEY)).toBe('1');
    const muteGain = a.ctx().gains[0]!.gain.setTargetAtTime;
    expect(muteGain).toHaveBeenLastCalledWith(0, expect.any(Number), expect.any(Number));

    const b = setup({ storage });
    expect(b.player.getState().muted).toBe(true);
    await b.player.start();
    expect(b.audio().play).not.toHaveBeenCalled();
    expect(b.player.getState()).toMatchObject({ muted: true, playing: false, track: null });
    b.player.setMuted(false);
    await vi.waitFor(() => expect(b.player.getState().playing).toBe(true));
    expect(b.audio().play).toHaveBeenCalledTimes(1);
    expect(b.player.getState()).toMatchObject({ muted: false, trackKey: 1 });
    expect(storage.data.get(MUTE_STORAGE_KEY)).toBe('0');
  });

  it('unmuting before any gesture starts the playlist', async () => {
    const storage = memoryStorage({ [MUTE_STORAGE_KEY]: '1' });
    const { player, contexts, audio } = setup({ storage });
    expect(player.getState().muted).toBe(true);
    player.setMuted(false);
    expect(contexts).toHaveLength(1);
    await vi.waitFor(() => expect(player.getState().playing).toBe(true));
    expect(audio().play).toHaveBeenCalledTimes(1);
  });

  it('muting while the manifest loads keeps the music silent', async () => {
    const { player, audio } = setup();
    const started = player.start();
    player.setMuted(true);
    await started;
    expect(audio().play).not.toHaveBeenCalled();
    expect(player.getState().playing).toBe(false);
  });

  it('survives storage that throws', async () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const { player } = setup({ storage });
    expect(player.getState().muted).toBe(false);
    await player.start();
    expect(() => player.setMuted(true)).not.toThrow();
    expect(player.getState().muted).toBe(true);
  });

  it('gives up after one full cycle of `error`s instead of looping forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { player, audio } = setup();
    const a = new Set<string>();
    await player.start();
    audio().broken = true;
    a.add(audio().src);
    for (let i = 0; i < 10; i++) {
      audio().fire('error');
      a.add(audio().src);
    }
    await flush();
    // The first src was already attempted before `broken` was set, so 1 + 2 skips = the whole cycle.
    expect(a.size).toBe(3);
    expect(audio().play).toHaveBeenCalledTimes(3);
    expect(player.getState().playing).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a `playing` track resets the error budget', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { player, audio } = setup();
    await player.start();
    audio().fire('error');
    audio().fire('error'); // each skipped-to track reaches `playing`, so the count never reaches 3
    audio().fire('error');
    audio().fire('error');
    expect(audio().play).toHaveBeenCalledTimes(5);
  });

  it('ignores AbortError from play() and warns on other rejections', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { player, audio } = setup();
    await player.start();
    audio().play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
    player.skip();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    audio().play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })));
    player.skip();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });

  it('builds element → lowpass(20000) → gain(0.8) and smooths muffle and duck', async () => {
    const { player, ctx } = setup();
    await player.start();
    const filter = ctx().filters[0]!;
    const gain = ctx().gains[0]!;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(20000);
    expect(gain.gain.value).toBeCloseTo(0.8);
    player.setMuffleHz(800);
    expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(800, expect.any(Number), expect.any(Number));
    player.setDuck(0.3);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.24, 6), expect.any(Number), expect.any(Number));
  });

  it('applies muffle and duck set before start to the new graph', async () => {
    const { player, ctx } = setup();
    player.setMuffleHz(1200);
    player.setDuck(0.5);
    await player.start();
    expect(ctx().filters[0]!.frequency.value).toBe(1200);
    expect(ctx().gains[0]!.gain.value).toBeCloseTo(0.4);
  });

  it('notifies subscribers until they unsubscribe', async () => {
    const { player, audio } = setup();
    const seen: MusicState[] = [];
    const off = player.subscribe((s) => seen.push(s));
    await player.start();
    expect(seen.at(-1)).toBe(player.getState());
    expect(seen.at(-1)!.playing).toBe(true);
    const n = seen.length;
    off();
    audio().fire('ended');
    player.setMuted(true);
    expect(seen).toHaveLength(n);
  });

  it('getState() is a stable snapshot between changes', async () => {
    const { player } = setup();
    const before = player.getState();
    expect(player.getState()).toBe(before);
    await player.start();
    expect(player.getState()).not.toBe(before);
  });

  it('a later start() retries a play() the browser blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked = new FakeAudio();
    blocked.play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })));
    const { player } = setup({ createAudio: () => blocked as unknown as HTMLAudioElement });
    await player.start();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(player.getState().playing).toBe(false);
    await player.start();
    expect(blocked.play).toHaveBeenCalledTimes(2);
    expect(player.getState().playing).toBe(true);
  });

  it('a failed manifest leaves the player idle and marks the music unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { player, audios } = setup({ loadTracks: () => Promise.reject(new Error('404')) });
    expect(player.getState().unavailable).toBe(false);
    await player.prefetch();
    expect(player.getState().unavailable).toBe(true);
    await player.start();
    expect(player.getState()).toMatchObject({ track: null, playing: false, unavailable: true });
    expect(audios.every((a) => a.play.mock.calls.length === 0)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('an empty manifest marks the music unavailable', async () => {
    const { player } = setup({ loadTracks: () => Promise.resolve([]) });
    await player.start();
    expect(player.getState()).toMatchObject({ track: null, unavailable: true });
  });

  it('with the manifest prefetched, start() calls play() synchronously inside the gesture', async () => {
    const { player, audio, loadTracks } = setup();
    await player.prefetch();
    const started = player.start();
    expect(audio().play).toHaveBeenCalledTimes(1); // before the promise is awaited
    expect(player.getState().trackKey).toBe(1);
    await started;
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(loadTracks).toHaveBeenCalledTimes(1);
  });

  it('with the manifest prefetched, the unmute click of a muted visitor plays synchronously', async () => {
    const storage = memoryStorage({ [MUTE_STORAGE_KEY]: '1' });
    const { player, audio } = setup({ storage });
    await player.prefetch();
    await player.start(); // muted: nothing plays
    expect(audio().play).not.toHaveBeenCalled();
    player.setMuted(false);
    expect(audio().play).toHaveBeenCalledTimes(1);
  });

  it('prefetch() is idempotent and shared with start()', async () => {
    const { player, loadTracks } = setup();
    void player.prefetch();
    void player.prefetch();
    await player.start();
    expect(loadTracks).toHaveBeenCalledTimes(1);
  });

  it('resume() re-arms after an interruption, and is a no-op before start or while muted', async () => {
    const { player, audio, ctx } = setup();
    player.resume(); // before start: nothing to resume, and it must not start anything
    expect(player.context).toBeNull();
    await player.start();
    ctx().state = 'interrupted' as AudioContextState;
    audio().pause(); // e.g. iOS paused the element for a phone call
    audio().fire('pause');
    const resumes = ctx().resume.mock.calls.length;
    player.resume();
    expect(ctx().resume).toHaveBeenCalledTimes(resumes + 1);
    expect(audio().play).toHaveBeenCalledTimes(2);
    expect(player.getState().playing).toBe(true);
    player.resume(); // already running and playing: cheap no-op
    expect(ctx().resume).toHaveBeenCalledTimes(resumes + 1);
    expect(audio().play).toHaveBeenCalledTimes(2);
    player.setMuted(true);
    player.resume();
    expect(audio().play).toHaveBeenCalledTimes(2);
  });

  it('asks iOS for a playback audio session where supported', async () => {
    const audioSession = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession });
    try {
      const { player } = setup();
      await player.start();
      expect(audioSession.type).toBe('playback');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dispose() stops the element and closes the context', async () => {
    const { player, audio, ctx } = setup();
    await player.start();
    player.dispose();
    expect(audio().pause).toHaveBeenCalled();
    expect(ctx().close).toHaveBeenCalled();
    expect(player.getState().playing).toBe(false);
  });
});
