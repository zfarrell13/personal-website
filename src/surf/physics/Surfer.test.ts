import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { bumpConfig, SURF_CONFIG } from '../config';
import { DEG } from '../math/scalar';
import { WaveShape } from '../wave/WaveShape';
import { EventBus, type SurfEvent } from './events';
import { NO_INPUT, type SurferInput } from './input';
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
  it('no input: stays on the surface and the curl swallows the rider after 3.5–5.2 s (never under 2 s)', () => {
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
    expect(caught).toBeGreaterThanOrEqual(3.5);
    expect(caught).toBeLessThanOrEqual(5.2);
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

  it('pumping alone (no carving) loses the wave in under 7 s', () => {
    const h = setup();
    h.run(10, (i) => ({ pump: i % 72 === 0 }));
    const lost = h.events.find((e) => e.type === 'wipeout');
    expect(lost).toBeDefined();
    expect(lost!.time).toBeLessThan(7);
  });

  /** Lines + pumps for 20 s with a 1.4× fast section from 8 s (0.5 s ramps, 4 s hold). */
  function fastSection(pumpEvery: number) {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery });
    const base = h.cfg.wave.peelSpeed;
    let xStart = NaN;
    let xEnd = NaN;
    for (let i = 0; i < 20 * 120; i++) {
      const u = h.s.time + DT - 8;
      const k = u < 0 || u > 5 ? 0 : u < 0.5 ? u / 0.5 : u > 4.5 ? (5 - u) / 0.5 : 1;
      if (u >= 0 && Number.isNaN(xStart)) xStart = h.s.param.x;
      if (u >= 5 && Number.isNaN(xEnd)) xEnd = h.s.param.x;
      h.surfer.setPeelSpeed(base * (1 + 0.4 * k));
      h.surfer.step(bot(DT), DT);
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    const survived = h.s.mode === 'riding' || h.s.mode === 'airborne';
    return { survived, lost: survived ? xStart - xEnd : Infinity };
  }

  it('a fast section: the base effort loses ≥ 5 m of ground; pumping every 0.6 s survives it and loses less', () => {
    const base = fastSection(1);
    const hard = fastSection(0.6);
    expect(base.lost).toBeGreaterThanOrEqual(5);
    expect(hard.survived).toBe(true);
    expect(hard.lost).toBeLessThan(base.lost - 3);
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

  it('a pump on the flats does nothing; on the face it adds speed along the board (vs a no-pump control)', () => {
    const gain = (t: number) => {
      const pumped = trimming(6, 15, t);
      const control = trimming(6, 15, t);
      pumped.surfer.step({ ...NO_INPUT, pump: true }, DT);
      control.surfer.step(NO_INPUT, DT);
      return pumped.surfer.worldSpeed(pumped.surfer.peelSpeed) - control.surfer.worldSpeed(control.surfer.peelSpeed);
    };
    expect(Math.abs(gain(0))).toBeLessThan(0.05);
    expect(gain(0.4)).toBeGreaterThan(1.5);
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

  it.each([8, 15, 25])('from speed, trough → top of the face (85% of the crest) in ≤ 1.5 s (x = %d)', (x) => {
    const h = trimming(10, x, 0.2);
    let top = -1;
    for (let i = 0; i < 3 * 120 && top < 0; i++) {
      h.run(DT, () => ({ carve: 1 }));
      if (h.s.mode === 'airborne' || h.s.p.y >= 0.85 * h.wave.crestY(h.s.param.x)) top = h.s.time;
    }
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(1.5);
  });

  // Straight up the face the board's run along the wave is ~0 and flips sign tick to tick: a held
  // carve toward the lip must settle there, not pin (a cancelled yaw rate) or fishtail across it.
  it.each([
    [15, 0.15, 8],
    [15, 0.15, 12],
    [25, 0.1, 10],
  ])('pointing straight up the face, a held carve toward the lip changes the heading monotonically (x = %d, t = %d, %d m/s)', (x, t, speed) => {
    const h = setup();
    h.surfer.reset(x, t);
    const up = new Vector3().crossVectors(h.s.normal, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(-h.surfer.peelSpeed, 0, 0).addScaledVector(up, speed); // world motion: straight up the face
    h.s.v.addScaledVector(h.s.normal, -h.s.v.dot(h.s.normal));
    const hx: number[] = [];
    for (let i = 0; i < 150 && h.s.mode === 'riding' && h.s.p.y < 0.9 * h.wave.crestY(h.s.param.x); i++) {
      h.run(DT, () => ({ carve: 1 }));
      hx.push(h.s.heading.x);
    }
    expect(hx.length).toBeGreaterThan(30);
    // Largest move back against the running extreme, in either direction.
    let lo = hx[0]!;
    let hi = hx[0]!;
    let backUp = 0;
    let backDown = 0;
    for (const v of hx) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      backUp = Math.max(backUp, v - lo);
      backDown = Math.max(backDown, hi - v);
    }
    expect(Math.min(backUp, backDown)).toBeLessThan(0.02);
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

  it('a 90° landing is a wipeout', () => {
    const h = bigOllie(20); // 90°
    expect(h.s.mode).toBe('wipeout');
    expect(h.s.wipeoutReason).toBe('badLanding');
  });

  it('a 180 lands reversed and auto-reverts', () => {
    const h = bigOllie(40);
    expect(h.s.mode).toBe('riding');
    expect(h.events.find((e) => e.type === 'landed')).toMatchObject({ spinDeg: 180, revert: true });
    expect(h.s.stanceFlipped).toBe(true);
  });

  it('holding a grab into the landing is a wipeout; releasing early is clean', () => {
    const held = setup({ ollieImpulse: 9 });
    held.run(1);
    held.run(DT, () => ({ ollie: true }));
    held.run(3, () => ({ grab: 'indy' }));
    expect(held.s.wipeoutReason).toBe('grabbing');

    const released = setup({ ollieImpulse: 9 });
    released.run(1);
    released.run(DT, () => ({ ollie: true }));
    released.run(0.4, () => ({ grab: 'method' }));
    released.run(3);
    const landed = released.events.find((e) => e.type === 'landed');
    expect(landed && landed.type === 'landed' && landed.grabs[0]?.kind).toBe('method');
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
