import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { bumpConfig, SURF_CONFIG } from '../config';
import { DEG, wrapAngle } from '../math/scalar';
import { mulberry32 } from '../audio/synth';
import { WaveShape } from '../wave/WaveShape';
import { EventBus, type SurfEvent } from './events';
import { NO_INPUT, type SurferInput } from './input';
import { faceYaw } from './faceYaw';
import { lineBot } from './lineBot';
import { Surfer } from './Surfer';

const DT = 1 / 120;

function setup(physics: Partial<typeof SURF_CONFIG.physics> = {}) {
  const cfg = structuredClone(SURF_CONFIG);
  Object.assign(cfg.physics, physics);
  const wave = new WaveShape(cfg.wave);
  const bus = new EventBus<SurfEvent>();
  const events: SurfEvent[] = [];
  bus.onAny((e) => events.push(e));
  const surfer = new Surfer(wave, cfg.physics, bus);
  const run = (seconds: number, input: (tick: number) => Partial<SurferInput> = () => ({})) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) surfer.step({ ...NO_INPUT, ...input(i) }, DT);
  };
  return { cfg, wave, bus, events, surfer, s: surfer.state, run };
}

/** Steps `bot` for up to `seconds` (stopping on a wipeout / kick-out); returns each climb's peak heading.y after 2 s. */
function climbPeaks(h: ReturnType<typeof setup>, bot: (dt: number) => SurferInput, seconds: number): number[] {
  const peaks: number[] = [];
  let peak = 0;
  for (let i = 0; i < seconds * 120; i++) {
    h.surfer.step(bot(DT), DT);
    if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    if (h.s.mode !== 'riding') continue;
    const hy = h.s.heading.y;
    if (hy > 0) peak = Math.max(peak, hy);
    else if (peak > 0) {
      if (h.s.time > 2) peaks.push(peak);
      peak = 0;
    }
  }
  return peaks;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? NaN;
}

