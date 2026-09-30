import { describe, expect, it } from 'vitest';
import { createTelemetry } from '../engine/telemetry';
import { initialDjData } from '../store/djStore';
import {
  GuideTracker,
  firstIncomplete,
  guideStep,
  phaseOffsetMs,
  readGuideInput,
  stepsComplete,
  type GuideDeckInput,
  type GuideInput,
} from './guideLogic';

const deck = (p: Partial<GuideDeckInput> = {}): GuideDeckInput => ({
  loaded: false,
  loading: false,
  browseOpen: false,
  playing: false,
  bpm: 0,
  sync: false,
  ...p,
});

const input = (p: Partial<GuideInput> = {}): GuideInput => ({
  decks: [deck(), deck()],
  ch: [
    { fader: 0, xf: 'THRU', cue: false },
    { fader: 0, xf: 'THRU', cue: false },
  ],
  crossfader: 0.5,
  xfCurve: 0,
  offsetMs: null,
  alignedSec: 0,
  beatmatched: false,
  ...p,
});

/** Deck 1 playing at 124, deck 2 loaded at `bpm2` (playing when `play2`). */
const twoDecks = (bpm2: number, play2 = false, p: Partial<GuideInput> = {}) =>
  input({ decks: [deck({ loaded: true, playing: true, bpm: 124 }), deck({ loaded: true, playing: play2, bpm: bpm2 })], ...p });

describe('stepsComplete / firstIncomplete', () => {
  it('starts at step 1 with nothing done', () => {
    expect(stepsComplete(input())).toEqual([false, false, false, false, false, false]);
    expect(firstIncomplete(stepsComplete(input()))).toBe(1);
  });

  it('1: deck 1 loaded (not while loading)', () => {
    expect(stepsComplete(input({ decks: [deck({ loaded: true }), deck()] }))[0]).toBe(true);
    expect(stepsComplete(input({ decks: [deck({ loaded: false, loading: true }), deck()] }))[0]).toBe(false);
  });

  it('2: deck 1 playing', () => {
    const c = stepsComplete(input({ decks: [deck({ loaded: true, playing: true, bpm: 124 }), deck()] }));
    expect(c.slice(0, 3)).toEqual([true, true, false]);
    expect(firstIncomplete(c)).toBe(3);
  });

  it('3: deck 2 loaded', () => {
    expect(stepsComplete(twoDecks(120))[2]).toBe(true);
  });

  it('4: BPMs within 0.1', () => {
    expect(stepsComplete(twoDecks(120))[3]).toBe(false);
    expect(stepsComplete(twoDecks(124.09))[3]).toBe(true);
    expect(stepsComplete(twoDecks(123.95))[3]).toBe(true);
    expect(stepsComplete(twoDecks(123.85))[3]).toBe(false);
  });

  it('5: the beatmatch latch', () => {
    expect(stepsComplete(twoDecks(124, true))[4]).toBe(false);
    expect(stepsComplete(twoDecks(124, true, { beatmatched: true }))[4]).toBe(true);
  });

  it('out of order: loading deck 2 first shows step 1 with step 3 already done', () => {
    const c = stepsComplete(input({ decks: [deck(), deck({ loaded: true, bpm: 120 })] }));
    expect(c[2]).toBe(true);
    expect(firstIncomplete(c)).toBe(1);
    expect(guideStep(input({ decks: [deck(), deck({ loaded: true, bpm: 120 })] })).step).toBe(1);
  });

  it('everything done → step 7 (finished)', () => {
    expect(firstIncomplete([true, true, true, true, true, true])).toBe(7);
  });
});

