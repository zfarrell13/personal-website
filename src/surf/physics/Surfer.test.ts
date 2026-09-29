import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
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

  it('carving toward the lip climbs the face', () => {
    const { s, run } = setup();
    run(1);
    const y0 = s.p.y;
    run(0.4, () => ({ carve: 1 }));
    expect(s.p.y).toBeGreaterThan(y0);
  });
});

describe('Surfer — air', () => {
  function climbFast(h: ReturnType<typeof setup>) {
    // Mid-face on the open shoulder, heading straight up the face at 12 m/s.
    h.surfer.reset(20, 0.3);
    const n = h.wave.normal(20, 0.3);
    const e1 = new Vector3(1, 0, 0);
    const up = new Vector3().crossVectors(n, e1).normalize();
    h.s.v.copy(up).multiplyScalar(12);
  }

  it('launches at the crest with enough upward speed', () => {
    const h = setup();
    climbFast(h);
    h.run(1);
    expect(h.events.some((e) => e.type === 'launched' && e.kind === 'crest')).toBe(true);
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
    h.s.v.set(3, 0, 0).addScaledVector(up, 7);
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
  });
});
