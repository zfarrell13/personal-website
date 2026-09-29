import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { SurfAudio } from './SurfAudio';

// --- Minimal Web Audio / HTMLAudioElement fakes (node has neither). ---------

const param = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
function fakeNode(): Record<string, unknown> {
  const node: Record<string, unknown> = {
    connect: (next: unknown) => next,
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    gain: param(),
    frequency: param(),
    Q: param(),
    pan: param(),
    playbackRate: param(),
    threshold: param(),
    ratio: param(),
  };
  return node;
}

let resumeGate: Promise<void>;
let openGate: () => void;
const ctxs: FakeCtx[] = [];
class FakeCtx {
  sampleRate = 8000;
  currentTime = 0;
  destination = fakeNode();
  resume = vi.fn(() => resumeGate);
  suspend = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createBuffer = (ch: number, len: number) => {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { getChannelData: (i: number) => data[i]! };
  };
  constructor() {
    ctxs.push(this);
    for (const k of ['Gain', 'DynamicsCompressor', 'BiquadFilter', 'Convolver', 'BufferSource', 'Oscillator', 'StereoPanner', 'MediaElementSource']) {
      (this as unknown as Record<string, () => unknown>)[`create${k}`] = () => fakeNode();
    }
  }
}

let playResult: () => Promise<void>;
const elements: FakeElement[] = [];
class FakeElement {
  src = '';
  preload = '';
  play = vi.fn(() => playResult());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  private readonly handlers = new Map<string, () => void>();
  addEventListener(type: string, cb: () => void) {
    this.handlers.set(type, cb);
  }
  emit(type: string) {
    this.handlers.get(type)?.();
  }
  constructor() {
    elements.push(this);
  }
}

const track = (id: string): TrackEntry => ({
  id,
  title: id,
  artist: 'Test',
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
const flush = () => new Promise((r) => setTimeout(r, 0));
const domError = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  ctxs.length = 0;
  elements.length = 0;
  resumeGate = Promise.resolve();
  playResult = () => Promise.resolve();
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('Audio', FakeElement);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SurfAudio music', () => {
  it('ignores the AbortError a pause/dispose gives an in-flight play(), but still warns on real failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    playResult = () => Promise.reject(domError('AbortError'));
    const audio = new SurfAudio(() => undefined);
    await audio.start(TRACKS);
    await flush();
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    playResult = () => Promise.reject(domError('NotAllowedError'));
    elements[0]!.emit('ended');
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('a pause while start() is still resuming the context keeps the music paused until resume()', async () => {
    resumeGate = new Promise<void>((r) => (openGate = r));
    const onTrack = vi.fn();
    const audio = new SurfAudio(onTrack);
    const started = audio.start(TRACKS);
    audio.pause();
    openGate();
    await started;
    await flush();
    const ctx = ctxs[0]!;
    const music = elements[0]!;
    expect(music.src).not.toBe(''); // the track is queued …
    expect(music.play).not.toHaveBeenCalled(); // … but not playing
    expect(ctx.suspend.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(ctx.resume.mock.invocationCallOrder[0]!);

    audio.resume();
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('does not start the next track while paused', async () => {
    const audio = new SurfAudio(() => undefined);
    await audio.start(TRACKS);
    const music = elements[0]!;
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.pause();
    const before = music.src;
    music.emit('ended');
    expect(music.src).not.toBe(before);
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.resume();
    expect(music.play).toHaveBeenCalledTimes(2);
    audio.dispose();
  });
});
