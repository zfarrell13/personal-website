import { describe, expect, it } from 'vitest';
import { Color, Mesh, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, Vector3, type Fog } from 'three';
import { CAMERA_FAR } from '../camera/CameraRig';
import { FOG_CONFIG } from '../config';
import { Environment, SKY_RADIUS } from './Environment';
import { SKY, skyColor, skyUniforms } from './sky';
import { injectWaveShader, makeFoamTexture } from './waveMaterial';

const fogColor = new Color(FOG_CONFIG.color);

describe('sky gradient', () => {
  it('is exactly the fog colour at the horizon (elevation 0) and below it', () => {
    expect(skyColor(0).equals(fogColor)).toBe(true);
    expect(skyColor(-0.2).equals(fogColor)).toBe(true);
    expect(skyColor(-1).equals(fogColor)).toBe(true);
  });

  it('clears from the haze to the zenith as it rises', () => {
    const lum = (e: number) => {
      const c = skyColor(e);
      return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    };
    for (let e = 0.05; e <= 1; e += 0.05) expect(lum(e)).toBeLessThanOrEqual(lum(e - 0.05) + 1e-9);
    const top = skyColor(1);
    expect(top.r).toBeCloseTo(SKY.zenith.r, 6);
    expect(top.g).toBeCloseTo(SKY.zenith.g, 6);
    expect(top.b).toBeCloseTo(SKY.zenith.b, 6);
    // Gradual near the horizon: no step between neighbouring elevations.
    for (let e = 0; e < 0.3; e += 0.005) {
      const a = skyColor(e);
      const b = skyColor(e + 0.005);
      expect(Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))).toBeLessThan(0.01);
    }
  });
});

describe('sky dome, fog and water reflection agree', () => {
  it('the scene fog, the dome shader horizon and the water reflection horizon are one colour', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(62, 16 / 9, 0.1, CAMERA_FAR);
    const env = new Environment(scene, camera);
    expect((scene.fog as Fog).color.equals(fogColor)).toBe(true);
    // The clear colour (never visible behind the dome) is the fog colour too.
    expect((scene.background as Color).equals(fogColor)).toBe(true);

    const dome = scene.children.find((o): o is Mesh => o instanceof Mesh && o.geometry instanceof SphereGeometry)!;
    const mat = dome.material as ShaderMaterial;
    expect(mat.uniforms.uHaze!.value.equals(fogColor)).toBe(true);
    expect(mat.fragmentShader).toContain('skyGradient(d.y)');
    // A full sphere inside the far plane: it covers every direction, so the clear colour never shows.
    const g = (dome.geometry as SphereGeometry).parameters;
    expect(g.phiLength).toBeCloseTo(Math.PI * 2);
    expect(g.thetaLength).toBeCloseTo(Math.PI);
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR);

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <color_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>',
    };
    injectWaveShader(shader as never, { uTime: { value: 0 }, uPeel: { value: 7 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() } });
    expect(shader.uniforms.uHaze).toBe(skyUniforms.uHaze);
    expect(shader.uniforms.uHaze).toBe(mat.uniforms.uHaze);
    expect(shader.fragmentShader).toContain('skyGradient(dot(reflect(-V, N), up))');
    env.dispose();
  });
});
