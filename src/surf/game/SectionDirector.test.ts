import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { mulberry32 } from '../audio/synth';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { Scoring } from '../scoring/Scoring';
import { PeelController } from '../wave/PeelController';
import { WaveShape } from '../wave/WaveShape';
import { Coach, COACH_CONFIG } from './coach';
import { SectionDirector } from './SectionDirector';

const DT = 1 / 120;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function world(seed: number, sections: Partial<typeof SURF_CONFIG.sections> = {}, peak: Partial<typeof SURF_CONFIG.peak> = {}) {
  const cfg = structuredClone(SURF_CONFIG);
  Object.assign(cfg.sections, sections);
  Object.assign(cfg.peak, peak);
  const wave = new WaveShape(cfg.wave);
  const bus = new EventBus<SurfEvent>();
  const events: SurfEvent[] = [];
  bus.onAny((e) => events.push(e));
  const surfer = new Surfer(wave, cfg.physics, bus);
  const peel = new PeelController(cfg.wave, cfg.sections, cfg.peak);
  peel.reset(seed);
  const director = new SectionDirector(peel, wave, surfer, bus, cfg.peak);
  director.reset();
  return { cfg, wave, bus, events, surfer, s: surfer.state, peel, director };
}

type World = ReturnType<typeof world>;

/**
 * Rides the first fast section of the run: lineBot S-turns pumping every second until the section
 * starts, then `racing` decides the pumps (the carving goes on). Stops when the section ends or the
 * ride does. Returns the pitch event and the rider's frame x when the section began.
 */
function rideSection(w: World, racing: (dt: number, t: number) => boolean) {
  const bot = lineBot(w.surfer, w.wave, { pumpEvery: 1 });
  let started = false;
  let riderX0 = NaN;
  for (let i = 0; i < 40 * 120 && (w.s.mode === 'riding' || w.s.mode === 'airborne'); i++) {
    const input: SurferInput = { ...bot(DT) };
    if (w.peel.peak.phase !== 'none') input.pump = racing(DT, w.s.time);
    const n = w.events.length;
    w.director.step(input, DT);
    if (!started && w.events.slice(n).some((e) => e.type === 'fastSection')) {
      started = true;
      riderX0 = w.s.param.x;
    }
    if (started && w.peel.peak.phase === 'none') break;
  }
  const pitch = w.events.find((e) => e.type === 'peakPitch');
  return { pitch: pitch?.type === 'peakPitch' ? pitch : undefined, riderX0 };
}

/** Pumps every `every` s (from the start of the race). */
const every = (gap: number) => {
  let since = 0;
  return (dt: number) => {
    since += dt;
    if (since < gap) return false;
    since = 0;
    return true;
  };
};

describe('section peaks: the race (playtest 5)', () => {
  it.each(SEEDS)('seed %d: steady pumping (1 / s) on a good line makes it — on the peak at the pitch, rides the surge, SECTION MADE, the new barrel just behind', (seed) => {
    const w = world(seed);
    const { pitch } = rideSection(w, every(1));
    expect(pitch?.made).toBe(true);
    expect(w.events.some((e) => e.type === 'sectionMade')).toBe(true);
    expect(w.events.some((e) => e.type === 'wipeout')).toBe(false);
    expect(w.s.mode === 'riding' || w.s.mode === 'airborne').toBe(true);
    // The curl surged to the peak: the rider is just ahead of it now (the barrel right behind).
    expect(w.s.param.x).toBeGreaterThan(-w.cfg.wave.tubeDepth / 2);
    expect(w.s.param.x).toBeLessThan(12);
  });

  it.each(SEEDS)('seed %d: a human rhythm (pumps 0.8–1.2 s apart) makes it too', (seed) => {
    const w = world(seed);
    const rnd = mulberry32(seed * 31 + 7);
    let gap = 0.8 + 0.4 * rnd();
    let since = 0;
    const { pitch } = rideSection(w, (dt) => {
      since += dt;
      if (since < gap) return false;
      since = 0;
      gap = 0.8 + 0.4 * rnd();
      return true;
    });
    expect(pitch?.made).toBe(true);
    expect(w.events.some((e) => e.type === 'sectionMade')).toBe(true);
  });

  it.each(SEEDS)('seed %d: a rider who stops pumping when the peak forms is short of it at the pitch: CLOSED OUT, no SECTION MADE', (seed) => {
    const w = world(seed);
    const { pitch } = rideSection(w, () => false);
    expect(pitch?.made).toBe(false);
    expect(w.s.mode).toBe('wipeout');
    expect(w.s.wipeoutReason).toBe('closedOut');
    expect(w.events.some((e) => e.type === 'sectionMade')).toBe(false);
    // The closing section caught them during the surge (between the pitch and the curl reaching the peak).
    const wipe = w.events.find((e) => e.type === 'wipeout')!;
    expect(wipe.time).toBeGreaterThanOrEqual(pitch!.time);
    expect(wipe.time).toBeLessThanOrEqual(pitch!.time + w.peel.peak.surgeTime + DT);
  });

  it('the peak forms 15–25 m down the line from the rider and grows over 2–3 s; the race is 3.5–4.5 s', () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      const bot = lineBot(w.surfer, w.wave, { pumpEvery: 1 });
      let rider = NaN;
      for (let i = 0; i < 40 * 120 && w.peel.peak.phase === 'none'; i++) {
        rider = w.s.param.x;
        w.director.step(bot(DT), DT);
      }
      const pk = w.peel.peak;
      expect(pk.phase).toBe('rising');
      expect(pk.x0 - rider).toBeGreaterThanOrEqual(15 - 0.2);
      expect(pk.x0 - rider).toBeLessThanOrEqual(25 + 0.2);
      expect(pk.riseTime).toBeGreaterThanOrEqual(2);
      expect(pk.riseTime).toBeLessThanOrEqual(3);
      expect(pk.raceTime).toBeGreaterThanOrEqual(3.5);
      expect(pk.raceTime).toBeLessThanOrEqual(4.5);
      // The wave the surfer rides has it: taller at the peak than either side of it.
      expect(w.wave.peakBump(pk.x)).toBeGreaterThan(0);
    }
  });

  it('a rider short of the peak who is in the air at the pitch is closed out too (the closing section lands on them)', () => {
    const w = world(4);
    const bot = lineBot(w.surfer, w.wave, { pumpEvery: 1 });
    for (let i = 0; i < 40 * 120 && w.peel.peak.phase !== 'rising'; i++) w.director.step(bot(DT), DT);
    // Stop pumping, ollie just before the pitch.
    let ollied = false;
    for (let i = 0; i < 10 * 120 && w.s.mode !== 'wipeout'; i++) {
      const left = w.peel.peak.raceTime - w.peel.peak.age;
      const input: SurferInput = { ...bot(DT), pump: false, ollie: !ollied && left < 0.15 && w.s.mode === 'riding' };
      ollied ||= input.ollie;
      w.director.step(input, DT);
    }
    expect(ollied).toBe(true);
    expect(w.s.wipeoutReason).toBe('closedOut');
  });
});

