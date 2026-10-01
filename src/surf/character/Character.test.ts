import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { SURF_CONFIG, SURFER_LOOK } from '../config';
import { DEG } from '../math/scalar';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { sideSign } from '../wave/mirror';
import { WaveShape } from '../wave/WaveShape';
import { Character, loadSurferRig, MAX_BOARD_TURN_RATE } from './Character';
import { buildProceduralRig } from './rig';
import { TEST_RIGS } from './testRigs';

function setup() {
  const cfg = structuredClone(SURF_CONFIG);
  const surfer = new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>());
  const ch = new Character(buildProceduralRig(SURFER_LOOK), SURFER_LOOK);
  return { surfer, ch };
}

describe('Character', () => {
  it('sits on the surfer contact point with the board up = surface normal and feet on the deck', () => {
    const { surfer, ch } = setup();
    for (let i = 0; i < 120; i++) {
      surfer.step(NO_INPUT, 1 / 120);
      ch.update(surfer, 1, 1 / 120);
    }
    expect(ch.root.position.distanceTo(surfer.state.p)).toBeLessThan(1e-6);
    const boardUp = new Vector3(0, 1, 0).applyQuaternion(ch.root.quaternion);
    expect(boardUp.dot(surfer.state.normal)).toBeGreaterThan(0.95);
    ch.root.updateMatrixWorld(true);
    const foot = ch.rig.bones.LeftFoot.getWorldPosition(new Vector3());
    const local = ch.root.worldToLocal(foot);
    expect(local.y).toBeGreaterThan(0.05);
    expect(local.y).toBeLessThan(0.25);
  });

  it('turns the rendered board toward the heading at a capped rate (hides near-curl heading jumps)', () => {
    const { surfer, ch } = setup();
    const dt = 1 / 120;
    for (let i = 0; i < 120; i++) {
      surfer.step(NO_INPUT, dt);
      ch.update(surfer, 1, dt);
    }
    const s = surfer.state;
    const fwd = () => new Vector3(0, 0, 1).applyQuaternion(ch.root.quaternion);
    const before = fwd();
    // An 85° heading jump in one tick (the rare bottom-out flip).
    s.heading.applyAxisAngle(s.normal, 85 * DEG);
    surfer.prevHeading.copy(s.heading);
    ch.update(surfer, 1, dt);
    expect(fwd().angleTo(before) / DEG).toBeLessThanOrEqual(MAX_BOARD_TURN_RATE * dt + 0.5);
    for (let i = 0; i < 60; i++) ch.update(surfer, 1, dt);
    expect(fwd().angleTo(s.heading) / DEG).toBeLessThan(2);
  });

  it('keeps the surface-normal frame and no spin during a silent floater air', () => {
    const { surfer, ch } = setup();
    for (let i = 0; i < 60; i++) {
      surfer.step(NO_INPUT, 1 / 120);
      ch.update(surfer, 1, 1 / 120);
    }
    const s = surfer.state;
    s.mode = 'airborne';
    s.launchKind = null;
    s.airYaw = 2;
    s.normal.set(0.6, 0.8, 0).normalize();
    for (let i = 0; i < 60; i++) ch.update(surfer, 1, 1 / 60);
    const up = new Vector3(0, 1, 0).applyQuaternion(ch.root.quaternion);
    expect(up.dot(s.normal)).toBeGreaterThan(0.95);
  });

  it('resets the wipeout tumble once riding again', () => {
    const { surfer, ch } = setup();
    surfer.state.mode = 'wipeout';
    for (let i = 0; i < 60; i++) ch.update(surfer, 1, 1 / 60);
    surfer.state.mode = 'riding';
    ch.update(surfer, 1, 1 / 60);
    ch.update(surfer, 1, 1 / 60);
    surfer.state.mode = 'wipeout';
    ch.update(surfer, 1, 1 / 60);
    // a fresh tumble starts from ~0 rad (7 rad/s * 1/60), not the accumulated ~7 rad
    const angle = 2 * Math.acos(Math.min(1, Math.abs((ch as unknown as { tilt: { quaternion: { w: number } } }).tilt.quaternion.w)));
    expect(angle).toBeLessThan(0.5);
  });

  it('dispose releases geometry, materials and the deck texture', () => {
    const { ch } = setup();
    const spies = [
      vi.spyOn(ch.board.geometry, 'dispose'),
      vi.spyOn(ch.rig.mesh.geometry, 'dispose'),
      vi.spyOn(ch.rig.mesh.material as never as { dispose(): void }, 'dispose'),
      ...(ch.board.material as { dispose(): void }[]).map((m) => vi.spyOn(m, 'dispose')),
    ];
    ch.dispose();
    for (const sp of spies) expect(sp).toHaveBeenCalled();
  });
});