describe('step 6: fade in (XF assign honoured)', () => {
  const ready = (ch: GuideInput['ch'], crossfader = 0.5) => twoDecks(124, true, { beatmatched: true, ch, crossfader });
  const done = (i: GuideInput) => stepsComplete(i)[5];

  it('CH 2 up and CH 1 down (THRU) completes it', () => {
    expect(done(ready([{ fader: 0.9, xf: 'THRU', cue: false }, { fader: 0.8, xf: 'THRU', cue: false }]))).toBe(false);
    expect(done(ready([{ fader: 0, xf: 'THRU', cue: false }, { fader: 0.8, xf: 'THRU', cue: false }]))).toBe(true);
  });

  it('CH 2 must be at least 0.7', () => {
    expect(done(ready([{ fader: 0, xf: 'THRU', cue: false }, { fader: 0.6, xf: 'THRU', cue: false }]))).toBe(false);
  });

  it('crossfader at B with CH 1 on A cuts CH 1 even with its fader up', () => {
    const ch: GuideInput['ch'] = [
      { fader: 1, xf: 'A', cue: false },
      { fader: 1, xf: 'B', cue: false },
    ];
    expect(done(ready(ch, 0.5))).toBe(false);
    expect(done(ready(ch, 1))).toBe(true);
  });

  it('crossfader at B does nothing for a THRU channel', () => {
    const ch: GuideInput['ch'] = [
      { fader: 1, xf: 'THRU', cue: false },
      { fader: 1, xf: 'B', cue: false },
    ];
    expect(done(ready(ch, 1))).toBe(false);
  });

  it('CH 2 assigned to A is inaudible with the crossfader at B', () => {
    const ch: GuideInput['ch'] = [
      { fader: 0, xf: 'THRU', cue: false },
      { fader: 1, xf: 'A', cue: false },
    ];
    expect(done(ready(ch, 1))).toBe(false);
    expect(guideStep(ready(ch, 1), 6).hint).toMatch(/assigned to A/);
  });

  it('deck 2 must be playing', () => {
    const i = twoDecks(124, false, { beatmatched: true, ch: [{ fader: 0, xf: 'THRU', cue: false }, { fader: 1, xf: 'THRU', cue: false }] });
    expect(stepsComplete(i)[5]).toBe(false);
  });

  it('with THRU assigns the hint explains the assign buttons and targets them', () => {
    const v = guideStep(ready([{ fader: 1, xf: 'THRU', cue: false }, { fader: 1, xf: 'THRU', cue: false }]), 6);
    expect(v.hint).toMatch(/CH 1 → A/);
    expect(v.targets).toEqual(expect.arrayContaining(['xf-assign-0', 'xf-assign-1', 'fader-ch-0']));
    expect(v.panel).toBe(1);
  });

  it('with A/B assigns the hint says sweep the crossfader', () => {
    const v = guideStep(ready([{ fader: 1, xf: 'A', cue: false }, { fader: 1, xf: 'B', cue: false }], 0.2), 6);
    expect(v.hint).toMatch(/CROSSFADER/);
    expect(v.targets).toEqual(['crossfader']);
  });

  it('fader 2 down → raise it', () => {
    const v = guideStep(ready([{ fader: 1, xf: 'THRU', cue: false }, { fader: 0, xf: 'THRU', cue: false }]), 6);
    expect(v.targets).toEqual(['fader-ch-1']);
  });
});

