import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { createDjActions } from './actions';
import type { AudioEngine } from './engine/AudioEngine';
import { createTelemetry } from './engine/telemetry';
import { deckSettingsFromState, useDjStore } from './store/djStore';
import { effectiveTempoPct } from './store/tempoLogic';
import { hotCueKey } from './store/hotcueStorage';

const track = (id: string, bpm: number) => ({ id, title: id.toUpperCase(), bpm, memoryCues: [], firstBeatSec: 0.25 }) as unknown as TrackEntry;
const tracks = [track('a', 128), track('b', 100), track('c', 120)];

function fakeEngine() {
  const telemetry = createTelemetry();
  const engine = {
    telemetry,
    command: vi.fn(),
    loadTrack: vi.fn(),
    loader: {
      waveforms: vi.fn(async () => ({ detail: { binCount: 1 }, overview: { binCount: 1 } })),
      decode: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
    },
    mixer: { setHeadphoneDevice: vi.fn(async () => true) },
  };
  return engine;
}
const storage = () => {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const deckState = (d: 0 | 1) => useDjStore.getState().decks[d];
const effBpm = (bpm: number, pct: number) => bpm * (1 + pct / 100);

beforeEach(() => useDjStore.getState().reset());

describe('DjActions', () => {
  it('sends momentary presses to the engine (hot cue uses SHIFT from the store)', () => {
    const engine = fakeEngine();
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.play(1);
    useDjStore.getState().setUi({ shift: true });
    a.hotCue(0, 2, true);
    expect(engine.command.mock.calls).toEqual([[{ t: 'play', deck: 1 }], [{ t: 'hotcue', deck: 0, index: 2, down: true, shift: true }]]);
  });

  it('loads a track: store first, PCM to the engine after decoding', async () => {
    const engine = fakeEngine();
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    expect(a.requestLoad(0, 'a')).toBe('loading');
    expect(deckState(0)).toMatchObject({ trackId: 'a', loading: true });
    await flush();
    expect(engine.loadTrack).toHaveBeenCalledWith(0, tracks[0], expect.anything(), Array(8).fill(null));
    expect(deckState(0).loading).toBe(false);
    expect(a.requestLoad(0, 'nope')).toBe('missing');
  });

  it('a superseded load never reaches the engine', async () => {
    const engine = fakeEngine();
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.requestLoad(0, 'a');
    a.requestLoad(0, 'b');
    await flush();
    expect(engine.loadTrack).toHaveBeenCalledTimes(1);
    expect(engine.loadTrack).toHaveBeenCalledWith(0, tracks[1], expect.anything(), expect.anything());
  });

  it('asks for confirmation when the deck is on air, then loads on the second tap', () => {
    const engine = fakeEngine();
    Object.assign(engine.telemetry.decks[0], { loaded: true, state: 'PLAYING' });
    useDjStore.getState().setChannel(0, { fader: 1 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    expect(a.requestLoad(0, 'b')).toBe('confirm');
    expect(deckState(0).pendingLoad).toBe('b');
    expect(a.requestLoad(0, 'b')).toBe('loading');
  });

  it('SYNC promotes the tempo range to WIDE when needed and toggles off', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    useDjStore.getState().setDeck(1, { trackId: 'b', range: 10 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1);
    expect(deckState(1)).toMatchObject({ sync: true, range: 100 });
    a.toggleSync(1);
    expect(deckState(1).sync).toBe(false);
  });

  it('SYNC press sets the follower on the master tempo immediately', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a', tempoFader: 0.2, tempoPct: 2 });
    useDjStore.getState().setDeck(1, { trackId: 'c' });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1);
    expect(effBpm(120, deckState(1).tempoPct)).toBeCloseTo(effBpm(128, 2), 9);
  });

  it('SYNC off restores the user range and puts the tempo fader where the tempo is', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    useDjStore.getState().setDeck(1, { trackId: 'c', range: 6 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1); // needs +6.67 % → WIDE
    expect(deckState(1).range).toBe(100);
    a.tempoFader(0, -0.2); // master −2 % → follower needs +4.53 %, fits ±6 again
    const pct = deckState(1).tempoPct;
    expect(effBpm(120, pct)).toBeCloseTo(effBpm(128, -2), 9);
    a.toggleSync(1);
    const d = deckState(1);
    expect(d).toMatchObject({ sync: false, range: 6 });
    expect(d.tempoFader).toBeCloseTo(pct / 6, 2);
    expect(d.tempoPct).toBeCloseTo(pct, 2);
  });

  it('SYNC off keeps WIDE when the current tempo does not fit the user range', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    useDjStore.getState().setDeck(1, { trackId: 'b', range: 10 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1); // +28 %
    a.toggleSync(1);
    expect(deckState(1)).toMatchObject({ sync: false, range: 100 });
    expect(deckState(1).tempoFader).toBeCloseTo(0.28, 2);
  });

  it('SYNC off on WIDE keeps the exact off-grid synced tempo until the next fader touch', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    // master 128 BPM at −0.13 % (±6) → follower (100 BPM) needs +27.8336 %, far off the 0.5 % WIDE grid
    useDjStore.getState().setDeck(0, { trackId: 'a', range: 6, tempoFader: -0.13 / 6, tempoPct: -0.13 });
    useDjStore.getState().setDeck(1, { trackId: 'b', range: 10 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1);
    const synced = effectiveTempoPct(deckState(1));
    expect(synced).toBeCloseTo(27.8336, 9);
    a.toggleSync(1);
    expect(deckState(1)).toMatchObject({ sync: false, range: 100 });
    expect(effectiveTempoPct(deckState(1))).toBe(synced); // no re-quantize → no tempo jump, no drift
    expect(deckSettingsFromState(deckState(1)).tempoPct).toBe(synced);
    // the next fader touch goes back to the WIDE grid
    a.tempoFader(1, 0.3);
    expect(effectiveTempoPct(deckState(1))).toBe(30);
  });

  it('TEMPO RANGE on a WIDE-promoted follower cycles the user range, not WIDE', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    useDjStore.getState().setDeck(1, { trackId: 'c', range: 6 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1); // needs +6.67 % → promoted to WIDE
    expect(deckState(1).range).toBe(100);
    a.cycleRange(1); // user range 6 → 10: the tempo fits, so ±10 shows
    expect(deckState(1).range).toBe(10);
    a.cycleRange(1);
    expect(deckState(1).range).toBe(16);
    a.cycleRange(1);
    expect(deckState(1).range).toBe(100);
    a.cycleRange(1); // back to ±6: promoted to WIDE again, and the next press moves on
    expect(deckState(1).range).toBe(100);
    a.cycleRange(1);
    expect(deckState(1).range).toBe(10);
    a.toggleSync(1); // SYNC off restores the user's latest choice
    expect(deckState(1)).toMatchObject({ sync: false, range: 10 });
  });

  it('a MASTER change re-tracks the new follower', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 1;
    useDjStore.getState().setDeck(0, { trackId: 'a', sync: true });
    useDjStore.getState().setDeck(1, { trackId: 'c', tempoFader: 0.5, tempoPct: 5 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.setMaster(1);
    expect(engine.command).toHaveBeenCalledWith({ t: 'master', deck: 1 });
    expect(effBpm(128, deckState(0).tempoPct)).toBeCloseTo(effBpm(120, 5), 9);
    // an automatic handover reported by telemetry re-tracks too
    useDjStore.getState().setDeck(1, { sync: true });
    useDjStore.getState().setDeck(0, { sync: false, tempoPct: 1, tempoFader: 0.1 });
    engine.telemetry.master = 0;
    a.retrackSync();
    expect(effBpm(120, deckState(1).tempoPct)).toBeCloseTo(effBpm(128, 1), 9);
  });

  it('TEMPO RESET on a synced follower clears SYNC', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    useDjStore.getState().setDeck(1, { trackId: 'c' });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1);
    a.toggleTempoReset(1);
    expect(deckState(1)).toMatchObject({ sync: false, tempoReset: true });
    a.toggleTempoReset(1);
    expect(deckState(1).tempoReset).toBe(false);
  });

  it('TEMPO RESET on the master re-tracks its follower', () => {
    const engine = fakeEngine();
    engine.telemetry.master = 0;
    useDjStore.getState().setDeck(0, { trackId: 'a', tempoFader: 0.5, tempoPct: 5 });
    useDjStore.getState().setDeck(1, { trackId: 'c' });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.toggleSync(1);
    a.toggleTempoReset(0);
    expect(effBpm(120, deckState(1).tempoPct)).toBeCloseTo(128, 9);
    expect(deckState(1).sync).toBe(true);
  });

  it('TEMPO RANGE applies the new range to the fader position', () => {
    const engine = fakeEngine();
    useDjStore.getState().setDeck(0, { trackId: 'a', tempoFader: 0.5, tempoPct: 5 });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks });
    a.cycleRange(0);
    expect(deckState(0)).toMatchObject({ range: 16, tempoPct: 8, tempoFader: 0.5 });
  });

  it('stores hot cue events with the pad colour and persists them per track', () => {
    const engine = fakeEngine();
    const st = storage();
    useDjStore.getState().setDeck(0, { trackId: 'a' });
    const a = createDjActions({ engine: engine as unknown as AudioEngine, tracks, storage: st });
    a.handleDeckEvent(0, { kind: 'hotcue', index: 1, sec: 12.5 });
    expect(deckState(0).hotCues[1]).toEqual({ sec: 12.5, color: '#ff127b' });
    expect(JSON.parse(st.data[hotCueKey('a')]!)[1]).toEqual({ sec: 12.5, color: '#ff127b' });
  });
});