describe('Character stance', () => {
  // Rendered as in the game: the character inside the frame group, which mirrors x on a RIGHT.
  it.each(TEST_RIGS.flatMap(([name, make]) => (['left', 'right'] as const).map((side) => [name, side, make] as const)))('%s rig rides regular (left foot forward) on a %s', async (_name, side, make) => {
    const cfg = structuredClone(SURF_CONFIG);
    const surfer = new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>());
    const ch = new Character(await make(), SURFER_LOOK);
    const frame = new Group();
    frame.scale.x = sideSign(side);
    frame.add(ch.root);
    ch.setSide(side);
    for (let i = 0; i < 120; i++) {
      surfer.step(NO_INPUT, 1 / 120);
      ch.update(surfer, 1, 1 / 120);
    }
    frame.updateMatrixWorld(true);
    const nose = new Vector3(0, 0, 1).transformDirection(ch.board.matrixWorld);
    // Under a net mirror (negative determinant) the bone named RightFoot is the rider's actual left foot.
    const mirrored = ch.rig.model.matrixWorld.determinant() < 0;
    const b = ch.rig.bones;
    const left = (mirrored ? b.RightFoot : b.LeftFoot).getWorldPosition(new Vector3());
    const right = (mirrored ? b.LeftFoot : b.RightFoot).getWorldPosition(new Vector3());
    expect(left.sub(right).dot(nose)).toBeGreaterThan(0.3);
    // Regular = backside on a left (chest to the beach, +z), frontside on a right (chest to the wave).
    // Bent knees point the way the rider faces: knee minus the hip–ankle midpoint.
    const w = (n: 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot') => b[n].getWorldPosition(new Vector3());
    const facing = w('LeftLeg').sub(w('LeftUpLeg').add(w('LeftFoot')).multiplyScalar(0.5));
    expect(Math.sign(facing.z)).toBe(side === 'left' ? 1 : -1);
  });
});