describe('section peaks: the coach after the pitch', () => {
  it.each(SEEDS)('seed %d: no ▲ PUMP prompt right after SECTION MADE (the surge\'s frame jump is not ground lost, and the made rider gets a grace)', (seed) => {
    const w = world(seed);
    const coach = new Coach();
    coach.reset(true);
    w.bus.on('pump', (e) => coach.onPump(e.time));
    // As SurfGame wires it.
    w.bus.on('sectionMade', (e) => coach.hush(e.time, COACH_CONFIG.madeGrace));
    const bot = lineBot(w.surfer, w.wave, { pumpEvery: 1 });
    let madeAt = -1;
    let shownAfter = 0;
    for (let i = 0; i < 40 * 120 && (w.s.mode === 'riding' || w.s.mode === 'airborne'); i++) {
      const n = w.events.length;
      coach.shift(w.director.step(bot(DT), DT));
      coach.update(w.s, w.director.race);
      if (madeAt < 0 && w.events.slice(n).some((e) => e.type === 'sectionMade')) madeAt = w.s.time;
      if (madeAt >= 0 && w.s.time - madeAt <= 1 && coach.state.show) shownAfter++;
      if (madeAt >= 0 && w.s.time - madeAt > 1) break;
    }
    expect(madeAt).toBeGreaterThan(0);
    expect(shownAfter).toBe(0);
  });
});

