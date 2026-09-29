import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DRIVEN_BONES, regionFor, TARGET_HEIGHT } from './rig';
import { boneWorld, TEST_RIGS } from './testRigs';

describe.each(TEST_RIGS)('%s rig', (_name, make) => {
  it('has every driven bone, is ~1.75 m tall, faces +x with its left toward −z', async () => {
    const rig = await make();
    for (const b of DRIVEN_BONES) expect(rig.bones[b]).toBeDefined();
    expect(boneWorld(rig, 'Head').y).toBeGreaterThan(TARGET_HEIGHT * 0.78);
    expect(boneWorld(rig, 'Head').y).toBeLessThan(TARGET_HEIGHT);
    expect(boneWorld(rig, 'LeftHand').z).toBeLessThan(-0.5);
    expect(boneWorld(rig, 'LeftFoot').y).toBeLessThan(0.15);
    expect(rig.mesh.geometry.getAttribute('color')).toBeDefined();
  });
});

describe('regionFor', () => {
  it('maps bones and head height to outfit regions', () => {
    expect(regionFor('Spine1', new Vector3(), 1.6)).toBe('top');
    expect(regionFor('LeftUpLeg', new Vector3(), 1.6)).toBe('shorts');
    expect(regionFor('LeftLeg', new Vector3(), 1.6)).toBe('skin');
    expect(regionFor('Head', new Vector3(0.05, 1.7, 0), 1.6)).toBe('hair');
    expect(regionFor('Head', new Vector3(0.1, 1.58, 0), 1.6)).toBe('skin');
    expect(regionFor('Head', new Vector3(-0.08, 1.58, 0), 1.6)).toBe('hair');
  });
});
