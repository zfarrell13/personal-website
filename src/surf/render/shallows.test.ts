import { describe, expect, it } from 'vitest';
import { BufferGeometry, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Environment, fadeUnderwaterIntoFog } from './Environment';
import { seaReflection } from './sky';
import { SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { CAUSTIC_REPEAT, createSandMaterial, makeRippleTexture, SAND_PROFILE, SHALLOWS, SHALLOWS_GLSL, sandY, shallowClarity, waterOpacity } from './shallows';
import { injectWaveShader, makeFoamTexture } from './waveMaterial';

describe('the shallows in front of the wave', () => {
  it('sit just shoreward of the trough of the one wave shape', () => {
    const shape = new WaveShape(structuredClone(SURF_CONFIG.wave));
    const trough = shape.profile(0, 0, new Vector3());
    expect(SHALLOWS.troughZ).toBeCloseTo(trough.z, 6);
  });

  it('are clear on the flat water in front of the wave, not behind it, far out or up the face', () => {
    const z0 = SHALLOWS.troughZ;
    expect(shallowClarity(z0 + 4, 0)).toBe(1);
    expect(shallowClarity(z0 + 15, 0)).toBe(1);
    // Behind the wave (its back and the open sea beyond) and toward the beach: as before.
    expect(shallowClarity(z0 - 10, 0)).toBe(0);
    expect(shallowClarity(-40, 0)).toBe(0);
    expect(shallowClarity(z0 + 70, 0)).toBe(0);
    // The face keeps its colour above its foot.
    expect(shallowClarity(z0 + 4, 1)).toBe(0);
    expect(shallowClarity(z0 - 1, 0.3)).toBeLessThan(0.5);
  });

  it('fade in and out smoothly (no band): small steps in z never jump', () => {
    for (let z = -20; z < 100; z += 0.25) expect(Math.abs(shallowClarity(z + 0.25, 0) - shallowClarity(z, 0))).toBeLessThan(0.05);
    for (let y = 0; y < 1; y += 0.02) expect(Math.abs(shallowClarity(SHALLOWS.troughZ + 5, y + 0.02) - shallowClarity(SHALLOWS.troughZ + 5, y))).toBeLessThan(0.08);
  });

  it('the GLSL twin uses the same constants', () => {
    expect(SHALLOWS_GLSL).toContain('float shallowClarity(float z, float y)');
    for (const v of [SHALLOWS.clearFrom, SHALLOWS.clearFull, SHALLOWS.fadeFrom, SHALLOWS.fadeTo, SHALLOWS.faceRise]) expect(SHALLOWS_GLSL).toContain(v.toFixed(3));
  });
});

describe('water opacity', () => {
  const legacy = (alpha: number, fres: number, dist: number) => {
    const s = (e0: number, e1: number, v: number) => {
      const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    return alpha + (1 - alpha) * Math.max(fres, s(8, 35, dist));
  };

  it('is unchanged away from the shallows (clarity 0)', () => {
    for (const [a, f, d] of [
      [0.7, 0.02, 5],
      [0.7, 0.3, 20],
      [0.85, 0.9, 50],
      [1, 0.1, 3],
    ] as const) {
      expect(waterOpacity(a, f, d, 0)).toBeCloseTo(legacy(a, f, d), 6);
    }
  });

  it('is a little see-through over the shallows near the rider (still water), and opaque far out all the same', () => {
    expect(waterOpacity(0.7, 0.1, 8, 1)).toBeLessThan(0.6);
    expect(waterOpacity(0.7, 0.1, 8, 1)).toBeGreaterThan(0.45);
    expect(waterOpacity(0.7, 0.1, 8, 1)).toBeLessThan(waterOpacity(0.7, 0.1, 8, 0) - 0.15);
    expect(waterOpacity(0.7, 0.2, 60, 1)).toBeCloseTo(1, 6);
    expect(waterOpacity(0.7, 0.98, 30, 1)).toBeGreaterThan(0.8);
  });

  it('only grows with distance (the shallows never band against the deep water)', () => {
    for (const c of [0, 0.5, 1]) {
      for (let d = 1; d < 80; d += 0.5) expect(waterOpacity(0.7, 0.1, d + 0.5, c)).toBeGreaterThanOrEqual(waterOpacity(0.7, 0.1, d, c) - 1e-9);
    }
  });
});

describe('sand bed', () => {
  it('is shallowest just in front of the breaking wave and sinks to the sea floor both ways', () => {
    const z0 = SHALLOWS.troughZ;
    const ys = SAND_PROFILE.map(([, y]) => y);
    const top = Math.max(...ys);
    const zTop = SAND_PROFILE.find(([, y]) => y === top)![0];
    expect(zTop).toBeGreaterThan(z0);
    expect(zTop).toBeLessThan(z0 + 8);
    expect(top).toBeLessThan(-1.2);
    expect(sandY(-200)).toBeLessThan(-4.2);
    expect(sandY(300)).toBeLessThan(-4.2);
    // Never above the water, and always above the opaque floor under it (no z-fighting).
    for (let z = -60; z < 120; z += 1) {
      expect(sandY(z)).toBeLessThan(-1);
      expect(sandY(z)).toBeGreaterThan(-4.34);
    }
  });

  it('runs its caustics on the water clock (still under the pause menu), not the page clock', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    const bed = env.frameStuff.getObjectByName('sandbed') as Mesh<BufferGeometry, MeshLambertMaterial>;
    const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n#include <fog_fragment>' };
    bed.material.onBeforeCompile(shader as never, undefined as never);
    env.update(100, 0, 1, 3);
    expect(shader.uniforms.uTime!.value).toBeCloseTo(3, 9);
    env.update(250, 0, 1, 3);
    expect(shader.uniforms.uTime!.value).toBeCloseTo(3, 9);
    env.dispose();
  });

  it('is one opaque mesh in the frame whose ripples scroll with the frame travel', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    const bed = env.frameStuff.getObjectByName('sandbed') as Mesh<BufferGeometry, MeshLambertMaterial>;
    expect(bed).toBeInstanceOf(Mesh);
    expect(bed.material.transparent).toBe(false);
    expect(bed.material.map).toBeTruthy();
    env.update(0, 0, 1);
    const o0 = bed.material.map!.offset.x;
    env.update(0, SHALLOWS.rippleTile * 0.25, 1);
    expect(bed.material.map!.offset.x).toBeCloseTo(o0 + 0.25, 6);
    env.dispose();
  });
});

