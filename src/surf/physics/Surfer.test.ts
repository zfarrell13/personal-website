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

  // (x = 20 at 8 m/s never reaches the top of the face with launch speed: gravity bleeds it, so it
  // clamps and slides back — covered by the 'too slow' test below.)
  const AIR_CASES = [2, 10, 20].flatMap((x) => [8, 12, 18].filter((v) => !(x === 20 && v === 8)).map((v) => [x, v] as const));

  it.each(AIR_CASES)('crest air is a real, local air (x=%d, %d m/s)', (x, speed) => {
    const h = setup();
    climbFast(h, x, speed);
    const closest = { x: 0, t: 0 };
    const S = new Vector3();
    const n = new Vector3();
    let maxAir = 0;
    let launchedAt = -1;
    let landedJump = 0;
    let minSigned = Infinity;
    for (let i = 0; i < 4 * 120; i++) {
      const before = h.s.p.clone();
      const modeBefore = h.s.mode;
      h.run(DT);
      maxAir = Math.max(maxAir, h.s.airTime);
      if (launchedAt < 0 && h.s.mode === 'airborne') launchedAt = i;
      if (h.s.mode === 'airborne') {
        closest.x = h.s.param.x;
        closest.t = h.s.param.t;
        h.wave.closestParam(h.s.p, closest, closest);
        h.wave.profile(closest.x, closest.t, S);
        h.wave.normal(closest.x, closest.t, n);
        minSigned = Math.min(minSigned, S.negate().add(h.s.p).dot(n));
      }
      if (modeBefore === 'airborne' && h.s.mode === 'riding') {
        landedJump = h.s.p.distanceTo(before) - h.s.v.length() * DT;
        break;
      }
    }
    expect(launchedAt).toBeGreaterThanOrEqual(0);
    expect(h.s.mode).toBe('riding');
    expect(maxAir).toBeGreaterThanOrEqual(0.3);
    expect(landedJump).toBeLessThanOrEqual(0.1);
    expect(minSigned).toBeGreaterThanOrEqual(-0.05);
    expect(h.events.some((e) => e.type === 'landed')).toBe(true);
  });

  it('a crest launch on the flat shoulder carries you over the back: kicked out, not a wipeout', () => {
    const h = setup();
    climbFast(h, 40, 18);
    h.run(3);
    expect(h.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
    expect(h.s.mode).toBe('kickedOut');
    expect(h.events.some((e) => e.type === 'kickedOut')).toBe(true);
    expect(h.events.some((e) => e.type === 'wipeout')).toBe(false);
  });

  it('too slow at the top of the face: no launch, clamps and slides back down', () => {
    const h = setup();
    climbFast(h, 15, 8);
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

  it('never rides where the surface normal points down', () => {
    const nrm = new Vector3();
    for (const x of [0, 2, 5, 10, 20, 40]) {
      for (const speed of [4, 8, 12, 18]) {
        const h = setup();
        climbFast(h, x, speed);
        for (let i = 0; i < 4 * 120; i++) {
          h.run(DT);
          // x < 0 is the floater domain: climbing the overhang there is the approach to a floater.
          if (h.s.mode === 'riding' && !h.s.floating && h.s.param.x >= h.cfg.physics.floaterMaxX) {
            expect(h.wave.normal(h.s.param.x, h.s.param.t, nrm).y, `x=${x} v=${speed} tick=${i}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
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
    h.s.v.set(3, 0, 0).addScaledVector(up, 5); // reaches the crest below launch speed
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
  });
});

describe('Surfer — floater continuity', () => {
  const CASES = [-1, -3].flatMap((x) => [8, 12, 18].map((v) => [x, v] as const));
  it.each(CASES)('floater at x=%d, %d m/s never teleports and keeps an upward frame', (x, speed) => {
    const h = setup();
    h.surfer.reset(x, 0.6);
    const n = h.wave.normal(x, 0.6);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(4, 0, 0).addScaledVector(up, speed);
    let worst = 0;
    let floatedTicks = 0;
    for (let i = 0; i < 4 * 120; i++) {
      const before = h.s.p.clone();
      const vBefore = h.s.v.length();
      h.run(DT);
      const step = h.s.p.distanceTo(before) - Math.max(vBefore, h.s.v.length()) * DT;
      worst = Math.max(worst, step);
      if (h.s.floating) {
        floatedTicks++;
        expect(h.s.normal.y, `tick ${i}`).toBeGreaterThan(0);
      }
      if (h.s.mode !== 'riding' && h.s.mode !== 'airborne') break;
    }
    expect(h.events.some((e) => e.type === 'floaterStart')).toBe(true);
    expect(floatedTicks).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(0.05);
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
