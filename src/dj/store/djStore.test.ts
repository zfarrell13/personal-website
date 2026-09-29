import { beforeEach, describe, expect, it } from 'vitest';
import { deckSettingsFromState, diffSettings, initialDeck, useDjStore } from './djStore';

beforeEach(() => useDjStore.getState().reset());

describe('useDjStore', () => {
  it('updates one deck immutably', () => {
    const before = useDjStore.getState().decks;
    useDjStore.getState().setDeck(1, { slip: true });
    const after = useDjStore.getState().decks;
    expect(after[1].slip).toBe(true);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('updates channels, mixer, beat fx and ui', () => {
    const s = useDjStore.getState();
    s.setChannel(0, { fader: 1, xf: 'A' });
    s.setMixer({ crossfader: 0 });
    s.setBeatFx({ on: true, channel: '2' });
    s.setUi({ view: 'room' });
    const n = useDjStore.getState();
    expect(n.mixer.ch[0]).toMatchObject({ fader: 1, xf: 'A' });
    expect(n.mixer.crossfader).toBe(0);
    expect(n.mixer.beatFx).toMatchObject({ on: true, channel: '2', type: 'ECHO' });
    expect(n.ui.view).toBe('room');
  });

  it('routes tempo fader moves through the tempo logic', () => {
    useDjStore.getState().setTempoFader(0, -0.5, { master: -1, trackBpm: [120, 0] });
    expect(useDjStore.getState().decks[0].tempoPct).toBe(-5);
  });

  it('keeps a synced follower on the master tempo through the store', () => {
    const ctx = { master: 0 as const, trackBpm: [124, 120] as const };
    useDjStore.getState().setDeck(1, { sync: true, tempoPct: (4 / 120) * 100 });
    useDjStore.getState().setTempoFader(0, 0.5, ctx);
    const [m, f] = useDjStore.getState().decks;
    expect(124 * (1 + m.tempoPct / 100)).toBeCloseTo(120 * (1 + f.tempoPct / 100), 9);
  });
});

describe('deck settings', () => {
  it('derives engine settings (TEMPO RESET → 0 %)', () => {
    const d = { ...initialDeck(), tempoPct: 3.337, range: 6 as const };
    expect(deckSettingsFromState(d).tempoPct).toBeCloseTo(3.34, 9);
    expect(deckSettingsFromState({ ...d, tempoReset: true }).tempoPct).toBe(0);
  });
  it('diffs only changed fields', () => {
    const a = deckSettingsFromState(initialDeck());
    const b = { ...a, slip: true };
    expect(diffSettings(a, b)).toEqual({ slip: true });
    expect(diffSettings(null, a)).toEqual(a);
  });
});
