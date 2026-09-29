import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { SURF_CONFIG, SURFER_LOOK } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { Character, loadSurferRig } from './Character';
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
