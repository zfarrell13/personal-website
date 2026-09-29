import type { TrackEntry } from '@/shared/tracks';
import { AudioEngine } from '../engine/AudioEngine';
import { deckBpm } from '../engine/telemetry';
import { useDjStore } from '../store/djStore';

export interface EngineHarnessResult {
  mtAvailable: boolean;
  latencySec: number;
  deck1PosAfter1s: number;
  followerBpm: number;
  master: number;
  /** Deck 1 plays key-locked at +8 %. */
  mtWetAt8Pct: boolean;
  /** Strongest master partial between 180 and 300 Hz at +8 % with Master Tempo (deck 1's 220 Hz tone). */
  tonePeakHzAt8Pct: number;
  masterPeak: number;
  events: string[];
  spectrumMax: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `read` until `ok(value)` or `timeoutMs` elapses; returns the last value either way. */
async function pollUntil<T>(read: () => T, ok: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const until = performance.now() + timeoutMs;
  let v = read();
  while (!ok(v) && performance.now() < until) {
    await sleep(20);
    v = read();
  }
  return v;
}

/** Frequency of the strongest bin in [loHz, hiHz] (parabolic interpolation on dB). */
function peakHz(an: AnalyserNode, loHz: number, hiHz: number): number {
  const db = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(db);
  const binHz = an.context.sampleRate / an.fftSize;
  let best = Math.ceil(loHz / binHz);
  for (let i = best; i <= Math.floor(hiHz / binHz); i++) if (db[i]! > db[best]!) best = i;
  const [a, b, c] = [db[best - 1]!, db[best]!, db[best + 1]!];
  const offset = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return (best + offset) * binHz;
}

/** Synthesized 30 s kick + tone at `bpm` with the first beat at 0.25 s. */
function synth(ctx: BaseAudioContext, bpm: number, hz: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const b = new AudioBuffer({ length: sr * 30, numberOfChannels: 2, sampleRate: sr });
  const spb = 60 / bpm;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const bt = (((t - 0.25) % spb) + spb) % spb;
      d[i] = t < 0.25 ? 0 : 0.5 * Math.sin(2 * Math.PI * 55 * bt) * Math.exp(-bt * 9) + 0.15 * Math.sin(2 * Math.PI * hz * t);
    }
  }
  return b;
}

const entry = (id: string, bpm: number): TrackEntry => ({
  id,
  title: id,
  artist: 'harness',
  bpm,
  key: '8A',
  firstBeatSec: 0.25,
  memoryCues: [16],
  surf: false,
  durationSec: 30,
  sampleRate: 48000,
  audioUrl: '',
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: '',
  overviewUrl: '',
});

/**
 * Drives the real engine in the browser without any UI: two decks, SYNC, Master Tempo,
 * Colour + Beat FX, a hot cue. Used by /dev/dj-engine and tests/e2e/dj-engine.spec.ts.
 */
export async function runEngineHarness(): Promise<EngineHarnessResult> {
  const events: string[] = [];
  const engine = await AudioEngine.create({ onDeckEvent: (d, e) => events.push(`${d}:${e.kind}`) });
  const store = useDjStore;
  store.getState().reset();
  engine.applyState(store.getState(), null);
  const unsub = store.subscribe((s, p) => engine.applyState(s, p));
  const timer = setInterval(() => engine.tick(store.getState()), 16);
  try {
    engine.loadTrack(0, entry('a', 120), synth(engine.ctx, 120, 220), Array(8).fill(null));
    engine.loadTrack(1, entry('b', 124), synth(engine.ctx, 124, 330), Array(8).fill(null));
    store.getState().setChannel(0, { fader: 1 });
    store.getState().setChannel(1, { fader: 1 });
    engine.command({ t: 'play', deck: 0 });
    // Poll rather than sleep a fixed second: a cold dev server can delay the first render quanta.
    const deck1PosAfter1s = await pollUntil(() => engine.telemetry.decks[0].posSec, (p) => p > 0.9, 5000);
    store.getState().setDeck(1, { sync: true });
    engine.command({ t: 'play', deck: 1 });
    await sleep(1500);
    const followerBpm = deckBpm(engine.telemetry.decks[1]);
    const master = engine.telemetry.master;
    // Key lock: deck 1 alone at +8 % with Master Tempo; its 220 Hz tone must stay at 220 Hz.
    const an = new AnalyserNode(engine.ctx, { fftSize: 16384, smoothingTimeConstant: 0 });
    engine.mixer.masterOut.connect(an);
    store.getState().setChannel(1, { fader: 0 });
    store.getState().setDeck(0, { masterTempo: true, tempoPct: 8 });
    await sleep(800);
    const mtWetAt8Pct = engine.masterTempoWet(0);
    const tonePeakHzAt8Pct = peakHz(an, 180, 300);
    engine.mixer.masterOut.disconnect(an);
    store.getState().setChannel(1, { fader: 1 });
    store.getState().setMixer({ colorFxType: 'CRUSH' });
    store.getState().setChannel(0, { color: 0.6, low: 0 });
    store.getState().setBeatFx({ on: true, type: 'ECHO' });
    await sleep(600);
    engine.command({ t: 'hotcue', deck: 0, index: 0, down: true, shift: false });
    await sleep(100);
    const spectrum = new Uint8Array(128);
    engine.readSpectrum(spectrum);
    return {
      mtAvailable: engine.mtAvailable,
      latencySec: engine.telemetry.latencySec,
      deck1PosAfter1s,
      followerBpm,
      master,
      mtWetAt8Pct,
      tonePeakHzAt8Pct,
      masterPeak: Math.max(...engine.telemetry.levels.master),
      events,
      spectrumMax: Math.max(...spectrum),
    };
  } finally {
    clearInterval(timer);
    unsub();
    await engine.dispose();
    store.getState().reset();
  }
}
