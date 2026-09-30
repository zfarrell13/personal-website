import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      (this as unknown as Record<string, () => unknown>)[`create${k}`] = vi.fn(() => fakeNode());
    }
  }
}

// Any <audio> element (new Audio() or document.createElement) is a failure: music belongs to the site player.
const audioCtor = vi.fn();
class FakeElement {
  constructor() {
    audioCtor();
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ctxs.length = 0;
  audioCtor.mockClear();
  resumeGate = Promise.resolve();
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('Audio', FakeElement);
  vi.stubGlobal('document', { createElement: vi.fn(() => new FakeElement()) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SurfAudio', () => {
  it('plays no music: no audio element is ever created', async () => {
    const audio = new SurfAudio();
    await audio.start();
    await flush();
    audio.pause();
    audio.resume();
    audio.update({ mode: 'riding', inTube: true, tubeDepth: 1, turnRate: 0, stalling: false } as never, 10, { distance: 5, fast: 0 });
    audio.onEvent({ type: 'tubeExit', time: 1, duration: 3 } as never);
    audio.onBank(5000, 4);
    audio.dispose();
    expect(audioCtor).not.toHaveBeenCalled();
    expect((ctxs[0] as unknown as { createMediaElementSource: () => unknown }).createMediaElementSource).not.toHaveBeenCalled();
  });

  it('a pause while start() is still resuming the context leaves it suspended until resume()', async () => {
    resumeGate = new Promise<void>((r) => (openGate = r));
    const audio = new SurfAudio();
    const started = audio.start();
    audio.pause();
    openGate();
    await started;
    const ctx = ctxs[0]!;
    expect(ctx.suspend.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(ctx.resume.mock.invocationCallOrder[0]!);
    audio.resume();
    expect(ctx.resume.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(ctx.suspend.mock.invocationCallOrder.at(-1)!);
    audio.dispose();
  });
});
