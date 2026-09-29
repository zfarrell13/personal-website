import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { retroMaterial, retroTexture, retroUniforms } from './retroMaterial';

describe('retroMaterial', () => {
  it('injects vertex snapping after project_vertex and shares uniforms', () => {
    const m = retroMaterial(new THREE.MeshLambertMaterial());
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: 'void main() {\n#include <project_vertex>\n}',
      fragmentShader: '',
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('uniform vec2 uSnapRes;');
    expect(shader.vertexShader.indexOf('uSnapStrength)')).toBeGreaterThan(shader.vertexShader.indexOf('#include <project_vertex>'));
    expect(shader.uniforms.uSnapRes).toBe(retroUniforms.uSnapRes);
    expect(m.customProgramCacheKey()).toBe('retro-snap');
  });
  it('can opt out of snapping', () => {
    const base = new THREE.MeshBasicMaterial();
    const before = base.onBeforeCompile;
    expect(retroMaterial(base, { snap: false }).onBeforeCompile).toBe(before);
  });
  it('makes textures nearest-filtered without mipmaps', () => {
    const t = retroTexture(new THREE.Texture());
    expect(t.magFilter).toBe(THREE.NearestFilter);
    expect(t.minFilter).toBe(THREE.NearestFilter);
    expect(t.generateMipmaps).toBe(false);
  });
});