describe('hints and targets', () => {
  it('1: BROWSE on deck 1, then pick a song', () => {
    const v = guideStep(input());
    expect(v).toMatchObject({ step: 1, done: false, targets: ['browse-0'], panel: 0 });
    expect(guideStep(input({ decks: [deck({ browseOpen: true }), deck()] })).hint).toMatch(/Tap a song/);
  });

  it('2: PLAY on deck 1, plus CH 1 fader while it is down', () => {
    const i = input({ decks: [deck({ loaded: true, bpm: 124 }), deck()] });
    expect(guideStep(i).targets).toEqual(['play-0', 'fader-ch-0']);
    const up = input({ decks: [deck({ loaded: true, bpm: 124 }), deck()], ch: [{ fader: 1, xf: 'THRU', cue: false }, { fader: 0, xf: 'THRU', cue: false }] });
    expect(guideStep(up).targets).toEqual(['play-0']);
  });

  it('3: BROWSE on deck 2 (deck 2 panel)', () => {
    const v = guideStep(input({ decks: [deck({ loaded: true, playing: true, bpm: 124 }), deck()] }));
    expect(v).toMatchObject({ step: 3, targets: ['browse-1'], panel: 2 });
  });

  it('4: shows both BPMs with one decimal and the slide direction', () => {
    const slower = guideStep(twoDecks(120));
    expect(slower.step).toBe(4);
    expect(slower.bpm).toEqual({ deck1: '124.0', deck2: '120.0', dir: 'down' });
    expect(slower.hint).toMatch(/DOWN/);
    expect(slower.targets).toEqual(['tempo-fader-1']);
    const faster = guideStep(twoDecks(128));
    expect(faster.bpm?.dir).toBe('up');
    expect(faster.hint).toMatch(/UP/);
    expect(guideStep(twoDecks(124.04), 4).bpm?.dir).toBe(null);
  });

  it('5: CUE on CH 2 and PLAY on deck 2 until deck 2 plays', () => {
    const v = guideStep(twoDecks(124));
    expect(v.step).toBe(5);
    expect(v.targets).toEqual(['chcue-1', 'play-1']);
    expect(v.panel).toBe(1);
    const cued = guideStep(twoDecks(124, false, { ch: [{ fader: 0, xf: 'THRU', cue: false }, { fader: 0, xf: 'THRU', cue: true }] }));
    expect(cued.targets).toEqual(['play-1']);
    expect(cued.panel).toBe(2);
  });

  it('5: offset meter sign — deck 2 ahead → nudge back, behind → nudge forward', () => {
    const ahead = guideStep(twoDecks(124, true, { offsetMs: 35 }));
    expect(ahead.offset).toEqual({ ms: 35, dir: 'back' });
    expect(ahead.hint).toMatch(/nudge BACK/);
    expect(ahead.targets).toEqual(['jog-1']);
    const behind = guideStep(twoDecks(124, true, { offsetMs: -35 }));
    expect(behind.offset).toEqual({ ms: -35, dir: 'forward' });
    expect(behind.hint).toMatch(/nudge FORWARD/);
    const locked = guideStep(twoDecks(124, true, { offsetMs: 8, alignedSec: 1.2 }));
    expect(locked.offset?.dir).toBe(null);
    expect(locked.hold).toBeCloseTo(0.6);
  });

  it('5: mentions SYNC as the shortcut', () => {
    expect(guideStep(twoDecks(124, true, { offsetMs: 35 })).hint).toMatch(/SYNC/);
  });

  it('7: finished card', () => {
    expect(guideStep(input(), 7)).toMatchObject({ step: 7, done: true, targets: [] });
  });
});

describe('phaseOffsetMs', () => {
  it('wraps to the nearest beat and signs deck 2 ahead as positive', () => {
    expect(phaseOffsetMs(10, 10.1, 120)).toBeCloseTo(50); // 0.1 beat at 500 ms/beat
    expect(phaseOffsetMs(10, 9.9, 120)).toBeCloseTo(-50);
    expect(phaseOffsetMs(10, 13.02, 120)).toBeCloseTo(10); // whole beats apart don't count
    expect(phaseOffsetMs(10.95, 11, 120)).toBeCloseTo(25);
  });
});

