import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
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
