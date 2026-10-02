import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { faceYaw } from '../physics/faceYaw';
import { NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { Scoring, type TrickAward } from '../scoring/Scoring';
import { WaveShape } from '../wave/WaveShape';
import { PierDirector } from './PierDirector';
import { nearestPier, PIER, PIER_TRACK } from './track';

const DT = 1 / 120;

function world() {
  const wave = new WaveShape(SURF_CONFIG.wave);
  const bus = new EventBus<SurfEvent>();
  const events: SurfEvent[] = [];
  bus.onAny((e) => events.push(e));
  const surfer = new Surfer(wave, SURF_CONFIG.physics, bus);
  const awards: TrickAward[] = [];
  const scoring = new Scoring(SURF_CONFIG.scoring, { onAward: (a) => awards.push(a) });
  scoring.attach(bus);
  const pier = new PierDirector(surfer, bus);
  const w = {
    wave,
    bus,
    events,
    surfer,
    s: surfer.state,
    scoring,
    awards,
    pier,
    travel: 0,
    /** Peel speed (m/s): the frame — and the pier through it — moves at it. */
    vp: SURF_CONFIG.wave.peelSpeed,
    /** Extra scenery travel per tick (m) the rider's frame motion doesn't follow: an artificially fast pier. */
    shift: 0,
    /** Put the first set's pier `ahead` m down the line from the rider (the scenery's travel). */
    placePier(ahead: number) {
      w.travel = PIER_TRACK.sets[0]! - (w.s.p.x + ahead);
      pier.reset(w.travel);
    },
    step(input: SurferInput) {
      surfer.setPeelSpeed(w.vp);
      surfer.step(input, DT);
      const t0 = w.travel;
      w.travel += w.vp * DT + w.shift;
      pier.step(t0, w.travel);
    },
    live: () => w.s.mode === 'riding' || w.s.mode === 'airborne',
    shots: () => w.events.filter((e): e is Extract<SurfEvent, { type: 'shotThePier' }> => e.type === 'shotThePier'),
  };
  return w;
}
type World = ReturnType<typeof world>;

/**
 * Test support: holds the board on a line at frame z ≈ `zLane` (carving toward it, letting go once the
 * line points there) and pumps every `pumpEvery` s — a player picking a lane through the pier.
 */
function laneBot(w: World, zLane: number, pumpEvery = 0.8) {
  const input: SurferInput = { ...NO_INPUT };
  let held = 0;
  let gap = false;
  let since = 0;
  return () => {
    const s = w.s;
    const yaw = faceYaw(w.wave, s.param, s.heading);
    // Up the face is −z: above the lane (z too big) climb, below it drop.
    const want = Math.max(-0.45, Math.min(0.45, 0.6 * (s.p.z - zLane)));
    const err = want - yaw;
    const rot = Math.abs(err) > 0.06 ? Math.sign(err) : 0;
    if (gap) {
      gap = false;
      held = 0;
    } else if (rot !== held) {
      // A turn the other way needs a fresh press.
      if (held !== 0 && rot !== 0) {
        held = 0;
        gap = true;
      } else held = rot;
    }
    since += DT;
    input.pump = since >= pumpEvery;
    if (input.pump) since = 0;
    input.carve = held;
    return input;
  };
}

/** Rides the lineBot for `sec` s (speed, ahead of the curl), then settles into the lane for 2 s. */
function setUp(w: World, zLane: number) {
  const bot = lineBot(w.surfer, w.wave, { pumpEvery: 1 });
  w.placePier(1e4); // nowhere near while settling (no pass)
  for (let i = 0; i < 6 * 120; i++) w.step({ ...bot(DT) });
  const lane = laneBot(w, zLane);
  for (let i = 0; i < 2 * 120; i++) w.step({ ...lane() });
  expect(w.live()).toBe(true);
  return lane;
}

/** Brings the pier from `ahead` m down the line past the rider, riding `drive` until it is well behind or the ride ends. */
function pass(w: World, ahead: number, drive: () => SurferInput) {
  w.placePier(ahead);
  for (let i = 0; i < 8 * 120 && w.live() && w.pier.ahead > -10; i++) w.step({ ...drive() });
}

describe('shooting the pier', () => {
  it('scores SHOT THE PIER exactly once (+1000) through each lane: high on the face and low', () => {
    for (const zLane of [0.3, 1.2, 2.8, 6]) {
      const w = world();
      const lane = setUp(w, zLane);
      const z0 = w.s.p.z;
      pass(w, 20, lane);
      expect(w.live(), `lane ${zLane} (z ${z0.toFixed(2)})`).toBe(true);
      expect(w.shots()).toHaveLength(1);
      expect(w.shots()[0]!.inTube).toBe(false);
      expect(w.awards.filter((a) => a.name === 'SHOT THE PIER')).toEqual([{ name: 'SHOT THE PIER', points: 1000, repeated: false }]);
      // Riding on: no second award for the same pier.
      for (let i = 0; i < 3 * 120 && w.live(); i++) w.step({ ...lane() });
      expect(w.shots()).toHaveLength(1);
    }
  });

  it('bottoming out into the middle row of pilings is a wipeout, PIER\'D, with no award', () => {
    for (const zLane of [PIER.rowZ - 0.3, PIER.rowZ, PIER.rowZ + 0.4]) {
      const w = world();
      const lane = setUp(w, zLane);
      pass(w, 20, lane);
      expect(w.s.mode).toBe('wipeout');
      expect(w.s.wipeoutReason).toBe('pierd');
      expect(w.events.filter((e) => e.type === 'wipeout')).toHaveLength(1);
      expect(w.shots()).toHaveLength(0);
      expect(w.awards.some((a) => a.name.startsWith('SHOT THE PIER'))).toBe(false);
      // It hit at the pier, not somewhere down the line.
      expect(Math.abs(w.s.p.x - w.pier.x)).toBeLessThan(PIER.width / 2 + 1.5);
    }
  });

  it('in the barrel under the pier scores SHOT THE PIER IN THE BARREL ×2 (+2000) — up in it, or slid low in it', () => {
    let since = 0;
    const holdIn = (): SurferInput => {
      since += DT;
      const pump = since >= 0.5;
      if (pump) since = 0;
      return { ...NO_INPUT, pump };
    };
    for (const low of [false, true]) {
      const w = world();
      w.placePier(1e4);
      // Stall into the barrel (up in it, z ≈ 1.4) …
      for (let i = 0; i < 6 * 120 && !w.s.inTube; i++) w.step({ ...NO_INPUT, stall: true });
      if (low) {
        // … or stall on a little, then pump: the board slides down its line in the barrel, low near the
        // curl (z ≈ 2.4, y ≈ 0.5 — where a browser run met the pier).
        for (let i = 0; i < 0.5 * 120; i++) w.step({ ...NO_INPUT, stall: true });
        for (let i = 0; i < 4 * 120 && w.s.inTube && w.s.p.z < 2.35; i++) w.step(holdIn());
      }
      expect(w.s.inTube).toBe(true);
      const z = w.s.p.z;
      if (low) expect(z).toBeGreaterThan(2.3);
      pass(w, low ? 1.5 : 5, holdIn);
      expect(w.s.wipeoutReason, `z ${z.toFixed(2)}`).not.toBe('pierd');
      expect(w.shots()).toHaveLength(1);
      expect(w.shots()[0]!.inTube).toBe(true);
      expect(w.awards.filter((a) => a.name.startsWith('SHOT THE PIER'))).toEqual([{ name: 'SHOT THE PIER IN THE BARREL ×2', points: 2000, repeated: false }]);
    }
  });

  it('sweeps the rider through the pier: a pier jumping 1 m a tick past them can\'t tunnel through', () => {
    // (A surge moves the frame past the rider up to ≈ 0.4 m a tick, but it moves the rider's frame x with
    // it: rider and pier only ever move apart at the rider's world speed. The sweep holds regardless.)
    for (const [zLane, hit] of [[PIER.rowZ, true], [PIER.rowZ + 0.5, true], [0.6, false], [5, false]] as const) {
      const w = world();
      const lane = setUp(w, zLane);
      w.shift = 1;
      pass(w, 30, lane);
      expect(w.s.wipeoutReason === 'pierd', `lane ${zLane}`).toBe(hit);
      expect(w.shots()).toHaveLength(hit ? 0 : 1);
    }
  });

  it('tests the whole path of a step, not its ends: a step from clear to clear through a bent hits', () => {
    for (const swept of [true, false]) {
      const w = world();
      // Pier centre line at frame x = 0 this step (no travel during it).
      w.travel = PIER_TRACK.sets[0]!;
      w.pier.reset(w.travel);
      w.surfer.prevP.set(-4.5, 1, PIER.rowZ - (swept ? 1.5 : 3));
      w.s.p.set(4.5, 1, PIER.rowZ + (swept ? 1.5 : -3));
      w.s.heading.set(1, 0, 0);
      w.pier.step(w.travel, w.travel);
      expect(w.s.wipeoutReason).toBe(swept ? 'pierd' : null);
    }
  });

  it('no award once wiped out by something else before the pier', () => {
    const w = world();
    w.placePier(1e4);
    // No input: swallowed by the barrel in ≈ 4.6 s; the pier arrives later.
    w.placePier(60);
    for (let i = 0; i < 12 * 120; i++) w.step({ ...NO_INPUT });
    expect(w.s.mode).toBe('wipeout');
    expect(w.s.wipeoutReason).toBe('swallowed');
    expect(w.shots()).toHaveLength(0);
  });

  it('reports the nearest pier\'s frame x and how far it is ahead of the rider', () => {
    const w = world();
    w.placePier(35);
    expect(w.pier.x).toBeCloseTo(w.s.p.x + 35, 6);
    expect(w.pier.ahead).toBeCloseTo(35, 6);
    w.step({ ...NO_INPUT });
    expect(w.pier.x).toBeCloseTo(nearestPier(w.travel, w.s.p.x).x, 9);
  });
});
