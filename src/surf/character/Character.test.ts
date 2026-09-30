import { describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import { SURF_CONFIG, SURFER_LOOK } from '../config';
import { DEG } from '../math/scalar';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { sideSign } from '../wave/mirror';
import { WaveShape } from '../wave/WaveShape';
import { Character, loadSurferRig, MAX_BOARD_TURN_RATE } from './Character';
import { buildProceduralRig } from './rig';

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
  it.each(['left', 'right'] as const)('rides regular (left foot forward) on a %s', (side) => {
    const { surfer, ch } = setup();
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
    const chest = new Vector3(1, 0, 0).transformDirection(ch.rig.model.matrixWorld);
    expect(Math.sign(chest.z)).toBe(side === 'left' ? 1 : -1);
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