describe('loadSurferRig', () => {
  it('falls back to the procedural rig when the load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await loadSurferRig(SURFER_LOOK, 'http://127.0.0.1:9/nope.glb');
    expect(r.procedural).toBe(true);
    expect(r.rig.mesh).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe.each(TEST_RIGS)('the lip lean on the %s rig (playtest 5: the steeper the face, the further he lays back, out away from the wave)', (_name, makeRig) => {
  const UP = new Vector3(0, 1, 0);
  /** A face normal of this steepness (sin of the face angle), tilted toward shore (+z). */
  const faceNormal = (steep: number) => {
    const a = Math.asin(Math.min(1, steep));
    return new Vector3(0, Math.cos(a), Math.sin(a));
  };

  async function rider(side: 'left' | 'right') {
    const cfg = structuredClone(SURF_CONFIG);
    const surfer = new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>());
    const ch = new Character(await makeRig(), SURFER_LOOK);
    ch.setSide(side);
    const s = surfer.state;
    /** `heading` 'line': down the line (+x); 'up': straight up the face. */
    const place = (n: Vector3, heading: 'line' | 'up', turnRate: number) => {
      s.mode = 'riding';
      s.turnRate = turnRate;
      s.normal.copy(n);
      if (heading === 'line') s.heading.set(1, 0, 0);
      else s.heading.set(0, n.z, -n.y); // up the face: n × x̂
      s.v.copy(s.heading).multiplyScalar(8);
      surfer.prevHeading.copy(s.heading);
      surfer.prevP.copy(s.p);
    };
    /**
     * Rides there for `frames` at 60 fps; returns the upper body's line (Spine → Head, unit) in the frame —
     * the part that lays back (running up the face the legs stay planted and the lay-back is at the Spine).
     */
    const ride = (n: Vector3, heading: 'line' | 'up' = 'line', turnRate = 0, frames = 60) => {
      for (let i = 0; i < frames; i++) {
        place(n, heading, turnRate);
        ch.update(surfer, 1, 1 / 60);
      }
      ch.root.updateMatrixWorld(true);
      const b = ch.rig.bones;
      return b.Head.getWorldPosition(new Vector3()).sub(b.Spine.getWorldPosition(new Vector3())).normalize();
    };
    return { ch, s, surfer, ride };
  }

  it.each([
    ['right', 'line'],
    ['left', 'line'],
    ['right', 'up'],
    ['left', 'up'],
  ] as const)('%s, heading %s: the lay-back grows with steepness from ≈ 0, out away from world up, to 30–40° on a near-vertical face', async (side, heading) => {
    const { ch, ride } = await rider(side);
    let prev = -1;
    for (const st of [0, 0.15, 0.3, 0.5, 0.7, 0.85, 0.98]) {
      const n = faceNormal(st);
      ch.leanScale = 0;
      const plain = ride(n, heading);
      ch.leanScale = 1;
      const leaned = ride(n, heading);
      const lay = leaned.angleTo(plain) / DEG;
      expect(lay).toBeGreaterThanOrEqual(prev - 0.3);
      prev = lay;
      if (st <= 0.3) expect(lay).toBeLessThan(3);
      if (st >= 0.5) expect(leaned.dot(UP)).toBeLessThan(plain.dot(UP)); // tipped away from up (out, off the face)
      if (st === 0.98) {
        expect(lay).toBeGreaterThan(25);
        expect(lay).toBeLessThan(42);
      }
    }
  });

  it.each(['right', 'left'] as const)('%s: the lean comes on top of the rail bank — the bank is kept on gentle and steep faces, with no jump as the lean comes in', async (side) => {
    const { ch, ride } = await rider(side);
    for (const st of [0.1, 0.25, 0.6, 0.9]) {
      const n = faceNormal(st);
      const body = (scale: number, turnRate: number) => {
        ch.leanScale = scale;
        return ride(n, 'line', turnRate);
      };
      const [plain, plainBanked, leaned, leanedBanked] = [body(0, 0), body(0, 2.5), body(1, 0), body(1, 2.5)];
      // The bank turns the body as much with the lean as without it (the lean never cancels it) …
      expect(Math.abs(leanedBanked.angleTo(leaned) - plainBanked.angleTo(plain)) / DEG).toBeLessThan(4);
      expect(plainBanked.angleTo(plain) / DEG).toBeGreaterThan(20);
      // … and the lay-back is as big banked as straight.
      expect(Math.abs(leanedBanked.angleTo(plainBanked) - leaned.angleTo(plain)) / DEG).toBeLessThan(4);
    }
    ch.leanScale = 1;
    // Across the steepness where the lean starts, a banked rider's line moves smoothly.
    let prev = ride(faceNormal(0.15), 'line', 2.5);
    for (let st = 0.16; st <= 0.4; st += 0.01) {
      const b = ride(faceNormal(st), 'line', 2.5);
      expect(b.angleTo(prev) / DEG).toBeLessThan(1.5);
      prev = b;
    }
  });

  it.each([
    ['right', 'line'],
    ['left', 'line'],
    ['right', 'up'],
    ['left', 'up'],
  ] as const)('%s, heading %s: the feet stay planted and the soles flat on the deck however far he lays back', async (side, heading) => {
    const { ch, ride } = await rider(side);
    const feet = () => {
      ch.root.updateMatrixWorld(true);
      return [ch.rig.bones.LeftFoot, ch.rig.bones.RightFoot].map((b) => {
        const m = new Matrix4().copy(ch.root.matrixWorld).invert().multiply(b.matrixWorld);
        const pos = new Vector3();
        const q = new Quaternion();
        m.decompose(pos, q, new Vector3());
        return { pos, q };
      });
    };
    for (const turnRate of [0, 2.5]) {
      ch.leanScale = 0;
      ride(faceNormal(0.9), heading, turnRate);
      const plain = feet();
      ch.leanScale = 1;
      ride(faceNormal(0.9), heading, turnRate);
      const leaned = feet();
      for (let k = 0; k < 2; k++) {
        expect(leaned[k]!.pos.distanceTo(plain[k]!.pos)).toBeLessThan(0.005); // planted
        // The sole as flat on the deck as unleaned (exact on the procedural rig; the glTF rig's bone
        // scales leave ≈ 0.5° in the matrix decomposition).
        expect(leaned[k]!.q.angleTo(plain[k]!.q) / DEG).toBeLessThan(1);
      }
    }
  });

  it('on the real wave, the steeper the face the further the lay-back carries the head from the water (riding the pocket face)', async () => {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
    const s = surfer.state;
    const ch = new Character(await makeRig(), SURFER_LOOK);
    ch.setSide('right');
    const pts: Vector3[] = [];
    for (let x = -4; x <= 10; x += 0.25) for (let t = 0; t <= 1; t += 0.01) pts.push(wave.profile(x, t));
    const headClearance = (t: number, scale: number) => {
      ch.leanScale = scale;
      const sx = new Vector3();
      for (let i = 0; i < 60; i++) {
        s.mode = 'riding';
        s.turnRate = 0;
        s.param.x = 2;
        s.param.t = t;
        wave.profile(2, t, s.p);
        wave.normal(2, t, s.normal);
        wave.tangents(2, t, sx, new Vector3());
        s.heading.copy(sx.normalize());
        s.v.copy(s.heading).multiplyScalar(8);
        surfer.prevP.copy(s.p);
        surfer.prevHeading.copy(s.heading);
        ch.update(surfer, 1, 1 / 60);
      }
      ch.root.updateMatrixWorld(true);
      const head = ch.rig.bones.Head.getWorldPosition(new Vector3());
      return Math.min(...pts.map((q) => q.distanceTo(head)));
    };
    // Rideable face rows of the pocket column (n.y ≥ 0.2), gentle to steep.
    const rows = [0.2, 0.3, 0.4, 0.45].filter((t) => wave.normal(2, t).y >= 0.2);
    const gains = rows.map((t) => ({ steep: wave.steepness(2, t), gain: headClearance(t, 1) - headClearance(t, 0) }));
    expect(gains.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!.steep).toBeGreaterThan(gains[i - 1]!.steep);
    expect(Math.abs(gains[0]!.gain)).toBeLessThan(0.05); // gentle: about nothing
    expect(gains[gains.length - 1]!.gain).toBeGreaterThan(0.2); // steep: clearly farther out
    for (let i = 1; i < gains.length; i++) expect(gains[i]!.gain).toBeGreaterThanOrEqual(gains[i - 1]!.gain - 0.06);
  });

  it('no snapping: a face end tipping the normal in one tick eases the lean in over a few frames', async () => {
    const { ch, ride } = await rider('right');
    ride(faceNormal(0));
    let prev = ch.leanAngle;
    let maxStep = 0;
    for (let i = 0; i < 40; i++) {
      ride(faceNormal(0.98), 'line', 0, 1);
      maxStep = Math.max(maxStep, Math.abs(ch.leanAngle - prev));
      prev = ch.leanAngle;
    }
    expect(ch.leanAngle).toBeGreaterThan(25 * DEG);
    expect(maxStep).toBeLessThan(0.25 * ch.leanAngle + 1e-6);
  });

  it('no lean in a trick air (it eases out)', async () => {
    const { ch, s, ride } = await rider('right');
    ride(faceNormal(0.98));
    expect(ch.leanAngle).toBeGreaterThan(25 * DEG);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    for (let i = 0; i < 60; i++) ch.update({ state: s, prevP: s.p, prevHeading: s.heading, wave: { crestY: () => 2.4 } } as never, 1, 1 / 60);
    expect(Math.abs(ch.leanAngle)).toBeLessThan(1 * DEG);
  });
});
