import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { cameraGoal } from '../camera/CameraRig';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { mulberry32 } from '../math/random';
import { WaveShape } from '../wave/WaveShape';
import { ATTRACT_PARTICLES, BOARD_SPRAY, DROP_MIN_SIZE, MAX_POINT_FRACTION, NEAR_FADE, NEAR_SHRINK, Particles, PARTICLE_RATES } from './Particles';

function alive(p: Particles, filter: (x: number, y: number, z: number) => boolean): number {
  const { pos, life } = p.pool;
  let n = 0;
  for (let i = 0; i < life.length; i++) if (life[i]! > 0 && filter(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)) n++;
  return n;
}

/** Seeded: every run spawns the same drops (failures reproduce). */
function setup(seed = 7) {
  const cfg = structuredClone(SURF_CONFIG);
  const wave = new WaveShape(cfg.wave);
  const bus = new EventBus<SurfEvent>();
  const surfer = new Surfer(wave, cfg.physics, bus);
  const p = new Particles(wave, bus, surfer.state, mulberry32(seed));
  return { cfg, wave, bus, surfer, p };
}

describe('Particles — the crashing wave', () => {
  it('keeps a falling-lip curtain, impact explosions and shoulder feathering alive, all driven by the given dt', () => {
    const { cfg, wave, p } = setup();
    for (let i = 0; i < 60; i++) p.update(1 / 60, false);
    const D = cfg.wave.tubeDepth;
    // Curtain + explosions over the impact zone; spray above the trough there.
    expect(alive(p, (x) => x >= -D - 3 && x <= 0)).toBeGreaterThan(150);
    expect(alive(p, (x, y) => x >= -D - 3 && x <= 0 && y > 1.5)).toBeGreaterThan(20);
    // Feathering along the shoulder crest.
    expect(alive(p, (x, y) => x > 4 && x < cfg.wave.shoulderLength && y > wave.crestY(x) - 0.3)).toBeGreaterThan(20);
    // Paused: dt = 0 spawns and moves nothing.
    const before = Float32Array.from(p.pool.pos);
    p.update(0, false);
    expect(p.pool.pos).toEqual(before);
    p.dispose();
  });

  it('never hangs a curtain over the barrel eye: the view down the line from the tube camera stays clear of spray', () => {
    const { wave, p } = setup();
    const up = (5 * Math.PI) / 180;
    const dir = new Vector3(1, Math.tan(up), 0).normalize();
    const cone = Math.cos((4 * Math.PI) / 180);
    const poses = [-4, -3, -2, -1].flatMap((x) =>
      [0.2, 0.4, 0.55].map((frac) => {
        let t = 0;
        while (wave.profile(x, t).y < frac * wave.crestY(x)) t += 0.001;
        const at = wave.profile(x, t);
        return cameraGoal({ p: at, normal: wave.normal(x, t), heading: new Vector3(1, 0, 0), mode: 'riding', launchKind: null }, 'left', 'tube', wave, { pos: new Vector3(), look: new Vector3() }).pos;
      }),
    );
    const d = new Vector3();
    let worst = 0;
    for (let f = 0; f < 240; f++) {
      p.update(1 / 60, false);
      if (f < 90) continue;
      for (const cam of poses) {
        const n = alive(p, (x, y, z) => {
          d.set(x - cam.x, y - cam.y, z - cam.z);
          const len = d.length();
          return len > NEAR_FADE[1] && len < 15 && d.dot(dir) > cone * len;
        });
        worst = Math.max(worst, n);
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
    p.dispose();
  });
});

describe('Particles — near the lens', () => {
  it('fades spray right at the camera and caps the point size to a fraction of the render height', () => {
    const { p } = setup();
    const cam = new PerspectiveCamera(62, 16 / 9, 0.1, 650);
    p.setScale(cam, 448);
    expect(p.points.material.uniforms.uMaxSize!.value).toBeCloseTo(448 * MAX_POINT_FRACTION, 9);
    expect(p.points.material.vertexShader).toContain('smoothstep(uNearFade.x, uNearFade.y, -mvPosition.z)');
    expect(p.points.material.vertexShader).toContain('smoothstep(uNearShrink.x, uNearShrink.y, -mvPosition.z)');
    expect(nearRanges(p)).toEqual({ fade: [...NEAR_FADE], shrink: [...NEAR_SHRINK] });
    // Dying and near-lens drops shrink (they stay white), capped to a fraction of the render height.
    expect(p.points.material.vertexShader).toContain(`clamp(aSize * (${DROP_MIN_SIZE.toFixed(2)} + ${(1 - DROP_MIN_SIZE).toFixed(2)} * aAlpha) * nearShrink * uScale / -mvPosition.z, 1.0, uMaxSize)`);
    p.dispose();
  });
});

const nearRanges = (p: Particles) => {
  const u = p.points.material.uniforms;
  return { fade: (u.uNearFade!.value as Vector2).toArray(), shrink: (u.uNearShrink!.value as Vector2).toArray() };
};

describe('Particles — attract mode (the dimmed wave behind a site page)', () => {
  it('pushes near spray far out, keeps points small and thins the lip curtain and feathering', () => {
    const { p } = setup();
    p.setScale(new PerspectiveCamera(62, 16 / 9, 0.1, 650), 448);
    p.setAttract(true);
    expect(nearRanges(p)).toEqual({ fade: [...ATTRACT_PARTICLES.nearFade], shrink: [...ATTRACT_PARTICLES.nearShrink] });
    expect(ATTRACT_PARTICLES.nearFade[0]).toBeGreaterThanOrEqual(4);
    expect(p.points.material.uniforms.uMaxSize!.value).toBeCloseTo(448 * ATTRACT_PARTICLES.maxPointFraction, 9);
    // A later resize keeps the attract cap.
    p.setScale(new PerspectiveCamera(62, 16 / 9, 0.1, 650), 300);
    expect(p.points.material.uniforms.uMaxSize!.value).toBeCloseTo(300 * ATTRACT_PARTICLES.maxPointFraction, 9);
    p.dispose();
  });

  it('spawns fewer lip and feather drops, and still keeps the impact plume', () => {
    const { cfg, wave, p: play } = setup();
    const { p: attract } = setup();
    attract.setAttract(true);
    for (let i = 0; i < 60; i++) {
      play.update(1 / 60, false);
      attract.update(1 / 60, false);
    }
    const feather = (x: number, y: number) => x > 5 && x < cfg.wave.shoulderLength && y > wave.crestY(x) - 0.3;
    expect(alive(attract, feather)).toBeLessThan(alive(play, feather) * 0.6);
    expect(alive(attract, (x) => x >= -cfg.wave.tubeDepth - 3 && x <= 0)).toBeGreaterThan(60);
    expect(PARTICLE_RATES.lip).toBe(240); // play-mode rates are constants, untouched
    play.dispose();
    attract.dispose();
  });

  it('switching attract off restores the play-mode look exactly (uniforms and spawn stream)', () => {
    const cam = new PerspectiveCamera(62, 16 / 9, 0.1, 650);
    const { p: fresh } = setup(11);
    const { p: toggled } = setup(11);
    fresh.setScale(cam, 448);
    toggled.setScale(cam, 448);
    toggled.setAttract(true);
    toggled.setAttract(false);
    expect(nearRanges(toggled)).toEqual(nearRanges(fresh));
    expect(toggled.points.material.uniforms.uMaxSize!.value).toBe(fresh.points.material.uniforms.uMaxSize!.value);
    for (let i = 0; i < 30; i++) {
      fresh.update(1 / 60, false);
      toggled.update(1 / 60, false);
    }
    expect(toggled.pool.pos).toEqual(fresh.pool.pos);
    fresh.dispose();
    toggled.dispose();
  });
});

describe('Particles — board spray', () => {
  /** Rider out on the open face past the shoulder (clear of the crashing-wave emitters), running down the line. */
  function ride(speed: number, turnRate: number, carve: number) {
    const { wave, surfer, bus, p } = setup();
    const s = surfer.state;
    const x = 70;
    const t = 0.35;
    s.mode = 'riding';
    wave.profile(x, t, s.p);
    wave.normal(x, t, s.normal);
    s.heading.set(1, 0, 0);
    s.v.set(speed, 0, 0);
    s.turnRate = turnRate;
    s.carve = carve;
    s.stalling = false;
    const near = () => alive(p, (px, py, pz) => Math.hypot(px - s.p.x, py - s.p.y, pz - s.p.z) < 5);
    return { s, bus, p, near };
  }

  it('throws a rooster tail on a hard cutback: at least 3× the spray of gentle riding, higher and off the outside rail', () => {
    const gentle = ride(9, 0.1, 0);
    const hard = ride(9, 2.6, 1);
    for (let i = 0; i < 15; i++) {
      gentle.p.update(1 / 60, true);
      hard.p.update(1 / 60, true);
    }
    const g = gentle.near();
    const h = hard.near();
    expect(g).toBeGreaterThan(0);
    expect(h).toBeGreaterThanOrEqual(3 * g);
    // The fan rises well above the rail.
    const high = alive(hard.p, (_x, y) => y > hard.s.p.y + 0.8);
    expect(high).toBeGreaterThan(10);
    // Thrown off the outside of the turn: turning +yaw about the normal (to the left of the heading
    // on the face), the spray goes the other way (−(n × heading)).
    const outside = new Vector3().crossVectors(hard.s.normal, hard.s.heading).multiplyScalar(-1);
    let sum = 0;
    const { pos, life } = hard.p.pool;
    for (let i = 0; i < life.length; i++) {
      if (life[i]! <= 0) continue;
      if (Math.hypot(pos[i * 3]! - hard.s.p.x, pos[i * 3 + 1]! - hard.s.p.y, pos[i * 3 + 2]! - hard.s.p.z) > 5) continue;
      sum += (pos[i * 3]! - hard.s.p.x) * outside.x + (pos[i * 3 + 1]! - hard.s.p.y) * outside.y + (pos[i * 3 + 2]! - hard.s.p.z) * outside.z;
    }
    expect(sum).toBeGreaterThan(0);
    gentle.p.dispose();
    hard.p.dispose();
  });

  it('keeps the tail down under the tube camera (it sits right behind the rider)', () => {
    const open = ride(9, 2.6, 1);
    const tube = ride(9, 2.6, 1);
    tube.p.tubeView = true;
    for (let i = 0; i < 15; i++) {
      open.p.update(1 / 60, true);
      tube.p.update(1 / 60, true);
    }
    expect(tube.near()).toBeLessThan(0.5 * open.near());
    open.p.dispose();
    tube.p.dispose();
  });

  it('bursts on a genuine cutback (the board reverses its run along the wave while carving), not on every carve event', () => {
    const r = ride(9, 2.2, 1);
    r.p.update(1 / 60, true); // running down the line (+x)
    const before = r.near();
    r.bus.emit({ type: 'carve', time: 1, degrees: 60 }); // a combo carve alone throws no burst
    expect(r.near()).toBe(before);
    r.s.heading.set(-1, 0, 0); // turned back toward the curl
    r.p.update(1 / 60, true);
    expect(r.near() - before).toBeGreaterThanOrEqual(BOARD_SPRAY.cutbackBurst);
    // Running back the same way again is no new cutback.
    const after = r.near();
    r.p.update(1 / 60, true);
    expect(r.near() - after).toBeLessThan(BOARD_SPRAY.cutbackBurst / 2);
    r.p.dispose();
  });

  it('bursts on a snap / lip turn (event-driven)', () => {
    const r = ride(9, 0, 0);
    const before = r.near();
    r.bus.emit({ type: 'snap', time: 1 });
    expect(r.near() - before).toBeGreaterThanOrEqual(BOARD_SPRAY.snapBurst);
    r.p.dispose();
  });
});
