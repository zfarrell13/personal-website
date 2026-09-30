import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { Coach, COACH_CONFIG, type CoachFrame } from './coach';

const DT = 1 / 120;

/** A real surfer on the default wave with a coach fed every tick (as SurfGame does). */
function setup(guide = true) {
  const cfg = structuredClone(SURF_CONFIG);
  const wave = new WaveShape(cfg.wave);
  const bus = new EventBus<SurfEvent>();
  const surfer = new Surfer(wave, cfg.physics, bus);
  const coach = new Coach();
  coach.reset(guide);
  bus.on('pump', (e) => coach.onPump(e.time));
  const s = surfer.state;
  let shows = 0;
  let wasShown = false;
  /** First sim time the prompt showed, or -1. */
  let firstShow = -1;
  const step = (input: SurferInput) => {
    surfer.step(input, DT);
    coach.update(s);
    if (coach.state.show && !wasShown) {
      shows++;
      if (firstShow < 0) firstShow = s.time;
    }
    wasShown = coach.state.show;
  };
  const over = () => s.mode === 'wipeout' || s.mode === 'kickedOut';
  return { wave, surfer, s, coach, step, over, stats: () => ({ shows, firstShow }) };
}

/** A hand-fed frame (for the pure-logic cases). */
const frame = (time: number, x: number, extra: Partial<CoachFrame> = {}): CoachFrame => ({
  time,
  param: { x },
  mode: 'riding',
  stalling: false,
  inTube: false,
  ...extra,
});

/** Feeds x(t) at 120 Hz from t0 to t1; returns the show / hide transitions. */
function feed(coach: Coach, x: (t: number) => number, t0: number, t1: number, extra: (t: number) => Partial<CoachFrame> = () => ({})) {
  let transitions = 0;
  let was = coach.state.show;
  for (let t = t0; t < t1; t += DT) {
    coach.update(frame(t, x(t), extra(t)));
    if (coach.state.show !== was) transitions++;
    was = coach.state.show;
  }
  return transitions;
}

describe('Coach — pure logic', () => {
  it('no prompt while comfortably ahead, even while losing ground', () => {
    const coach = new Coach();
    coach.reset(true);
    // 20 m out and drifting back at 1 m/s for 10 s: never within reach of the curl.
    expect(feed(coach, (t) => 20 - t, 0, 10)).toBe(0);
    expect(coach.state.show).toBe(false);
  });

  it('no prompt while holding station near the curl (not losing ground)', () => {
    const coach = new Coach();
    coach.reset(true);
    expect(feed(coach, (t) => 3 + 0.05 * Math.sin(t * 6), 0, 10)).toBe(0);
  });

  it('shows when close to the curl and falling behind; hides once clearly gaining', () => {
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    expect(coach.state.show).toBe(true);
    // Pull ahead at 1 m/s from x = 4: hidden within about a second of gaining.
    feed(coach, (t) => 4 + (t - 2), 2, 3.3);
    expect(coach.state.show).toBe(false);
  });

  it('hides beyond the threshold + margin even while still drifting back', () => {
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    expect(coach.state.show).toBe(true);
    // Teleport-ish: a big air carried the rider well clear, now drifting slowly.
    feed(coach, (t) => COACH_CONFIG.hideX + 1 - 0.2 * (t - 2), 2, 2.5);
    expect(coach.state.show).toBe(false);
  });

  it('stays quiet while stalling or in the tube, and hides at once when a stall starts', () => {
    for (const quiet of [{ stalling: true }, { inTube: true }] as const) {
      const coach = new Coach();
      coach.reset(true);
      expect(feed(coach, (t) => 6 - t, 0, 4, () => quiet)).toBe(0);
    }
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    expect(coach.state.show).toBe(true);
    coach.update(frame(2 + DT, 4 - DT, { stalling: true }));
    expect(coach.state.show).toBe(false);
  });

  it('hides when airborne, wiped out or kicked out', () => {
    for (const mode of ['airborne', 'wipeout', 'kickedOut'] as const) {
      const coach = new Coach();
      coach.reset(true);
      feed(coach, (t) => 6 - t, 0, 2);
      expect(coach.state.show).toBe(true);
      coach.update(frame(2 + DT, 4, { mode }));
      expect(coach.state.show).toBe(false);
    }
  });

  it('cools down after hiding: no nagging straight back', () => {
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    coach.update(frame(2, 4, { stalling: true }));
    expect(coach.state.show).toBe(false);
    // Released the stall and still falling: stays quiet for the cooldown, then comes back.
    feed(coach, (t) => 4 - (t - 2), 2 + DT, 2 + COACH_CONFIG.cooldown * 0.9);
    expect(coach.state.show).toBe(false);
    feed(coach, (t) => 4 - (t - 2), 2 + COACH_CONFIG.cooldown * 0.9, 2 + COACH_CONFIG.cooldown + 0.5);
    expect(coach.state.show).toBe(true);
  });

  it('the beat runs at ~1 s from the show and restarts on each pump', () => {
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    expect(coach.state.show).toBe(true);
    const shownAt = 2 - coach.state.beatPhase * COACH_CONFIG.beat;
    feed(coach, (t) => 6 - t, 2, 2.5);
    expect(coach.state.beatPhase).toBeCloseTo(((2.5 - DT - shownAt) / COACH_CONFIG.beat) % 1, 1);
    const pumps = coach.state.pumps;
    coach.onPump(2.5);
    coach.update(frame(2.5, 3.5));
    expect(coach.state.pumps).toBe(pumps + 1);
    expect(coach.state.beatPhase).toBeCloseTo(0, 5);
    coach.update(frame(2.75, 3.25));
    expect(coach.state.beatPhase).toBeCloseTo(0.25 / COACH_CONFIG.beat, 5);
  });

  it('GUIDE off: never shows', () => {
    const coach = new Coach();
    coach.reset(false);
    expect(feed(coach, (t) => 6 - t, 0, 6)).toBe(0);
    expect(coach.state.show).toBe(false);
  });

  it('reset clears a showing prompt', () => {
    const coach = new Coach();
    coach.reset(true);
    feed(coach, (t) => 6 - t, 0, 2);
    expect(coach.state.show).toBe(true);
    coach.reset(true);
    expect(coach.state.show).toBe(false);
  });
});

