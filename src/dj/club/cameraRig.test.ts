import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, lerpPose, POSES, smoothstep } from './cameraRig';

describe('camera rig', () => {
  it('eases with smoothstep', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(lerpPose(POSES.closeup, POSES.room, 1)).toEqual(POSES.room);
  });
  it('dollies to the room pose in 0.8 s', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.setTarget('room');
    rig.update(0.4);
    expect(cam.position.z).toBeGreaterThan(POSES.room.position[2]);
    expect(cam.position.z).toBeLessThan(POSES.closeup.position[2]);
    rig.update(0.4);
    expect(cam.position.toArray()).toEqual(POSES.room.position);
  });
  it('eases the under-the-truss amount with the dolly (1 close-up/BROWSE, 0 room)', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera());
    expect(rig.underTruss).toBe(1);
    expect(rig.dollying).toBe(false);
    rig.setTarget('room');
    rig.update(0.4);
    expect(rig.dollying).toBe(true);
    expect(rig.underTruss).toBeCloseTo(0.5, 6);
    rig.update(0.4);
    expect(rig.underTruss).toBe(0);
    expect(rig.dollying).toBe(false);
    rig.setTarget('browse0');
    rig.update(0.2);
    const mid = rig.underTruss;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    // retarget mid-move: continues from the current amount, no jump
    rig.setTarget('room');
    rig.update(0);
    expect(rig.underTruss).toBeCloseTo(mid, 9);
  });
});
