import { describe, expect, it } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, type Material } from 'three';
import { Environment } from './Environment';

describe('Environment underwater cut', () => {
  it('swaps to the underwater fog/background, hides the sky and sun, and restores them', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 650);
    const env = new Environment(scene, camera);
    const surfaceFog = scene.fog;
    const surfaceBg = scene.background;
    const visible = () => scene.children.filter((o) => o.type === 'Mesh' || o.type === 'Sprite').map((o) => o.visible);
    expect(visible().every(Boolean)).toBe(true);

    env.setUnderwater(true);
    env.update(0, 0, 1);
    expect(scene.fog).not.toBe(surfaceFog);
    expect(scene.fog!.color.getHexString()).toBe('0b3b66');
    expect(scene.background).not.toBe(surfaceBg);
    expect(visible().some(Boolean)).toBe(false);
    expect(camera.children.every((f) => !f.visible)).toBe(true);

    env.setUnderwater(false);
    expect(scene.fog).toBe(surfaceFog);
    expect(scene.background).toBe(surfaceBg);
    expect(visible().every(Boolean)).toBe(true);

    env.setUnderwater(true);
    env.dispose();
    expect(scene.fog).toBeNull();
  });
});

describe('Environment water', () => {
  it('draws no water surface of its own (the wave mesh is the one ocean) and an opaque sea floor under it', () => {
    const scene = new Scene();
    const env = new Environment(scene, new PerspectiveCamera(60, 1, 0.1, 650));
    const meshes: Mesh[] = [];
    env.frameStuff.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.filter((m) => (m.material as Material).transparent)).toEqual([]);
    const floor = meshes.find((m) => m.name === 'seaFloor');
    expect(floor).toBeDefined();
    expect(floor!.position.y).toBeLessThan(-4);
    env.dispose();
  });
});