describe('GuideTracker', () => {
  const aligned = (offsetMs: number, sync = false) =>
    input({
      decks: [deck({ loaded: true, playing: true, bpm: 124 }), deck({ loaded: true, playing: true, bpm: 124, sync })],
      offsetMs,
    });

  it('beatmatch needs the offset ≤ 20 ms held for 2 s, then latches', () => {
    const t = new GuideTracker();
    expect(t.update(aligned(10), 0).step).toBe(5);
    expect(t.update(aligned(10), 1.9).step).toBe(5);
    expect(t.update(aligned(10), 2.05).step).toBe(6);
    expect(t.update(aligned(60), 3).step).toBe(6); // latched: drifting later does not undo it
  });

  it('losing alignment restarts the 2 s hold', () => {
    const t = new GuideTracker();
    t.update(aligned(10), 0);
    t.update(aligned(40), 1.5);
    expect(t.update(aligned(10), 2.1).step).toBe(5);
    expect(t.update(aligned(10), 4.2).step).toBe(6);
  });

  it('SYNC on deck 2 satisfies the beatmatch (after the hold)', () => {
    const t = new GuideTracker();
    t.update(aligned(90, true), 0);
    expect(t.update(aligned(90, true), 2.1).step).toBe(6);
  });

  it('tempo not matched never counts as aligned', () => {
    const t = new GuideTracker();
    const i = aligned(0);
    i.decks[1].bpm = 120;
    t.update(i, 0);
    expect(t.update(i, 5).step).toBe(4);
  });

  it('Skip / Back override the step; Back to a done step stays until NEXT', () => {
    const t = new GuideTracker();
    const i = input({ decks: [deck({ loaded: true, bpm: 124 }), deck()] });
    expect(t.update(i, 0).step).toBe(2);
    t.back();
    expect(t.update(i, 0.1).step).toBe(1); // step 1 is done but was chosen: no auto-advance
    t.skip();
    expect(t.update(i, 0.2).step).toBe(2);
    t.skip();
    expect(t.update(i, 0.3).step).toBe(3);
  });

  it('a skipped-to step advances when it gets done', () => {
    const t = new GuideTracker();
    t.update(input(), 0);
    t.skip();
    t.skip(); // step 3 while deck 1 is still empty
    expect(t.update(input(), 0.1).step).toBe(3);
    const loaded2 = input({ decks: [deck(), deck({ loaded: true, bpm: 120 })] });
    expect(t.update(loaded2, 0.2).step).toBe(4); // next incomplete after 3
  });

  it('finishing step 6 shows the finish card, which sticks', () => {
    const t = new GuideTracker();
    const fade = aligned(5);
    t.update(fade, 0);
    t.update(fade, 2.5);
    const faded = { ...fade, ch: [{ fader: 0, xf: 'THRU', cue: false }, { fader: 1, xf: 'THRU', cue: false }] as GuideInput['ch'] };
    const v = t.update(faded, 3);
    expect(v).toMatchObject({ step: 7, done: true });
    const paused = { ...faded, decks: [{ ...faded.decks[0], playing: false }, faded.decks[1]] as GuideInput['decks'] };
    expect(t.update(paused, 4).step).toBe(7);
    t.back();
    expect(t.update(paused, 5).step).toBe(6);
  });

  it('restart() returns to automatic navigation', () => {
    const t = new GuideTracker();
    t.update(input(), 0);
    t.skip();
    t.restart();
    expect(t.update(input(), 0.1).step).toBe(1);
  });
});

describe('readGuideInput', () => {
  it('derives loaded/BPM from the store and playing/offset from telemetry', () => {
    const s = initialDjData();
    s.decks[0] = { ...s.decks[0], trackId: 'a' };
    s.decks[1] = { ...s.decks[1], trackId: 'b', tempoFader: 0.333, tempoPct: 3.33 };
    const tel = createTelemetry(48000);
    for (const d of [0, 1] as const) {
      tel.decks[d].loaded = true;
      tel.decks[d].state = 'PLAYING';
      tel.decks[d].bpm = d === 0 ? 124 : 120;
    }
    tel.decks[0].beat = 10;
    tel.decks[1].beat = 10.1;
    const i = readGuideInput(s, tel, 0, (id) => (id === 'a' ? 124 : id === 'b' ? 120 : 0));
    expect(i.decks[0]).toMatchObject({ loaded: true, playing: true, bpm: 124 });
    expect(i.decks[1].bpm).toBeCloseTo(120 * 1.0335, 3); // 3.33 % quantized to the ±10 grid (0.05) = 3.35 %
    expect(i.offsetMs).toBeCloseTo((0.1 * 60000) / 124);
  });

  it('no offset unless both decks play', () => {
    const s = initialDjData();
    const i = readGuideInput(s, createTelemetry(), 0, () => 0);
    expect(i.offsetMs).toBe(null);
    expect(i.decks[0].loaded).toBe(false);
  });
});