describe('Surfer — riding', () => {
  it('no input: stays on the surface and the curl swallows the rider after 4–6 s (never under 2 s)', () => {
    const { wave, s, surfer } = setup();
    const onSurface = new Vector3();
    let worst = 0;
    let caught = -1;
    for (let i = 0; i < 20 * 120 && caught < 0; i++) {
      surfer.step(NO_INPUT, DT);
      if (s.mode !== 'riding') caught = s.time;
      else worst = Math.max(worst, wave.profile(s.param.x, s.param.t, onSurface).distanceTo(s.p));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(s.wipeoutReason).toBe('swallowed');
    expect(caught).toBeGreaterThanOrEqual(4);
    expect(caught).toBeLessThanOrEqual(6);
  });

  it('rhythmic pumping (1/s) plus down-the-line S-turns stays ahead of the curl for 30 s at base peel', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 1 });
    let minX = Infinity;
    for (let i = 0; i < 30 * 120; i++) {
      h.surfer.step(bot(DT), DT);
      if (h.s.time > 2) minX = Math.min(minX, h.s.param.x);
    }
    expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
    expect(minX).toBeGreaterThan(-h.cfg.wave.tubeDepth);
  });

  it('the same lines without pumping lose the wave within 10 s', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    h.run(10, () => bot(DT));
    expect(h.s.mode).toBe('wipeout');
    expect(h.s.wipeoutReason).toBe('swallowed');
  });

  it('drops turn height into speed: with no drag or drive, world energy along a fall-line drop is conserved', () => {
    const h = setup({ drag: 0, drive: 0 });
    h.surfer.reset(15, 0.5);
    const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(-h.surfer.peelSpeed, 0, 0).addScaledVector(up, -6); // world velocity: 6 m/s straight down the fall line
    h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
    const energy = () => 0.5 * h.surfer.worldSpeed(h.surfer.peelSpeed) ** 2 + h.cfg.physics.gravity * h.s.p.y;
    const e0 = energy();
    const y0 = h.s.p.y;
    h.run(0.4);
    expect(y0 - h.s.p.y).toBeGreaterThan(0.5); // a real drop
    expect(Math.abs(energy() - e0)).toBeLessThan(0.2);
  });

  it.each([
    [0.3, 1],
    [0.5, 0.6],
  ])('a line climbing at slope %d with a pump every %d s stays ahead of the curl for 30 s', (slope, pumpEvery) => {
    for (const [low, high] of [[0.35, 0.6], [0.2, 0.7]]) {
      const h = setup();
      const bot = lineBot(h.surfer, h.wave, { pumpEvery, slope, low, high });
      const peaks = climbPeaks(h, bot, 30);
      expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
      expect(h.s.time).toBeGreaterThan(29.9);
      // The bot really rides its line (it is not cut short by turning early).
      if (slope === 0.5) expect(median(peaks)).toBeGreaterThanOrEqual(0.45);
    }
  });

  /** Rides `bot` for `seconds` (stopping on a wipeout / kick-out); frame x at the start, at 20 s and at the end. */
  function ride(h: ReturnType<typeof setup>, bot: (dt: number) => SurferInput, seconds: number) {
    const x0 = h.s.param.x;
    let x20 = NaN;
    while (h.s.time < seconds && h.s.mode !== 'wipeout' && h.s.mode !== 'kickedOut') {
      h.surfer.step(bot(DT), DT);
      if (Number.isNaN(x20) && h.s.time >= 20) x20 = h.s.param.x;
    }
    const alive = h.s.mode === 'riding' || h.s.mode === 'airborne';
    return { alive, x0, x20, x: h.s.param.x };
  }

  // Pumping is the primary speed tool (playtest 2): pumping on a sensible line beats the section.
  it.each([0.5, 0.6, 0.7])('pumping every %d s on a moderate line (slope 0.3) gains ≥ 10 m on the curl over 20 s', (pumpEvery) => {
    const h = setup();
    const r = ride(h, lineBot(h.surfer, h.wave, { pumpEvery, slope: 0.3 }), 20.5);
    expect(r.alive).toBe(true);
    expect(r.x20 - r.x0).toBeGreaterThanOrEqual(10);
  });

  /**
   * A human: the lineBot's carving, but pumping at irregular gaps drawn from [0.8, 1.2] s (seeded).
   * Returns the median over seeds 1–8 of the frame-x gain over 20 s (a wipeout counts as −∞).
   */
  function humanGain(slope: number, startX?: number) {
    const gains = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      const h = setup();
      if (startX !== undefined) h.surfer.reset(startX, 0.5);
      const rnd = mulberry32(seed);
      const carve = lineBot(h.surfer, h.wave, { pumpEvery: 0, slope });
      let gap = 0.8 + 0.4 * rnd();
      let since = 0;
      const r = ride(h, (dt) => {
        const input = carve(dt);
        since += dt;
        input.pump = since >= gap;
        if (input.pump) {
          since = 0;
          gap = 0.8 + 0.4 * rnd();
        }
        return input;
      }, 20.5);
      return r.alive ? r.x20 - r.x0 : -Infinity;
    });
    return median(gains);
  }

  // Playtest 2: a human pumping about once a second while carving a moderate line beats the section.
  it.each([0.2, 0.3])('a human pumping every 0.8–1.2 s (irregular) on a slope %d line gains ≥ 10 m on the curl in 20 s (median of 8 seeds)', (slope) => {
    expect(humanGain(slope)).toBeGreaterThanOrEqual(10);
  });

  it.each([0.2, 0.3])('… and started further down the line (x = 25) on a slope %d line, loses no ground over 20 s (median of 8 seeds)', (slope) => {
    expect(humanGain(slope, 25)).toBeGreaterThanOrEqual(0);
  });

  it('pumping every 0.6 s on a straight-ish line (slope 0.15) at least holds its ground for 30 s', () => {
    const h = setup();
    const r = ride(h, lineBot(h.surfer, h.wave, { pumpEvery: 0.6, slope: 0.15 }), 30);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThanOrEqual(r.x0);
  });

  /**
   * Lines + pumps (every `pumpEvery` s) with one fast section of the given boost / hold from t = 8 s
   * (the configured ramps), riding on to 20 s. `lost` = frame-x ground lost over the section. (The
   * boost alone: the section peak's pitch and surge are SectionDirector's, tested there.)
   */
  function fastSection(pumpEvery: number, boost: number, hold: number, startX?: number, at = 8) {
    const h = setup();
    if (startX !== undefined) h.surfer.reset(startX, 0.5);
    const bot = lineBot(h.surfer, h.wave, { pumpEvery });
    const base = h.cfg.wave.peelSpeed;
    const { ramp } = h.cfg.sections;
    const total = 2 * ramp + hold;
    let xStart = NaN;
    let xEnd = NaN;
    for (let i = 0; i < 20 * 120; i++) {
      const u = h.s.time + DT - at;
      const k = u < 0 || u > total ? 0 : Math.min(1, u / ramp, (total - u) / ramp);
      if (u >= 0 && Number.isNaN(xStart)) xStart = h.s.param.x;
      if (u >= total && Number.isNaN(xEnd)) xEnd = h.s.param.x;
      h.surfer.setPeelSpeed(base * (1 + boost * k));
      h.surfer.step(bot(DT), DT);
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    const survived = h.s.mode === 'riding' || h.s.mode === 'airborne';
    return { survived, lost: survived ? xStart - xEnd : Infinity, h };
  }

  // Racy sections must be felt (Task 2b carry: +30%/3 s cost a 1 s pumper only 1.2 m).
  it('the mildest fast section: the base effort (pump 1 s) loses ≥ 6 m; pumping every 0.6 s survives it and loses ≥ 3 m less', () => {
    const { minBoost, minRace, ramp } = SURF_CONFIG.sections;
    const base = fastSection(1, minBoost, minRace - ramp);
    const hard = fastSection(0.6, minBoost, minRace - ramp);
    expect(base.survived).toBe(true);
    expect(base.lost).toBeGreaterThanOrEqual(6);
    expect(hard.survived).toBe(true);
    expect(hard.lost).toBeLessThan(base.lost - 3);
  });

  // Playtest 5: the boost now holds from the ramp to the peak's pitch (the race, 3.5–4.5 s; it was 4–5 s
  // of hold), so the hardest one costs ≈ 9.8 m (was ≥ 10 m over the longer hold).
  it('the hardest fast section: the base effort loses ≥ 9 m but survives; pumping every 0.6 s survives it and loses ≥ 3 m less', () => {
    const { maxBoost, maxRace, ramp } = SURF_CONFIG.sections;
    const base = fastSection(1, maxBoost, maxRace - ramp);
    const hard = fastSection(0.6, maxBoost, maxRace - ramp);
    expect(base.survived).toBe(true);
    expect(base.lost).toBeGreaterThanOrEqual(9);
    expect(hard.survived).toBe(true);
    expect(hard.lost).toBeLessThan(base.lost - 3);
  });

  // SECTION MADE is not free: a lazy rider who holds their ground at base peel gets caught by a hard section.
  it('a lazy rider (pump every 2 s) holds 20 s at base peel but the hardest fast section swallows them', () => {
    const { maxBoost, maxRace, ramp } = SURF_CONFIG.sections;
    expect(fastSection(2, 0, maxRace - ramp).survived).toBe(true);
    expect(fastSection(2, maxBoost, maxRace - ramp).survived).toBe(false);
  });

  // Regression: the section's frame shift must not read as "the wave left you" far down the line.
  it('a strong rider (pump every 0.6 s) far down the line (x = 75) rides the hardest section out: no kick-out, SECTION MADE', () => {
    const { maxBoost, maxRace, ramp } = SURF_CONFIG.sections;
    const r = fastSection(0.6, maxBoost, maxRace - ramp, 75, 1);
    expect(r.h.events.some((e) => e.type === 'kickedOut')).toBe(false);
    expect(r.survived).toBe(true);
    expect(r.h.s.time).toBeGreaterThan(19.9);
  });

  it('stalling drives frame x-velocity negative and puts you in the tube within 3 s', () => {
    const { s, run, events } = setup();
    run(1); // let the drop-in settle
    let sawNegative = false;
    let tubeAt = -1;
    for (let i = 0; i < 3 * 120 && tubeAt < 0; i++) {
      run(DT, () => ({ stall: true }));
      if (s.v.x < 0) sawNegative = true;
      if (s.inTube) tubeAt = i * DT;
    }
    expect(sawNegative).toBe(true);
    expect(tubeAt).toBeGreaterThanOrEqual(0);
    expect(events.some((e) => e.type === 'tubeEnter')).toBe(true);
  });

  // [start: 'drop-in' or reset(x, t) mid-face]. Stalling sets the rail: the rider waits on the face,
  // the curl overtakes them and they end up genuinely under the lip (seaward of its tip) for ≥ 1 s.
  it.each([['drop-in'], [2], [4], [6], [10]] as const)('holding the stall from %s: waits on the face and gets barrelled under the lip (≥ 1 s)', (start) => {
    const h = setup();
    if (start === 'drop-in') h.surfer.reset();
    else h.surfer.reset(start, 0.45);
    const tip = new Vector3();
    let run = 0;
    let longest = 0;
    let minT = Infinity;
    let exposed = 0;
    for (let i = 0; i < 12 * 120; i++) {
      h.surfer.step({ ...NO_INPUT, stall: true }, DT);
      if (h.s.mode !== 'riding') break;
      minT = Math.min(minT, h.s.param.t);
      run = h.s.inTube ? run + DT : 0;
      longest = Math.max(longest, run);
      if (h.s.inTube && h.s.p.z >= h.wave.profile(h.s.param.x, 1, tip).z) exposed++;
    }
    expect(minT).toBeGreaterThan(0.2); // held on the face, never slid down to the trough
    expect(longest).toBeGreaterThanOrEqual(1);
    expect(exposed).toBe(0); // every tube tick is seaward of the lip tip
    expect(h.s.wipeoutReason).toBe('swallowed');
  });

  it('the tube only counts under the lip: stalling on the flats in front of the lip is not a barrel', () => {
    const h = setup();
    h.surfer.reset(4, 0.1);
    const tip = new Vector3();
    for (let i = 0; i < 12 * 120 && h.s.mode === 'riding'; i++) {
      h.surfer.step({ ...NO_INPUT, stall: true }, DT);
      if (h.s.inTube) expect(h.s.p.z).toBeLessThan(h.wave.profile(h.s.param.x, 1, tip).z - h.cfg.physics.tubeUnderLip + 1e-9);
    }
  });

  it('stall into the barrel from mid-face, then release early and pump down the line: out of the tube and still riding', () => {
    const h = setup();
    h.surfer.reset(6, 0.45);
    const pumpOut = lineBot(h.surfer, h.wave, { pumpEvery: 0.6 });
    let tube = 0;
    for (let i = 0; i < 15 * 120; i++) {
      h.surfer.step(tube < 0.3 ? { ...NO_INPUT, stall: true } : pumpOut(DT), DT);
      if (h.s.inTube) tube += DT;
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    const exit = h.events.find((e) => e.type === 'tubeExit');
    expect(exit && exit.type === 'tubeExit' && exit.duration).toBeGreaterThanOrEqual(1);
    expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
  });

  it('holding the stall longer gets you swallowed', () => {
    const { s, run, events } = setup();
    run(1);
    run(12, () => ({ stall: true }));
    expect(s.mode).toBe('wipeout');
    expect(s.wipeoutReason).toBe('swallowed');
    expect(events.at(-1)).toMatchObject({ type: 'wipeout', reason: 'swallowed' });
  });

  it('stall while carving into the pocket, release as the curl arrives and pump out: a ≥ 1 s barrel, then out and still riding', () => {
    const h = setup();
    const warmUp = lineBot(h.surfer, h.wave, { pumpEvery: 1 });
    const stallLine = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    const pumpOut = lineBot(h.surfer, h.wave, { pumpEvery: 0.6 });
    let released = false;
    let tube = 0;
    for (let i = 0; i < 16 * 120; i++) {
      if (h.s.time >= 6 && h.s.param.x <= 3) released = true;
      const input = h.s.time < 6 ? warmUp(DT) : released ? pumpOut(DT) : { ...stallLine(DT), stall: true };
      h.surfer.step(input, DT);
      if (h.s.inTube) tube += DT;
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    expect(tube).toBeGreaterThanOrEqual(1);
    expect(h.events.some((e) => e.type === 'tubeExit')).toBe(true);
    expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
  });

  it('pump spam yields less speed than rhythmic pumping (same lines)', () => {
    const meanSpeed = (pumpEvery: number) => {
      const h = setup();
      const bot = lineBot(h.surfer, h.wave, { pumpEvery });
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 8 * 120; i++) {
        h.surfer.step(bot(DT), DT);
        if (h.s.time > 2) {
          sum += h.surfer.worldSpeed(h.surfer.peelSpeed);
          n++;
        }
      }
      return sum / n;
    };
    expect(meanSpeed(0.6)).toBeGreaterThan(meanSpeed(0.1) + 1);
  });

  /** World-speed gain of one pump (vs a no-pump control) at (15, t), riding at `speed`, `since` s after the last pump. */
  function pumpKick(speed: number, t: number, since = 10) {
    const pumped = trimming(speed, 15, t);
    const control = trimming(speed, 15, t);
    pumped.s.sincePump = since;
    pumped.surfer.step({ ...NO_INPUT, pump: true }, DT);
    control.surfer.step(NO_INPUT, DT);
    return pumped.surfer.worldSpeed(pumped.surfer.peelSpeed) - control.surfer.worldSpeed(control.surfer.peelSpeed);
  }

  it('a pump mid-face at riding speed is a clear kick: +1.5–3 m/s', () => {
    for (const speed of [8, 10, 12]) {
      expect(pumpKick(speed, 0.4)).toBeGreaterThanOrEqual(1.5);
      expect(pumpKick(speed, 0.4)).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('pumps spammed faster than ~0.35 s have diminishing returns (less speed per second than a 0.6 s rhythm)', () => {
    const perSecond = (since: number) => pumpKick(10, 0.4, since) / since;
    expect(perSecond(0.2)).toBeLessThan(0.8 * perSecond(0.6));
    expect(perSecond(0.1)).toBeLessThan(0.5 * perSecond(0.6));
  });

  it('a pump low on the face or in the flats is weaker than mid-face, but never nothing', () => {
    const mid = pumpKick(10, 0.4);
    for (const t of [0, 0.1, 0.2]) {
      expect(pumpKick(10, t)).toBeGreaterThanOrEqual(0.5);
      expect(pumpKick(10, t)).toBeLessThan(mid - 0.3);
    }
  });

  it('a pump in the air does nothing', () => {
    const air = () => {
      const h = setup();
      h.surfer.reset(10, 0.3);
      const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
      h.s.v.set(-h.surfer.peelSpeed, 0, 0).addScaledVector(up, 12);
      h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
      for (let i = 0; i < 3 * 120 && h.s.mode === 'riding'; i++) h.run(DT);
      return h;
    };
    const pumped = air();
    const control = air();
    expect(pumped.s.mode).toBe('airborne');
    pumped.run(0.3, (i) => ({ pump: i % 12 === 0 }));
    control.run(0.3);
    expect(pumped.s.v.distanceTo(control.s.v)).toBeLessThan(1e-9);
    expect(pumped.events.some((e) => e.type === 'pump')).toBe(false);
  });

  /** Mid-face at (15, 0.4), running down the line at world speed `speed`. */
  function trimming(speed: number, x = 15, t = 0.4) {
    const h = setup();
    h.surfer.reset(x, t);
    h.s.v.set(speed - h.surfer.peelSpeed, 0, 0).addScaledVector(h.s.normal, -(speed - h.surfer.peelSpeed) * h.s.normal.x);
    return h;
  }

  it('carving toward the lip climbs the face (vs a no-carve control from the identical state)', () => {
    const climb = (carve: number) => {
      const h = trimming(10);
      const y0 = h.s.p.y;
      h.run(0.4, () => ({ carve }));
      return h.s.p.y - y0;
    };
    const straight = climb(0);
    expect(climb(1)).toBeGreaterThan(straight + 0.1);
    expect(climb(-1)).toBeLessThan(straight - 0.1);
  });

  // Playtest 6: a held carve keeps turning round (over the top), and letting go stops the turn — so the
  // rider aims the climb: carve up until the line points up the face (75° in the face), then let go.
  it.each([8, 15, 25])('from speed, trough → top of the face (85% of the crest) in ≤ 1.5 s (x = %d)', (x) => {
    const h = trimming(10, x, 0.2);
    let top = -1;
    let aimed = false;
    for (let i = 0; i < 3 * 120 && top < 0; i++) {
      aimed ||= faceYaw(h.wave, h.s.param, h.s.heading) >= 75 * DEG;
      h.run(DT, () => ({ carve: aimed ? 0 : 1 }));
      if (h.s.mode === 'airborne' || h.s.p.y >= 0.85 * h.wave.crestY(h.s.param.x)) top = h.s.time;
    }
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(1.5);
  });

  // Straight up the face the board's run along the wave is ~0 and flips sign tick to tick: a held
  // carve toward the lip must keep turning one way (the sense it latched from the last clear run,
  // down the line: over toward the curl), not pin (a cancelled yaw rate) or fishtail across it.
  // (Playtest 4: it no longer settles straight up — it keeps turning while held.)
  it.each([
    [15, 0.15, 8],
    [15, 0.15, 12],
    [25, 0.1, 10],
  ])('pointing straight up the face, a held carve toward the lip keeps turning one way, over toward the curl (x = %d, t = %d, %d m/s)', (x, t, speed) => {
    const h = setup();
    h.surfer.reset(x, t);
    const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(-h.surfer.peelSpeed, 0, 0).addScaledVector(up, speed); // world motion: straight up the face
    h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
    // The line's angle in the face (0 = down the line, 90° = straight up), unwrapped.
    const angle = () => Math.atan2(h.s.heading.dot(up), h.s.heading.x);
    let phi = angle();
    const phis: number[] = [];
    let minRate = Infinity;
    for (let i = 0; i < 150 && h.s.mode === 'riding' && h.s.p.y < 0.9 * h.wave.crestY(h.s.param.x); i++) {
      h.run(DT, () => ({ carve: 1 }));
      const a = angle();
      phi += Math.atan2(Math.sin(a - phi), Math.cos(a - phi));
      phis.push(phi);
      if (i > 0) minRate = Math.min(minRate, h.s.turnRate);
    }
    expect(phis.length).toBeGreaterThan(30);
    expect(minRate).toBeGreaterThan(0); // one sense throughout
    // Largest move back against the turn: none.
    let hi = phis[0]!;
    let back = 0;
    for (const v of phis) {
      hi = Math.max(hi, v);
      back = Math.max(back, hi - v);
    }
    expect(back).toBeLessThan(0.02);
    expect(phis.at(-1)! - phis[0]!).toBeGreaterThan(30 * DEG); // turned over toward the curl
  });

  it('the turn radius grows with speed', () => {
    const radius = (speed: number) => {
      const h = trimming(speed, 30, 0.35);
      h.run(DT);
      const h0 = h.s.heading.clone();
      let path = 0;
      for (let i = 0; i < 60; i++) {
        path += h.surfer.worldSpeed(h.surfer.peelSpeed) * DT;
        h.run(DT, () => ({ carve: 1 }));
      }
      return path / h0.angleTo(h.s.heading);
    };
    const r6 = radius(6);
    const r9 = radius(9);
    const r12 = radius(12);
    expect(r9).toBeGreaterThan(r6 * 1.3);
    expect(r12).toBeGreaterThan(r9 * 1.3);
  });

  /**
   * From (15, 0.15), riding at world `speed` down the face at `angle` from the fall line (+ toward
   * the shoulder), with no input into the trough; there, a carve turning the line `turn` round (+1:
   * from straight down toward the shoulder, −1 toward the curl, 0 none) is held until the board runs along the wave (|heading.x| >
   * 0.7), then let go. Returns the speed just before the bottom, the lowest speed through the bottom
   * turn (0.2 s), the largest one-tick change of the board's yaw in the face, the yaw change over the
   * 0.5 s after the bottom and the final heading.
   */
  function slamTrough(speed: number, angleDeg: number, turn: -1 | 0 | 1) {
    const h = setup();
    h.surfer.reset(15, 0.15);
    const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
    const a = angleDeg * DEG;
    const world = new Vector3(1, 0, 0).multiplyScalar(Math.sin(a)).addScaledVector(up, -Math.cos(a) * speed);
    world.x = Math.sin(a) * speed;
    h.s.v.copy(world).setX(world.x - h.surfer.peelSpeed);
    h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
    h.run(DT); // the heading follows the set-up motion
    let before = NaN;
    let hitAt = -1;
    let minAfter = Infinity;
    let maxTurn = 0;
    let yawAtHit = NaN;
    let turned = false;
    // The carve key that turns the board `turn`'s way round from how it runs now (+1 = toward the lip).
    const key = () => turn * (h.surfer as unknown as { turnSense: number }).turnSense;
    let yaw = faceYaw(h.wave, h.s.param, h.s.heading);
    for (let i = 0; i < 2 * 120 && h.s.mode === 'riding'; i++) {
      const sp = h.surfer.worldSpeed(h.surfer.peelSpeed);
      turned ||= hitAt >= 0 && Math.abs(h.s.heading.x) > 0.7;
      h.run(DT, () => ({ carve: hitAt >= 0 && !turned ? key() : 0 }));
      if (hitAt < 0 && h.s.param.t <= 0) {
        hitAt = h.s.time;
        before = sp;
        yawAtHit = faceYaw(h.wave, h.s.param, h.s.heading);
      }
      // The turn itself (≈ 0.13 s); afterwards the flats bog the board down (flatsDragMultiplier) on purpose.
      if (hitAt >= 0 && h.s.time <= hitAt + 0.2) minAfter = Math.min(minAfter, h.surfer.worldSpeed(h.surfer.peelSpeed));
      const y = faceYaw(h.wave, h.s.param, h.s.heading);
      maxTurn = Math.max(maxTurn, Math.abs(wrapAngle(y - yaw)));
      yaw = y;
      if (hitAt >= 0 && h.s.time > hitAt + 0.5) break;
    }
    const yawAfter = Math.abs(wrapAngle(yaw - yawAtHit)) / DEG;
    return { hit: hitAt >= 0, before, minAfter, maxTurnDeg: maxTurn / DEG, yawAfterDeg: yawAfter, heading: h.s.heading.clone() };
  }

  it.each([
    [6, 0],
    [10, 0],
    [6, 20],
    [10, 20],
    [10, -20],
  ])('slamming the trough at %d m/s (%d° off the fall line) and carving is a bottom turn: keeps ≥ 70% of the speed, no heading snap (≤ 15° per tick)', (speed, angle) => {
    // Playtest 6: the bottom turn is the player's carve (from straight down, toward the shoulder; off
    // the fall line, the way the board already runs).
    const r = slamTrough(speed, angle, angle < 0 ? -1 : 1);
    expect(r.hit).toBe(true);
    expect(r.minAfter).toBeGreaterThanOrEqual(0.7 * r.before);
    expect(r.maxTurnDeg).toBeLessThanOrEqual(15);
    // It comes out running along the wave, the way it was already going (straight down → the shoulder).
    if (angle < 0) expect(r.heading.x).toBeLessThan(-0.7);
    else expect(r.heading.x).toBeGreaterThan(0.7);
  });

  // Playtest 6: with no carve key held nothing turns the board — not even the trough. It bogs down on
  // the flats, its line held, until the player carves.
  it.each([
    [6, 0],
    [10, 20],
    [10, -20],
  ])('slamming the trough at %d m/s (%d° off the fall line) with no key held: no auto bottom turn, the line holds and the flats bog the board down', (speed, angle) => {
    const r = slamTrough(speed, angle, 0);
    expect(r.hit).toBe(true);
    expect(r.yawAfterDeg).toBeLessThan(2);
    expect(r.maxTurnDeg).toBeLessThan(1);
    expect(r.minAfter).toBeLessThan(r.before);
  });

  it('the board points along its motion through the water, even while losing ground to the curl', () => {
    const h = trimming(6); // frame v.x = 6 − Vp < 0
    h.run(DT);
    expect(h.s.v.x).toBeLessThan(0);
    const world = new Vector3(h.s.v.x + h.surfer.peelSpeed, h.s.v.y, h.s.v.z).normalize();
    expect(h.s.heading.x).toBeGreaterThan(0.9);
    expect(h.s.heading.angleTo(world)).toBeLessThan(1e-6);
  });

  it('a faster peel costs the rider ground, not world speed: frame v.x drops by ≈ Δ, v stays on the surface', () => {
    const h = trimming(10);
    const vx0 = h.s.v.x;
    const world0 = h.surfer.worldSpeed(h.surfer.peelSpeed);
    h.surfer.setPeelSpeed(h.cfg.wave.peelSpeed + 3);
    expect(h.surfer.peelSpeed).toBe(h.cfg.wave.peelSpeed + 3);
    expect(h.s.v.x).toBeCloseTo(vx0 - 3, 1);
    expect(h.s.v.dot(h.s.normal)).toBeCloseTo(0, 9);
    expect(h.surfer.worldSpeed(h.surfer.peelSpeed)).toBeCloseTo(world0, 1);
  });
});

describe('Surfer — air', () => {
  /** From reset at (x, 0.3), heading straight up the face at `speed`. */
  function climbFast(h: ReturnType<typeof setup>, x: number, speed: number) {
    h.surfer.reset(x, 0.3);
    const n = h.wave.normal(x, 0.3);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.copy(up).multiplyScalar(speed);
  }

  /** One tick; returns how far p moved beyond |v|·dt (the larger of |v| before / after). */
  function tick(h: ReturnType<typeof setup>, input: Partial<SurferInput> = {}) {
    const before = h.s.p.clone();
    const vBefore = h.s.v.length();
    h.run(DT, () => input);
    return h.s.p.distanceTo(before) - Math.max(vBefore, h.s.v.length()) * DT;
  }

  /** Climb at `speed` until the first crest air lands (or 5 s pass). */
  function crestAir(x: number, speed: number, input: (airTick: number) => Partial<SurferInput> = () => ({})) {
    const h = setup();
    climbFast(h, x, speed);
    let worstStep = -Infinity;
    let airTicks = 0;
    for (let i = 0; i < 5 * 120; i++) {
      const wasAir = h.s.mode === 'airborne';
      worstStep = Math.max(worstStep, tick(h, wasAir ? input(airTicks++) : {}));
      if (wasAir && h.s.mode !== 'airborne') break;
    }
    const landed = h.events.find((e) => e.type === 'landed');
    return { h, worstStep, landed: landed?.type === 'landed' ? landed : undefined };
  }

  const AIR_X = [0, 2, 5, 10, 15, 20, 25, 30];
  const AIR_V = [8, 12, 18];

  it.each(AIR_X.flatMap((x) => AIR_V.map((v) => [x, v] as const)))(
    'crest air launches, stays continuous and lands riding (x=%d, %d m/s)',
    (x, speed) => {
      const { h, worstStep, landed } = crestAir(x, speed);
      expect(h.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
      expect(h.s.mode).toBe('riding');
      expect(landed).toBeDefined();
      expect(h.events.some((e) => e.type === 'kickedOut' || e.type === 'wipeout')).toBe(false);
      expect(worstStep).toBeLessThanOrEqual(0.05);
      if (speed === 12 && x <= 20) expect(landed!.airTime).toBeGreaterThanOrEqual(0.9);
    },
  );

  it.each(AIR_X)('crest air time grows with speed (x=%d)', (x) => {
    const times = AIR_V.map((v) => crestAir(x, v).landed?.airTime ?? 0);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
  });

  it('a crest air on the flat shoulder comes back down onto the face (never kicked out over the back)', () => {
    const { h, landed } = crestAir(40, 18);
    expect(h.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
    expect(landed).toBeDefined();
    expect(h.s.mode).toBe('riding');
    expect(h.events.some((e) => e.type === 'kickedOut')).toBe(false);
  });

  it('a hollow-section crest air (x=10, 12 m/s) rises well above the crest (air axis tilted toward vertical)', () => {
    const h = setup();
    climbFast(h, 10, 12);
    let apexY = -Infinity;
    for (let i = 0; i < 5 * 120; i++) {
      const wasAir = h.s.mode === 'airborne';
      h.run(DT);
      if (h.s.mode === 'airborne') apexY = Math.max(apexY, h.s.p.y);
      if (wasAir && h.s.mode !== 'airborne') break;
    }
    expect(h.events.some((e) => e.type === 'landed')).toBe(true);
    expect(apexY).toBeGreaterThan(h.wave.crestY(10) + 1.5);
  });

  // The face end is discontinuous in x near x ≈ 19.38 (a steep band below an upper ledge): crossing it
  // toward the curl must never teleport the rider.
  const FACE_END_JUMP_X = 19.38;
  const CROSS_CASES = [21, 22].flatMap((x) => [12, 18].flatMap((v) => [-3, -6].map((vx) => [x, v, vx] as const)));
  it.each(CROSS_CASES)('a crest air drifting across the face-end step stays continuous (x=%d, %d m/s, vx %d)', (x, speed, vx) => {
    const h = setup();
    climbFast(h, x, speed);
    h.s.v.x += vx;
    let worst = -Infinity;
    let minAirX = Infinity;
    for (let i = 0; i < 4 * 120; i++) {
      worst = Math.max(worst, tick(h));
      if (h.s.mode === 'airborne') minAirX = Math.min(minAirX, h.s.param.x);
      if (h.s.mode !== 'riding' && h.s.mode !== 'airborne') break;
    }
    expect(h.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
    expect(h.events.find((e) => e.type === 'landed' || e.type === 'wipeout')?.type).toBe('landed');
    expect(minAirX).toBeLessThan(FACE_END_JUMP_X);
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it.each([
    [20.5, -6],
    [21, -8],
    [20, -4],
  ])('riding along the top of the face toward the curl across the face-end step stays continuous (x=%d, vx %d)', (x, vx) => {
    const h = setup();
    h.surfer.reset(x, 0.7);
    const n = h.wave.normal(x, h.s.param.t);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(vx, 0, 0).addScaledVector(up, 1);
    const nrm = new Vector3();
    let worst = -Infinity;
    let minX = Infinity;
    for (let i = 0; i < 120; i++) {
      worst = Math.max(worst, tick(h, { carve: 1 }));
      minX = Math.min(minX, h.s.param.x);
      if (h.s.mode === 'riding') expect(h.wave.normal(h.s.param.x, h.s.param.t, nrm).y).toBeGreaterThanOrEqual(0);
    }
    expect(minX).toBeLessThan(FACE_END_JUMP_X);
    expect(h.s.mode).toBe('riding');
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it('a 360 is achievable off the crest (x=10, 12 m/s) and lands clean when released aligned', () => {
    const ticks360 = Math.round((360 / SURF_CONFIG.physics.spinRate) * 120);
    const { h, landed } = crestAir(10, 12, (i) => ({ spin: i < ticks360 ? 1 : 0 }));
    expect(h.s.mode).toBe('riding');
    expect(landed).toBeDefined();
    expect(landed!.spinDeg).toBeGreaterThanOrEqual(320);
    expect(landed!.revert).toBe(false);
  });

  it.each([0.3, 0.5, 0.6])('ollie adds exactly ollieImpulse along the normal, even moving down the face (x=10, t=%d)', (t) => {
    const h = setup();
    h.surfer.reset(10, t); // DROP-IN velocity: moving down the face
    const n = h.s.normal.clone();
    expect(h.s.v.y).toBeLessThan(0);
    const vn0 = h.s.v.dot(n);
    h.run(DT, () => ({ ollie: true }));
    expect(h.s.mode).toBe('airborne');
    expect(h.s.v.dot(n) - vn0).toBeCloseTo(h.cfg.physics.ollieImpulse, 6);
    let i = 0;
    while (h.s.mode === 'airborne' && i++ < 600) h.run(DT);
    const landed = h.events.find((e) => e.type === 'landed');
    expect(landed && landed.type === 'landed' && landed.airTime).toBeCloseTo((2 * h.cfg.physics.ollieImpulse) / h.cfg.physics.gravity, 1);
    expect(h.s.mode).toBe('riding');
  });

  it('too slow at the top of the face: no launch, clamps and slides back down', () => {
    const h = setup();
    climbFast(h, 15, 4);
    let maxT = 0;
    for (let i = 0; i < 4 * 120; i++) {
      h.run(DT);
      maxT = Math.max(maxT, h.s.param.t);
    }
    expect(h.events.some((e) => e.type === 'launched')).toBe(false);
    expect(h.s.mode).toBe('riding');
    expect(h.s.param.t).toBeLessThan(maxT - 0.05);
    const slow = setup();
    climbFast(slow, 10, 4);
    slow.run(2);
    expect(slow.events.some((e) => e.type === 'launched')).toBe(false);
  });

  it('never rides where the surface normal points down (floating keeps an upward frame)', () => {
    const nrm = new Vector3();
    let floatingTicks = 0;
    for (const x of [-4, -3, -2, -1, -0.5, 0, 2, 5, 10, 20, 40]) {
      for (const speed of [4, 8, 12, 18]) {
        // Straight up the face, and with +4 m/s along the wave (the floater approach where x < 0).
        for (const along of [0, 4]) {
          const h = setup();
          climbFast(h, x, speed);
          h.s.v.x += along;
          for (let i = 0; i < 4 * 120; i++) {
            h.run(DT);
            if (h.s.mode !== 'riding') continue;
            const at = `x=${x} v=${speed} along=${along} tick=${i}`;
            if (h.s.floating) {
              floatingTicks++;
              expect(h.s.normal.y, at).toBeGreaterThan(0);
            } else expect(h.wave.normal(h.s.param.x, h.s.param.t, nrm).y, at).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    expect(floatingTicks).toBeGreaterThan(0);
  });

  function bigOllie(spinTicks: number) {
    const h = setup({ ollieImpulse: 9 });
    h.run(1);
    h.run(DT, () => ({ ollie: true }));
    expect(h.s.mode).toBe('airborne');
    let i = 0;
    while (h.s.mode === 'airborne' && i < 600) {
      h.run(DT, () => ({ spin: i < spinTicks ? 1 : 0 }));
      i++;
    }
    return h;
  }

  it('a 360 with an aligned landing is clean', () => {
    const h = bigOllie(80); // 540°/s × 80/120 s = 360°
    expect(h.s.mode).toBe('riding');
    const landed = h.events.find((e) => e.type === 'landed');
    expect(landed).toMatchObject({ type: 'landed', spinDeg: 360, revert: false, ollie: true });
  });

  /** Air ticks of the big ollie with no input (its flight is fixed by the ollie impulse). */
  function bigOllieTicks(): number {
    const h = setup({ ollieImpulse: 9 });
    h.run(1);
    h.run(DT, () => ({ ollie: true }));
    let n = 0;
    while (h.s.mode === 'airborne' && n < 600) {
      h.run(DT);
      n++;
    }
    return n;
  }

  it('a spin held right into the landing, 90° off, is a wipeout', () => {
    // Spin until just before touchdown, finishing a quarter turn past a half turn: too little time to settle.
    const n = bigOllieTicks();
    const spun = setup({ ollieImpulse: 9 });
    spun.run(1);
    spun.run(DT, () => ({ ollie: true }));
    let i = 0;
    const stop = n - 2;
    // … a spin that ends ~90° off a half turn, 2 ticks before touchdown.
    const start = stop - Math.round((450 / SURF_CONFIG.physics.spinRate) * 120);
    while (spun.s.mode === 'airborne' && i < 600) {
      spun.run(DT, () => ({ spin: i >= start && i < stop ? 1 : 0 }));
      i++;
    }
    expect(spun.s.mode).toBe('wipeout');
    expect(spun.s.wipeoutReason).toBe('badLanding');
  });

  it('a spin let go part-way settles to the nearest half turn and lands clean', () => {
    const h = bigOllie(20); // 90° of spin, then let go with most of the air left
    expect(h.s.mode).toBe('riding');
    expect(h.events.find((e) => e.type === 'landed')).toBeDefined();
    const h2 = bigOllie(30); // 135° → settles to a 180
    expect(h2.s.mode).toBe('riding');
    expect(h2.events.find((e) => e.type === 'landed')).toMatchObject({ spinDeg: 180, revert: true });
  });

  it('a carve key still held from the face does not spin an ollie (a spin needs a fresh press)', () => {
    const h = setup({ ollieImpulse: 9 });
    h.run(1);
    h.run(0.05, () => ({ carve: 1, spin: 1 }));
    h.run(DT, () => ({ ollie: true, carve: 1, spin: 1 }));
    expect(h.s.mode).toBe('airborne');
    let i = 0;
    while (h.s.mode === 'airborne' && i++ < 600) h.run(DT, () => ({ carve: 1, spin: 1 }));
    expect(h.s.mode).toBe('riding');
    expect(h.events.find((e) => e.type === 'landed')).toMatchObject({ spinDeg: 0, revert: false });
    // Released and pressed again in the air, it spins.
    const f = setup({ ollieImpulse: 9 });
    f.run(1);
    f.run(0.05, () => ({ carve: 1, spin: 1 }));
    f.run(DT, () => ({ ollie: true, carve: 1, spin: 1 }));
    f.run(DT);
    f.run(80 * DT, () => ({ spin: 1 }));
    let j = 0;
    while (f.s.mode === 'airborne' && j++ < 600) f.run(DT);
    expect(f.events.find((e) => e.type === 'landed')).toMatchObject({ spinDeg: 360 });
  });

  it('a 180 lands reversed and auto-reverts', () => {
    const h = bigOllie(40);
    expect(h.s.mode).toBe('riding');
    expect(h.events.find((e) => e.type === 'landed')).toMatchObject({ spinDeg: 180, revert: true });
    expect(h.s.stanceFlipped).toBe(true);
  });

  it('a grab held into the landing is let go just before touchdown: scored and clean', () => {
    const held = setup({ ollieImpulse: 9 });
    held.run(1);
    held.run(DT, () => ({ ollie: true }));
    held.run(3, () => ({ grab: 'indy' }));
    expect(held.s.mode).toBe('riding');
    const landed = held.events.find((e) => e.type === 'landed');
    expect(landed && landed.type === 'landed' && landed.grabs[0]?.kind).toBe('indy');
    expect(landed && landed.type === 'landed' && landed.grabs[0]!.heldSec).toBeGreaterThan(1.4);

    const released = setup({ ollieImpulse: 9 });
    released.run(1);
    released.run(DT, () => ({ ollie: true }));
    released.run(0.4, () => ({ grab: 'method' }));
    released.run(3);
    const l2 = released.events.find((e) => e.type === 'landed');
    expect(l2 && l2.type === 'landed' && l2.grabs[0]?.kind).toBe('method');
  });
});

describe('Surfer — held carves and the roundhouse', () => {
  /** At (x, t), world motion at `speed` along the face, `deg` from down the line (+: toward the lip; 180 = back toward the curl). */
  function moving(speed: number, x: number, t: number, deg: number) {
    const h = setup();
    h.surfer.reset(x, t);
    const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
    const a = deg * DEG;
    h.s.v.set(Math.cos(a) * speed - h.surfer.peelSpeed, 0, 0).addScaledVector(up, Math.sin(a) * speed);
    h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
    h.run(DT); // the heading follows the set-up motion
    return h;
  }

  /**
   * Holds `carve` from the given state for up to `seconds` (or until `until` is true), recording the
   * carve yaw (Σ turnRate·dt), the smallest yaw rate after the rail has bitten (0.25 s), the largest
   * one-tick heading change while riding, the most negative heading.x and the events.
   */
  function hold(h: ReturnType<typeof setup>, carve: number, seconds: number, until: () => boolean = () => false) {
    const t0 = h.s.time;
    const e0 = h.events.length;
    const prev = h.s.heading.clone();
    let yaw = 0;
    let minRate = Infinity;
    let maxTick = 0;
    let minHx = Infinity;
    let rhSpeed = NaN;
    while (h.s.time - t0 < seconds && h.s.mode === 'riding' && !until()) {
      const n = h.events.length;
      h.surfer.step({ ...NO_INPUT, carve }, DT);
      if (h.events.slice(n).some((e) => e.type === 'roundhouse')) rhSpeed = h.surfer.worldSpeed(h.surfer.peelSpeed);
      if (h.s.mode !== 'riding') break;
      yaw += h.s.turnRate * DT;
      if (h.s.time - t0 > 0.25) minRate = Math.min(minRate, Math.sign(carve) * h.s.turnRate);
      maxTick = Math.max(maxTick, prev.angleTo(h.s.heading));
      prev.copy(h.s.heading);
      minHx = Math.min(minHx, h.s.heading.x);
    }
    return { yawDeg: yaw / DEG, minRate, maxTickDeg: maxTick / DEG, minHx, events: h.events.slice(e0), rhSpeed };
  }

  it.each([8, 12])('from down the line at %d m/s, a held carve toward the lip turns on past straight up and past 180° (back toward the curl) without settling', (speed) => {
    const h = moving(speed, 30, 0.3, 0);
    const r = hold(h, 1, 3, () => h.s.heading.x < -0.3 && h.s.heading.y < -0.3);
    expect(h.s.mode).toBe('riding');
    expect(r.yawDeg).toBeGreaterThanOrEqual(200);
    expect(r.minHx).toBeLessThan(-0.7); // really heading back toward the curl
    expect(r.minRate).toBeGreaterThan(0.5); // the yaw keeps accumulating the same way: never settles
    expect(r.maxTickDeg).toBeLessThanOrEqual(15);
    expect(r.events.some((e) => e.type === 'launched')).toBe(false); // a held turn at the lip never launches
  });

  it('releasing mid-turn stops the turn on that tick and holds the line', () => {
    const h = moving(10, 30, 0.3, 0);
    hold(h, 1, 0.35);
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(1);
    expectReleaseStops(h);
  });

  /**
   * Playtest 6 ("when i let go, the turning must stop"; supersedes playtest 4's ease-out over carveLag):
   * from the release tick the yaw rate is exactly 0 on every riding tick, and over the next 1 s the
   * board's yaw in the face (its line from along the wave toward up the face — the 3D heading also
   * moves with the surface under it) changes by under 2° in all. Nothing scores a ROUNDHOUSE for a
   * turn the player let go of. (Leaving the face — a launch off the lip, the curl — ends the check.)
   */
  function expectReleaseStops(h: ReturnType<typeof setup>) {
    const e0 = h.events.length;
    let yaw = faceYaw(h.wave, h.s.param, h.s.heading);
    let turned = 0;
    let ticks = 0;
    for (let i = 0; i < 120 && h.s.mode === 'riding'; i++) {
      h.surfer.step(NO_INPUT, DT);
      if (h.s.mode !== 'riding') break;
      ticks++;
      expect(h.s.turnRate).toBe(0);
      const y = faceYaw(h.wave, h.s.param, h.s.heading);
      turned += Math.abs(wrapAngle(y - yaw));
      yaw = y;
    }
    expect(ticks).toBeGreaterThan(0);
    expect(turned / DEG).toBeLessThan(2);
    expect(h.events.slice(e0).some((e) => e.type === 'roundhouse')).toBe(false);
    return ticks;
  }
  type Internals = { rebound: 'foam' | 'lip' | null; snapArmed: boolean; atCrest: boolean };
  const internals = (h: ReturnType<typeof setup>) => h.surfer as unknown as Internals;

  it('let go mid cutback (turning back toward the curl), the board stops turning', () => {
    const h = moving(10, 30, 0.3, 0);
    hold(h, 1, 3, () => h.s.heading.x < -0.3);
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(2);
    expectReleaseStops(h);
  });

  it('let go mid foam rebound (a long hold into the whitewater), the bounce stops: no auto-rotation, no ROUNDHOUSE', () => {
    for (const [speed, x, t] of [
      [10, 8, 0.2],
      [8, 7, 0.35],
    ] as const) {
      const h = moving(speed, x, t, 0);
      hold(h, 1, 3, () => internals(h).rebound === 'foam');
      expect(internals(h).rebound).toBe('foam');
      hold(h, 1, 0.08); // well into the bounce, the boosted rail biting
      expect(internals(h).rebound).toBe('foam');
      expect(Math.abs(h.s.turnRate)).toBeGreaterThan(4);
      expectReleaseStops(h);
      expect(internals(h).rebound).toBe(null);
    }
  });

  it('let go mid lip rebound (the second press of a two-press roundhouse), the bounce stops', () => {
    const h = moving(10, 25, 0.3, 0);
    hold(h, 1, 3, () => h.s.heading.x < -0.7);
    h.run(0.15);
    hold(h, 1, 1, () => internals(h).rebound === 'lip');
    expect(internals(h).rebound).toBe('lip');
    hold(h, 1, 0.1);
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(3);
    expectReleaseStops(h);
  });

  it('let go at the lip with a snap armed (the rail biting harder there), the board stops turning', () => {
    const h = setup();
    h.surfer.reset(15, 0.3);
    const n = h.wave.normal(15, 0.3);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(3 - h.surfer.peelSpeed, 0, 0).addScaledVector(up, 4.5);
    h.run(DT);
    hold(h, 1, 3, () => internals(h).snapArmed && internals(h).atCrest);
    expect(internals(h).snapArmed && internals(h).atCrest).toBe(true);
    hold(h, 1, 0.05);
    expectReleaseStops(h);
  });

  it('let go after a long (3 s) held carve, the board stops turning at once', () => {
    const h = moving(10, 40, 0.3, 0);
    hold(h, 1, 3);
    expect(h.s.mode).toBe('riding');
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(1);
    expectReleaseStops(h);
  });

  it('let go mid bottom turn at the trough (a carve held into the flats), the board stops turning: no auto bottom turn', () => {
    const h = moving(9, 30, 0.3, -80); // dropping almost straight down the face
    hold(h, 0, 1, () => h.s.param.t <= 0);
    expect(h.s.param.t).toBeLessThanOrEqual(0);
    hold(h, 1, 0.04); // the turn under way on the flats
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(1);
    expectReleaseStops(h);
  });

  it('two presses: let go in the gap after the cutback, and again just after the re-press, the board stops turning each time', () => {
    const h = moving(10, 25, 0.3, 0);
    hold(h, 1, 3, () => h.s.heading.x < -0.7);
    expect(Math.abs(h.s.turnRate)).toBeGreaterThan(2);
    expectReleaseStops(h);
    const g = moving(10, 25, 0.3, 0);
    hold(g, 1, 3, () => g.s.heading.x < -0.7);
    g.run(0.15);
    hold(g, 1, 0.05); // the re-press, before the rebound has turned it far
    expect(Math.abs(g.s.turnRate)).toBeGreaterThan(0.5);
    expectReleaseStops(g);
  });

  it('a held carve toward the trough turns through the fall line, round the bottom and back up the face (never stuck on the flats)', () => {
    const h = moving(10, 30, 0.3, 0);
    let wentBack = false;
    let climbedBack = false;
    for (let i = 0; i < 3 * 120 && h.s.mode === 'riding' && !climbedBack; i++) {
      h.surfer.step({ ...NO_INPUT, carve: -1 }, DT);
      if (h.s.heading.x < -0.7) wentBack = true;
      if (wentBack && h.s.heading.y > 0.15) climbedBack = true;
    }
    expect(wentBack).toBe(true);
    expect(climbedBack).toBe(true);
    expect(h.s.mode).toBe('riding');
  });

  /**
   * A roundhouse as a player does it: from down the line at `speed`, hold the carve toward the lip
   * (the key's meaning is latched while held) until the board comes back out heading down the line.
   */
  function roundhouse(speed: number, x: number, t: number) {
    const h = moving(speed, x, t, 0);
    const entry = h.surfer.worldSpeed(h.surfer.peelSpeed);
    let back = false;
    const r = hold(h, 1, 4, () => {
      if (h.s.heading.x < -0.7) back = true;
      return back && h.events.some((e) => e.type === 'roundhouse') && h.s.heading.x > 0.5;
    });
    return { h, r, entry };
  }

  /**
   * Out of the roundhouse: held on (the spent key does nothing) for 0.5 s, the board is back on its
   * line down the face. Checks the shared exit conditions.
   */
  function expectCleanExit(h: ReturnType<typeof setup>, r: ReturnType<typeof hold>, entry: number, carve: number) {
    expect(r.events.some((e) => e.type === 'wipeout' || e.type === 'launched')).toBe(false);
    expect(h.s.mode).toBe('riding');
    expect(r.minHx).toBeLessThan(-0.7);
    expect(h.s.heading.x).toBeGreaterThan(0.5); // heading down the line again
    const rh = r.events.filter((e) => e.type === 'roundhouse');
    expect(rh).toHaveLength(1);
    expect(rh[0]!.type === 'roundhouse' && rh[0]!.degrees).toBeGreaterThanOrEqual(h.cfg.physics.roundhouseDeg);
    // The roundhouse replaces the snap on the way round: none, or one whose wait ran out (snapDeferMax)
    // and which the roundhouse takes back.
    const snaps = r.events.filter((e) => e.type === 'snap').length;
    expect(snaps).toBeLessThanOrEqual(1);
    expect(rh[0]!.type === 'roundhouse' && rh[0]!.replacesSnap).toBe(snaps === 1);
    // It costs a little speed: the kick and the foam's push never take it past the speed the cutback
    // went in with (gravity on the last ticks of the drop off the lip may add a touch: 2%).
    expect(r.rhSpeed).toBeLessThanOrEqual(1.02 * entry);
    expect(r.maxTickDeg).toBeLessThanOrEqual(15);
    // Not left deep in the tube.
    expect(h.s.param.x).toBeGreaterThan(-h.cfg.wave.tubeDepth / 2);
    const prev = h.s.heading.clone();
    let maxTick = 0;
    for (let i = 0; i < 60; i++) {
      h.surfer.step({ ...NO_INPUT, carve }, DT);
      maxTick = Math.max(maxTick, prev.angleTo(h.s.heading) / DEG);
      prev.copy(h.s.heading);
    }
    expect(maxTick).toBeLessThanOrEqual(15);
    expect(h.s.mode).toBe('riding');
    expect(h.s.heading.x).toBeGreaterThan(0); // still running down the line, dropping down the face
    expect(h.surfer.worldSpeed(h.surfer.peelSpeed)).toBeGreaterThanOrEqual(0.6 * entry);
    expect(h.events.filter((e) => e.type === 'roundhouse')).toHaveLength(1);
    expect(h.events.filter((e) => e.type === 'snap')).toHaveLength(snaps);
  }

  // One held carve, started near enough the curl for the turn to come round into the whitewater
  // (further out, a held carve just loops round: see the tests above, and the two-press move below).
  it.each([
    [8, 7, 0.2],
    [8, 7, 0.35],
    [10, 8, 0.2],
    [10, 9, 0.2],
  ])('one held carve at %d m/s from x = %d: round past 180° back toward the curl, rebounds off the whitewater and comes out down the line, no faster than it went in', (speed, x, t) => {
    const { h, r, entry } = roundhouse(speed, x, t);
    // Held on through the bounce, the spent carve does not start another turn: the board holds its line.
    expectCleanExit(h, r, entry, 1);
  });

  // The two-press roundhouse, at any distance from the curl: hold the carve toward the lip round past
  // straight up until the board runs back toward the curl, let go for 0.15 s, then press toward the
  // lip again (the second half of the figure-8) and hold it until the board is back down the line.
  it.each([
    [8, 20, 0.2],
    [8, 25, 0.35],
    [10, 20, 0.35],
    [10, 30, 0.2],
    [12, 22, 0.35],
    [12, 28, 0.5],
    [12, 30, 0.2],
  ])('two presses at %d m/s from x = %d: cut back, let go, press into the lip — one ROUNDHOUSE (replacing any snap), back down the line, no faster than it went in', (speed, x, t) => {
    const h = moving(speed, x, t, 0);
    const entry = h.surfer.worldSpeed(h.surfer.peelSpeed);
    const e0 = h.events.length;
    const prev = h.s.heading.clone();
    let maxTick = 0;
    let minHx = Infinity;
    let phase: 'cut' | 'gap' | 'press' = 'cut';
    let backAt = -1;
    let rhSpeed = NaN;
    for (let i = 0; i < 4 * 120 && h.s.mode === 'riding'; i++) {
      if (phase === 'cut' && h.s.heading.x < -0.7) {
        phase = 'gap';
        backAt = h.s.time;
      }
      if (phase === 'gap' && h.s.time - backAt >= 0.15) phase = 'press';
      const n = h.events.length;
      h.surfer.step({ ...NO_INPUT, carve: phase === 'gap' ? 0 : 1 }, DT);
      if (h.events.slice(n).some((e) => e.type === 'roundhouse')) rhSpeed = h.surfer.worldSpeed(h.surfer.peelSpeed);
      maxTick = Math.max(maxTick, prev.angleTo(h.s.heading) / DEG);
      prev.copy(h.s.heading);
      minHx = Math.min(minHx, h.s.heading.x);
      if (h.events.some((e) => e.type === 'roundhouse') && h.s.heading.x > 0.5) break;
    }
    expectCleanExit(h, { yawDeg: 0, minRate: 0, maxTickDeg: maxTick, minHx, events: h.events.slice(e0), rhSpeed }, entry, 1);
  });

  it('a cutback is forgotten after cutbackMemory s running at the curl: pressing into the lip later turns the board but is no ROUNDHOUSE', () => {
    const h = moving(10, 40, 0.3, 0);
    hold(h, 1, 2, () => h.s.heading.x < -0.7);
    h.run(h.cfg.physics.cutbackMemory + 0.1);
    expect(h.s.mode).toBe('riding');
    const r = hold(h, 1, 2, () => h.s.heading.x > 0.5);
    expect(h.s.heading.x).toBeGreaterThan(0.5);
    expect(r.events.some((e) => e.type === 'roundhouse')).toBe(false);
  });

  it('just after letting go of a cutback at the lip, running back toward the curl, the lip does not launch (there is time to press again)', () => {
    const run = (guard: number) => {
      const h = setup({ cutbackLaunchGuard: guard });
      h.surfer.reset(20, 0.5);
      const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
      h.s.v.set(12 - h.surfer.peelSpeed, 0, 0).addScaledVector(up, 0);
      h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
      h.run(DT);
      // Over the top and back toward the curl, still high and rising off the lip: let go.
      hold(h, 1, 2, () => h.s.heading.x < -0.3);
      const e0 = h.events.length;
      h.run(0.45);
      return h.events.slice(e0).some((e) => e.type === 'launched');
    };
    expect(run(0)).toBe(true); // without the guard, letting go here throws the rider into the air …
    expect(run(SURF_CONFIG.physics.cutbackLaunchGuard)).toBe(false); // … with it, the lip holds them
  });

  it('a plain cutback into the foam (well short of 180° held) rebounds the rider down the line without a ROUNDHOUSE', () => {
    const h = moving(9, 5, 0.35, 170); // already running back toward the curl
    let out = false;
    const r = hold(h, -1, 2, () => (out = h.s.heading.x > 0.5));
    expect(out).toBe(true);
    expect(r.events.some((e) => e.type === 'wipeout')).toBe(false);
    expect(r.events.some((e) => e.type === 'roundhouse')).toBe(false);
    expect(r.maxTickDeg).toBeLessThanOrEqual(15);
    expect(h.s.param.x).toBeGreaterThan(-h.cfg.wave.tubeDepth);
  });

  it('running back toward the curl high on the face, carving up into the lip turns the rider off it and back down the line (no launch)', () => {
    const h = moving(9, 25, 0.6, 175);
    let out = false;
    const r = hold(h, 1, 2, () => (out = h.s.heading.x > 0.5));
    expect(out).toBe(true);
    expect(r.events.some((e) => e.type === 'launched' || e.type === 'wipeout')).toBe(false);
    expect(r.events.some((e) => e.type === 'roundhouse')).toBe(false);
    expect(r.maxTickDeg).toBeLessThanOrEqual(15);
  });

  it('riding back toward the curl with no carve held, the whitewater does not turn you round (the curl swallows you)', () => {
    const h = moving(9, 5, 0.35, 175);
    h.run(2);
    expect(h.s.wipeoutReason).toBe('swallowed');
  });
});

describe('Surfer — floater and kick-out', () => {
  it('rides a floater over the collapsing lip and lands it', () => {
    const h = setup();
    h.surfer.reset(-2, 0.6);
    const n = h.wave.normal(-2, 0.6);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(4, 0, 0).addScaledVector(up, 6);
    h.run(4);
    expect(h.events.some((e) => e.type === 'floaterStart')).toBe(true);
    const end = h.events.find((e) => e.type === 'floaterEnd');
    expect(end).toMatchObject({ type: 'floaterEnd', landed: true });
    expect(end && end.type === 'floaterEnd' && end.duration).toBeGreaterThan(0.5);
    expect(h.s.mode).toBe('riding');
  });

  it('ends the run as kicked out when stalled far out on the shoulder', () => {
    const h = setup();
    h.surfer.reset(75, 0.38);
    h.s.v.set(0, 0, 0);
    h.run(4);
    expect(h.s.mode).toBe('kickedOut');
    expect(h.events.some((e) => e.type === 'kickedOut')).toBe(true);
  });

  // The steep section by the curl (armed at the face edge). The climb is given as world motion and arrives below launch speed.
  it('snaps when carving through a reversal at the crest (x = 4, steep section by the curl)', () => {
    const h = setup();
    h.surfer.reset(4, 0.4);
    const n = h.wave.normal(4, 0.4);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(2 - h.surfer.peelSpeed, 0, 0).addScaledVector(up, 4);
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'launched')).toBe(false);
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
  });

  /**
   * From a real riding state: lineBot rides for `warmUp` s, then (at the start of its next climb, low on
   * the face) the player takes over: carve toward the lip until the board climbs at `steep` (heading.y)
   * or reaches `at` × crest height, coast up to `at`, then hold `carve` for 1.5 s.
   */
  function takeOver(warmUp: number, pumpEvery: number, steep: number, at: number, carve: number) {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery });
    const frac = () => h.s.p.y / h.wave.crestY(h.s.param.x);
    while (h.s.time < warmUp && h.s.mode === 'riding') h.surfer.step(bot(DT), DT);
    let prev = h.s.heading.y;
    for (let i = 0; i < 5 * 120 && h.s.mode === 'riding'; i++) {
      h.surfer.step(bot(DT), DT);
      if (prev < 0 && h.s.heading.y >= 0 && frac() < 0.45) break;
      prev = h.s.heading.y;
    }
    if (h.s.mode !== 'riding') return null;
    const e0 = h.events.length;
    let phase: 'turn' | 'coast' | 'carve' = 'turn';
    let t0 = 0;
    let lipJump = 0;
    const before = new Vector3();
    for (let i = 0; i < 4 * 120 && h.s.mode === 'riding'; i++) {
      if (phase === 'turn' && (h.s.heading.y >= steep || frac() >= at)) phase = 'coast';
      if (phase === 'coast' && frac() >= at) {
        phase = 'carve';
        t0 = h.s.time;
      }
      if (phase === 'carve' && h.s.time - t0 > 1.5) break;
      before.copy(h.s.heading);
      h.surfer.step({ ...NO_INPUT, carve: phase === 'turn' ? 1 : phase === 'coast' ? 0 : carve }, DT);
      // Turning at the lip (carving at the top of the open face, at riding speed): the largest one-tick
      // heading change. (Near the curl, x < 8, the pitching lip itself turns under a board riding along it.)
      const atLip =
        h.s.mode === 'riding' && frac() >= 0.95 && h.s.param.x >= 8 && h.surfer.worldSpeed(h.surfer.peelSpeed) >= 3;
      if (phase === 'carve' && carve !== 0 && atLip) lipJump = Math.max(lipJump, before.angleTo(h.s.heading) / DEG);
    }
    const events = h.events.slice(e0);
    const snapTimes = events.flatMap((e) => (e.type === 'snap' ? [e.time] : []));
    return {
      snaps: snapTimes.length,
      minSnapGap: Math.min(...snapTimes.slice(1).map((t, k) => t - snapTimes[k]!)),
      launch: events.some((e) => e.type === 'launched'),
      lipJump,
    };
  }

  /** takeOver over a grid of riding states (6–10 s of lineBot) and climbs; the share of attempts that snap / launch. */
  function takeOverGrid(carve: number) {
    let n = 0;
    let snaps = 0;
    let launches = 0;
    let minSnapGap = Infinity;
    let lipJump = 0;
    for (const warmUp of [6, 8, 10])
      for (const pumpEvery of [0.6, 1])
        for (const steep of [0.4, 0.6, 0.8])
          for (const at of [0.5, 0.6, 0.7]) {
            const r = takeOver(warmUp, pumpEvery, steep, at, carve);
            if (!r) continue;
            n++;
            if (r.snaps > 0) snaps++;
            if (r.launch) launches++;
            minSnapGap = Math.min(minSnapGap, r.minSnapGap);
            lipJump = Math.max(lipJump, r.lipJump);
          }
    return { n, snap: snaps / n, launch: launches / n, minSnapGap, lipJump };
  }

  it.each([
    { name: 'carve-back (toward the trough)', carve: -1 },
    { name: 'carve-through (toward the lip)', carve: 1 },
  ])('from riding states, a climb + $name at the top snaps in at least 30 percent of attempts', ({ carve }) => {
    const r = takeOverGrid(carve);
    expect(r.n).toBeGreaterThanOrEqual(40);
    expect(r.snap).toBeGreaterThanOrEqual(0.3);
    // One lip turn is one snap: never re-armed and fired again ticks later (a second climb into
    // the lip within the 1.5 s may snap again) …
    expect(r.minSnapGap).toBeGreaterThan(0.3);
    // … and the board turns with the rail: no one-tick flip of the heading.
    expect(r.lipJump).toBeLessThanOrEqual(15);
  });

  it('from riding states, arriving fast at the lip without carving still launches (airs stay easy)', () => {
    const r = takeOverGrid(0);
    expect(r.n).toBeGreaterThanOrEqual(40);
    expect(r.launch).toBeGreaterThanOrEqual(0.8);
  });

  it('does not snap on a climb that stays low on the face', () => {
    const h = setup();
    h.surfer.reset(15, 0.15);
    const n = h.wave.normal(15, h.s.param.t);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(3, 0, 0).addScaledVector(up, 1);
    // A short climb, then a hard turn back down (a full reversal) well below the top band.
    let top = 0;
    h.run(1.5, (i) => {
      top = Math.max(top, h.s.p.y / h.wave.crestY(h.s.param.x));
      return { carve: i < 30 ? 1 : -1 };
    });
    expect(top).toBeLessThan(h.cfg.physics.snapTopFrac - 0.1);
    expect(h.events.some((e) => e.type === 'snap')).toBe(false);
  });
});

describe('Surfer — floater continuity', () => {
  const CASES = [-1, -3].flatMap((x) => [8, 12, 18].map((v) => [x, v] as const));
  it.each(CASES)('floater at x=%d, %d m/s: continuous, upright, ends back on the face; spin/grab in the dismount is ignored', (x, speed) => {
    const h = setup();
    h.surfer.reset(x, 0.6);
    const n = h.wave.normal(x, 0.6);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(4, 0, 0).addScaledVector(up, speed);
    const onFace = new Vector3();
    const nrm = new Vector3();
    let endChecked = false;
    h.bus.on('floaterEnd', (e) => {
      expect(e.landed).toBe(true);
      expect(h.s.mode).toBe('riding');
      expect(h.s.floating).toBe(false);
      h.wave.profile(h.s.param.x, h.s.param.t, onFace);
      expect(onFace.distanceTo(h.s.p)).toBeLessThan(1e-6);
      expect(h.wave.normal(h.s.param.x, h.s.param.t, nrm).y).toBeGreaterThanOrEqual(0);
      endChecked = true;
    });
    let worst = 0;
    let floatedTicks = 0;
    let started = false;
    for (let i = 0; i < 4 * 120; i++) {
      started ||= h.events.some((e) => e.type === 'floaterStart');
      // Mash spin + grab from the floater start until it has ended (covers the dismount).
      const mash: Partial<SurferInput> = started && !endChecked ? { spin: 1, grab: 'indy' } : {};
      const before = h.s.p.clone();
      const vBefore = h.s.v.length();
      h.run(DT, () => mash);
      worst = Math.max(worst, h.s.p.distanceTo(before) - Math.max(vBefore, h.s.v.length()) * DT);
      if (h.s.floating) {
        floatedTicks++;
        expect(h.s.normal.y, `tick ${i}`).toBeGreaterThan(0);
      }
      if (h.s.mode !== 'riding' && h.s.mode !== 'airborne') break;
    }
    expect(h.events.some((e) => e.type === 'floaterStart')).toBe(true);
    expect(floatedTicks).toBeGreaterThan(0);
    expect(endChecked).toBe(true);
    expect(h.events.some((e) => e.type === 'wipeout')).toBe(false);
    expect(h.events.some((e) => e.type === 'landed' || e.type === 'grabStart')).toBe(false);
    expect(worst).toBeLessThanOrEqual(0.05);
  });
});

describe('Surfer — floater dismount across a face-end step', () => {
  // With a short shoulder the face end is discontinuous near x ≈ 4.35, where floater dismounts come down.
  const CASES = [-1, -3].flatMap((x) => [8, 12, 18].map((v) => [x, v] as const));
  it.each(CASES)('shoulderLength 10: floater at x=%d, %d m/s dismounts without teleporting', (x, speed) => {
    const h = setup();
    h.wave.params.shoulderLength = 10; // this setup's own cloned config
    bumpConfig();
    h.surfer.reset(x, 0.6);
    const n = h.wave.normal(x, 0.6);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(12, 0, 0).addScaledVector(up, speed); // fast along the wave: the dismount carries past x ≈ 4.35
    let worst = -Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 4 * 120; i++) {
      const before = h.s.p.clone();
      const vBefore = h.s.v.length();
      h.run(DT);
      worst = Math.max(worst, h.s.p.distanceTo(before) - Math.max(vBefore, h.s.v.length()) * DT);
      maxX = Math.max(maxX, h.s.param.x);
      if (h.s.mode !== 'riding' && h.s.mode !== 'airborne') break;
    }
    expect(h.events.find((e) => e.type === 'floaterEnd')).toMatchObject({ landed: true });
    expect(maxX).toBeGreaterThan(4.35);
    expect(worst).toBeLessThanOrEqual(0.05);
    expect(SURF_CONFIG.wave.shoulderLength).toBe(45);
  });
});

describe('Surfer — crest cache', () => {
  type CrestProbe = { crestAt(x: number): { y: number } };
  const crestOf = (surfer: Surfer, x: number) => (surfer as unknown as CrestProbe).crestAt(x).y;

  it('reflects current wave params after bumpConfig()', () => {
    const h = setup();
    const before = crestOf(h.surfer, 10);
    expect(before).toBeCloseTo(h.wave.crestY(10), 9);
    h.wave.params.height *= 1.5;
    bumpConfig();
    expect(crestOf(h.surfer, 10)).toBeCloseTo(h.wave.crestY(10), 9);
    expect(crestOf(h.surfer, 10)).toBeGreaterThan(before * 1.4);
  });

  it('is cleared by reset() even without a version bump', () => {
    const h = setup();
    crestOf(h.surfer, 10);
    h.wave.params.height *= 1.5; // no bumpConfig()
    h.surfer.reset(10, 0.4);
    expect(crestOf(h.surfer, 10)).toBeCloseTo(h.wave.crestY(10), 9);
  });
});