describe('section peaks: airs off the peak', () => {
  /**
   * From (x, 0.35) climbing straight up the face at `speed` (held over the same column of the wave:
   * running down the line at the peel speed), until the first air lands. Returns the apex height.
   */
  function crestAir(w: World, x: number, speed: number, ollieAt = -1) {
    const s = w.s;
    w.surfer.reset(x, 0.35);
    const up = new Vector3().crossVectors(s.normal, new Vector3(1, 0, 0)).normalize();
    s.v.set(0, 0, 0).addScaledVector(up, speed);
    let apex = -Infinity;
    let wasAir = false;
    for (let i = 0; i < 4 * 120 && s.mode !== 'wipeout'; i++) {
      w.surfer.step({ ...NO_INPUT, ollie: i === ollieAt }, DT);
      if (s.mode === 'airborne') {
        wasAir = true;
        apex = Math.max(apex, s.p.y);
      } else if (wasAir) break;
    }
    return apex;
  }

  it.each([8, 10])('a crest air off the top of the peak at %d m/s goes ≥ 1 m higher than the same air off the plain wave', (speed) => {
    const plain = world(1);
    const normal = crestAir(plain, 25, speed);
    const peaked = world(1);
    peaked.wave.setPeak(25, SURF_CONFIG.peak.height, SURF_CONFIG.peak.width);
    const peak = crestAir(peaked, 25, speed);
    expect(peaked.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(normal + 1);
  });

  it('an ollie from high on the peak\'s face pops higher than the same ollie off the plain wave', () => {
    const plain = world(1);
    const normal = crestAir(plain, 25, 6, 25);
    const peaked = world(1);
    peaked.wave.setPeak(25, SURF_CONFIG.peak.height, SURF_CONFIG.peak.width);
    const peak = crestAir(peaked, 25, 6, 25);
    expect(peaked.events.find((e) => e.type === 'launched')).toMatchObject({ kind: 'ollie' });
    expect(peak).toBeGreaterThanOrEqual(normal + 0.5);
  });

  /**
   * The first section starts at 0.1 s (no gap), its peak up in 0.5 s and a 4.5 s race (room for two
   * airs); the rider is put on (or `offset` m from) the peak once it is up.
   */
  function onThePeak(seed: number, offset = 0) {
    const w = world(seed, { minGap: 0.1, maxGap: 0.1, minRace: 4.5, maxRace: 4.5 }, { minRise: 0.5, maxRise: 0.5 });
    for (let i = 0; i < 4 * 120 && w.peel.peak.age < 0.6; i++) w.director.step(NO_INPUT, DT);
    expect(w.peel.peak.phase).toBe('rising');
    return { w, x: w.peel.peak.x + offset };
  }

  /** Climbs the face from x at 10 m/s through the director (the peak keeps moving) until the air lands. */
  function airThroughDirector(w: World, x: number) {
    const s = w.s;
    // (reset rewinds the sim clock, which the section runs on: keep it.)
    const time = s.time;
    w.surfer.reset(x, 0.35);
    s.time = time;
    const up = new Vector3().crossVectors(s.normal, new Vector3(1, 0, 0)).normalize();
    s.v.set(0, 0, 0).addScaledVector(up, 10);
    let wasAir = false;
    for (let i = 0; i < 4 * 120 && s.mode !== 'wipeout'; i++) {
      w.director.step(NO_INPUT, DT);
      if (s.mode === 'airborne') wasAir = true;
      else if (wasAir) break;
    }
  }

  it('an air launched off the peak and landed scores SECTION AIR, once per peak; Scoring pays it', () => {
    const { w, x } = onThePeak(2);
    const scoring = new Scoring(SURF_CONFIG.scoring);
    scoring.attach(w.bus);
    airThroughDirector(w, x);
    expect(w.events.some((e) => e.type === 'landed')).toBe(true);
    expect(w.events.filter((e) => e.type === 'sectionAir')).toHaveLength(1);
    expect(scoring.pot).toBeGreaterThanOrEqual(750);
    // A second air off the same peak: no second SECTION AIR.
    expect(w.peel.peak.phase).toBe('rising');
    const landings = w.events.filter((e) => e.type === 'landed').length;
    airThroughDirector(w, w.peel.peak.x);
    expect(w.events.filter((e) => e.type === 'landed').length).toBe(landings + 1);
    expect(w.events.filter((e) => e.type === 'sectionAir')).toHaveLength(1);
  });

  it('an ollie from the trough in the peak\'s column gets neither the extra pop nor SECTION AIR (the ramp is the upper face)', () => {
    // Pop height of a tapped ollie from low on the face (t = 0.08), with and without a full peak there.
    const trough = (peak: boolean) => {
      const w = world(1);
      if (peak) w.wave.setPeak(25, SURF_CONFIG.peak.height, SURF_CONFIG.peak.width);
      w.surfer.reset(25, 0.08);
      w.s.v.set(9 - w.surfer.peelSpeed, 0, 0).addScaledVector(w.s.normal, -(9 - w.surfer.peelSpeed) * w.s.normal.x);
      w.surfer.step(NO_INPUT, DT);
      const y0 = w.s.p.y;
      w.surfer.step({ ...NO_INPUT, ollie: true }, DT);
      let apex = -Infinity;
      for (let i = 0; i < 240 && w.s.mode === 'airborne'; i++) {
        apex = Math.max(apex, w.s.p.y);
        w.surfer.step(NO_INPUT, DT);
      }
      return apex - y0;
    };
    expect(trough(true)).toBeCloseTo(trough(false), 2);
    // And through the director, on a standing peak: launched, landed, no SECTION AIR.
    const { w, x } = onThePeak(2);
    const time = w.s.time;
    w.surfer.reset(x, 0.08);
    w.s.time = time;
    w.director.step(NO_INPUT, DT);
    w.director.step({ ...NO_INPUT, ollie: true }, DT);
    for (let i = 0; i < 240 && w.s.mode === 'airborne'; i++) w.director.step(NO_INPUT, DT);
    expect(w.events.some((e) => e.type === 'launched' && e.kind === 'ollie')).toBe(true);
    expect(w.events.some((e) => e.type === 'landed')).toBe(true);
    expect(w.events.some((e) => e.type === 'sectionAir')).toBe(false);
  });

  it('an air off the wave beside the peak (beyond its upper half) is no SECTION AIR', () => {
    const { w, x } = onThePeak(2, -1.2 * SURF_CONFIG.peak.width);
    airThroughDirector(w, x);
    expect(w.events.some((e) => e.type === 'launched')).toBe(true);
    expect(w.events.some((e) => e.type === 'sectionAir')).toBe(false);
  });
});