describe('sand caustics', () => {
  it('repeat along the beach every CAUSTIC_REPEAT metres (the travel fed to them wraps seamlessly)', () => {
    for (const k of [1.5, 1.5 * 1.2]) {
      const turns = (k * CAUSTIC_REPEAT) / (2 * Math.PI);
      expect(turns).toBeCloseTo(Math.round(turns), 9);
    }
    const { material } = createSandMaterial(makeRippleTexture());
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('vec2(vSand.x + uTravel, vSand.z) * 1.5');
    expect(shader.fragmentShader).toContain('uTime * 0.9');
    expect(shader.fragmentShader).toContain('uTime * 0.7');
    expect(shader.uniforms.uTravel).toBeDefined();
    // No sunlight through the surface in the underwater cut.
    expect(shader.uniforms.uReflect).toBe(seaReflection.uReflect);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uReflect * lit');
    material.dispose();
  });
});

describe('wave shader: clear shallows and the concave face', () => {
  it('works the clarity into the water\'s opacity and reflection, and flutes the face', () => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: 'void main(){\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>\n}',
      fragmentShader: 'void main(){\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n}',
    };
    injectWaveShader(shader as never, { uTime: { value: 0 }, uTravel: { value: 0 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() }, uPeak: { value: new Vector3(0, 0, 1) } });
    const fs = shader.fragmentShader;
    expect(shader.vertexShader).toContain('attribute float aRise;');
    expect(fs).toContain('float shallowClarity(float z, float y)');
    expect(fs).toContain('shallowClarity(vSea.y, vHeight)');
    expect(fs).toContain(`mix(diffuseColor.a, ${SHALLOWS.alpha.toFixed(3)}, clearW)`);
    expect(fs).toContain(`mix(35.0, ${SHALLOWS.opaqueFar.toFixed(3)}, clearW)`);
    // The streaks are worked out in the colour pass, then tilt the normal after the normal maps.
    expect(fs.indexOf('streakSlope =')).toBeLessThan(fs.indexOf('#include <normal_fragment_maps>'));
    expect(fs.indexOf('normal = normalize(normal + vAlongView')).toBeGreaterThan(fs.indexOf('#include <normal_fragment_maps>'));
    expect(fs).toContain('lipRim');
    // The streak fetches only where there is a face.
    expect(fs.indexOf('if (vFace > 0.001)')).toBeLessThan(fs.indexOf('texture2D(uFoamTex, vec2(faceU, faceV))'));
  });
});

describe('fadeUnderwaterIntoFog', () => {
  it('chains after an earlier shader hook and keeps its program apart (default cache key or not)', () => {
    const plain = fadeUnderwaterIntoFog(new MeshLambertMaterial());
    const hooked = new MeshLambertMaterial();
    hooked.onBeforeCompile = (sh) => {
      sh.fragmentShader += '\n// hooked';
    };
    fadeUnderwaterIntoFog(hooked);
    expect(hooked.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <fog_fragment>' };
    hooked.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('// hooked');
    expect(shader.fragmentShader).toContain('fogColor, smoothstep');
  });
});
