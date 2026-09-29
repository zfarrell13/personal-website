import { describe, expect, it } from 'vitest';
import { ClubDirector, type DirectorState } from './ClubDirector';
import { Lights } from './lights';

const state = (over: Partial<DirectorState>): DirectorState => ({ ...new ClubDirector().state, ...over });
const headRotations = (l: Lights) => {
  const out: number[] = [];
  l.group.traverse((o) => {
    if (o.type === 'Object3D') out.push(o.rotation.z, o.rotation.x);
  });
  return out;
};

describe('Lights', () => {
  it('blends the moving-head sweep when playback starts and stops (no snap)', () => {
    const l = new Lights();
    const dt = 1 / 60;
    let time = 10;
    const idle = state({ idle: true });
    const live = state({ idle: false, energy: 0.8, barPhase: 0.6, beatPhase: 0.4 });
    for (let k = 0; k < 120; k++) l.update(idle, (time += dt), dt);
    const before = headRotations(l);
    l.update(live, (time += dt), dt);
    const after = headRotations(l);
    for (let i = 0; i < before.length; i++) expect(Math.abs(after[i]! - before[i]!)).toBeLessThan(0.05);
    for (let k = 0; k < 120; k++) l.update(live, (time += dt), dt);
    const liveA = headRotations(l);
    l.update(idle, (time += dt), dt);
    const idleA = headRotations(l);
    for (let i = 0; i < liveA.length; i++) expect(Math.abs(idleA[i]! - liveA[i]!)).toBeLessThan(0.05);
    l.dispose();
  });

  it('close-up mode draws the beam cones front-side only and fainter', () => {
    const l = new Lights();
    const live = state({ idle: false, energy: 1 });
    l.update(live, 1, 1 / 60);
    const cones = () => {
      const mats: { opacity: number; side: number }[] = [];
      l.group.traverse((o) => {
        if (o.parent && o.parent.type === 'Object3D' && 'material' in o) mats.push(o.material as { opacity: number; side: number });
      });
      return mats;
    };
    const roomOpacity = cones()[0]!.opacity;
    l.setCloseup(true);
    l.update(live, 1, 1 / 60);
    expect(cones()).toHaveLength(6);
    for (const m of cones()) {
      expect(m.side).toBe(0); // THREE.FrontSide
      expect(m.opacity).toBeLessThan(roomOpacity * 0.6);
    }
    l.dispose();
  });
});
