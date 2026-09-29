import { describe, expect, it } from 'vitest';
import { createCrowd, CROWD_BOUNDS, crowdLayout, dancerGeometry } from './crowd';

describe('crowd', () => {
  it('places 150 dancers deterministically inside the dance floor', () => {
    const a = crowdLayout();
    expect(a).toHaveLength(150);
    expect(crowdLayout()).toEqual(a);
    for (const d of a) {
      expect(d.x).toBeGreaterThanOrEqual(CROWD_BOUNDS.xMin);
      expect(d.x).toBeLessThanOrEqual(CROWD_BOUNDS.xMax);
      expect(d.z).toBeGreaterThanOrEqual(CROWD_BOUNDS.zMin);
      expect(d.z).toBeLessThanOrEqual(CROWD_BOUNDS.zMax);
    }
  });
  it('marks only arm vertices', () => {
    const g = dancerGeometry();
    const arm = g.getAttribute('aArm');
    let arms = 0;
    for (let i = 0; i < arm.count; i++) arms += arm.getX(i);
    expect(arms).toBe(72); // two boxes × 36 vertices
  });
  it('builds an instanced mesh with per-dancer offsets', () => {
    const { mesh, uniforms } = createCrowd(150);
    expect(mesh.count).toBe(150);
    expect(mesh.geometry.getAttribute('aOffset').count).toBe(150);
    expect(Object.keys(uniforms)).toEqual(['uBeatPhase', 'uEnergy', 'uDrop', 'uTime']);
  });
});
