import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { bumpConfig, SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { EventBus, type SurfEvent } from './events';
import { NO_INPUT, type SurferInput } from './input';
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

describe('Surfer — riding', () => {
  it('riding straight stays on the surface and settles mid-face', () => {
    const { wave, s, surfer } = setup();
    const onSurface = new Vector3();
    let worst = 0;
    for (let i = 0; i < 20 * 120; i++) {
      surfer.step(NO_INPUT, DT);
      expect(s.mode).toBe('riding');
      wave.profile(s.param.x, s.param.t, onSurface);
      worst = Math.max(worst, onSurface.distanceTo(s.p));
    }
    expect(worst).toBeLessThan(1e-6);
    const frac = s.p.y / wave.crestY(s.param.x);
    expect(frac).toBeGreaterThan(0.3);
    expect(frac).toBeLessThan(0.7);
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

  it('pump spam yields less speed than rhythmic pumping', () => {
    const spam = setup();
    spam.run(1);
    spam.run(6, (i) => ({ pump: i % 12 === 0 }));
    const rhythm = setup();
    rhythm.run(1);
    rhythm.run(6, (i) => ({ pump: i % 72 === 0 }));
    expect(rhythm.s.v.length()).toBeGreaterThan(spam.s.v.length() + 0.3);
  });

  it('carving toward the lip climbs the face (vs a no-carve control from the identical state)', () => {
    const climb = (carve: number) => {
      const h = setup();
      h.run(1);
      const y0 = h.s.p.y;
      h.run(0.4, () => ({ carve }));
      return h.s.p.y - y0;
    };
    const straight = climb(0);
    expect(climb(1)).toBeGreaterThan(straight + 0.03);
    expect(climb(-1)).toBeLessThan(straight - 0.03);
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

  it('snaps when carving through a reversal at the crest', () => {
    const h = setup();
    h.surfer.reset(15, 0.4);
    const n = h.wave.normal(15, 0.4);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(3, 0, 0).addScaledVector(up, 3); // reaches the crest below launch speed
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'launched')).toBe(false);
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
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