describe('Coach — on a real ride', () => {
  it('no input: the prompt shows ≥ 1.5 s before the curl catches the rider, and only once', () => {
    const h = setup();
    while (!h.over() && h.s.time < 20) h.step(NO_INPUT);
    expect(h.s.wipeoutReason).toBe('swallowed');
    const { shows, firstShow } = h.stats();
    expect(firstShow).toBeGreaterThan(0);
    expect(h.s.time - firstShow).toBeGreaterThanOrEqual(1.5);
    expect(shows).toBe(1);
  });

  it('a down-the-line rider that never pumps gets the prompt ≥ 1.5 s before being caught', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    while (!h.over() && h.s.time < 30) h.step(bot(DT));
    expect(h.s.wipeoutReason).toBe('swallowed');
    const { shows, firstShow } = h.stats();
    expect(firstShow).toBeGreaterThan(0);
    expect(h.s.time - firstShow).toBeGreaterThanOrEqual(1.5);
    expect(shows).toBeLessThanOrEqual(2);
  });

  it('no prompt for a rider pumping in rhythm down the line (30 s)', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 1 });
    while (!h.over() && h.s.time < 30) h.step(bot(DT));
    expect(h.stats().shows).toBe(0);
  });

  it('disappears after pumping pulls the rider ahead', () => {
    const h = setup();
    while (!h.coach.state.show && h.s.time < 10) h.step(NO_INPUT);
    expect(h.coach.state.show).toBe(true);
    const pumpsAtShow = h.coach.state.pumps;
    // The player reacts: pumps quickly and trims a flat, fast line down the face (no tube detour).
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 0.4, low: 0.1, high: 0.3, slope: 0.05 });
    const reactedAt = h.s.time;
    const xAtShow = h.s.param.x;
    let lowest = xAtShow;
    while (h.coach.state.show && !h.over() && h.s.time < reactedAt + 5) {
      h.step(bot(DT));
      lowest = Math.min(lowest, h.s.param.x);
    }
    // Hidden because the rider is gaining ground — not because they fell off, went airborne or tubed.
    expect(h.coach.state.show).toBe(false);
    expect(h.s.mode).toBe('riding');
    expect(h.s.inTube).toBe(false);
    expect(h.s.param.x).toBeGreaterThan(lowest + COACH_CONFIG.gainMin);
    expect(h.coach.state.pumps).toBeGreaterThan(pumpsAtShow);
    // … and it stays gone while the rider keeps it up.
    const { shows } = h.stats();
    while (!h.over() && h.s.time < reactedAt + 15) h.step(bot(DT));
    expect(h.over()).toBe(false);
    expect(h.stats().shows).toBe(shows);
  });

  it('pumping without making ground (no carve) keeps the prompt up, steadily, until caught', () => {
    const h = setup();
    let last = -Infinity;
    while (!h.over() && h.s.time < 30) {
      const pump = h.coach.state.show && h.s.time - last >= 0.5;
      if (pump) last = h.s.time;
      h.step({ ...NO_INPUT, pump });
    }
    expect(h.s.wipeoutReason).toBe('swallowed');
    expect(h.stats().shows).toBe(1);
  });

  it('holding stall into the barrel: never prompts', () => {
    const h = setup();
    while (!h.over() && h.s.time < 20) h.step({ ...NO_INPUT, stall: true });
    expect(h.stats().shows).toBe(0);
  });

  it('no flicker: bounded show/hide transitions over mixed riding', () => {
    const h = setup();
    const pumping = lineBot(h.surfer, h.wave, { pumpEvery: 0.6 });
    const lazy = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    // Alternate 4 s lazy / 3 s pumping: the prompt comes and goes with the rider, never faster.
    while (!h.over() && h.s.time < 40) h.step(h.s.time % 7 < 4 ? lazy(DT) : pumping(DT));
    expect(h.stats().shows).toBeLessThanOrEqual(Math.ceil(h.s.time / 7) + 1);
  });

  it('GUIDE off: a no-input ride never shows the prompt', () => {
    const h = setup(false);
    while (!h.over() && h.s.time < 20) h.step(NO_INPUT);
    expect(h.stats().shows).toBe(0);
  });
});
