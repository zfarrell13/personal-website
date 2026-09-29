import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RETRO_SNAP_GLSL, RETRO_SNAP_UNIFORMS_GLSL, retroMaterial, retroTexture, retroUniforms } from './retroMaterial';

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
    expect(m.customProgramCacheKey()).toContain('retro-snap');
    expect(shader.vertexShader).toContain(RETRO_SNAP_GLSL);
    expect(shader.vertexShader).toContain(RETRO_SNAP_UNIFORMS_GLSL);
  });
  const compile = (m: THREE.Material, vs: string) => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: vs, fragmentShader: '' };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader;
  };
  it('chains an existing onBeforeCompile', () => {
    const base = new THREE.MeshBasicMaterial();
    base.onBeforeCompile = (s) => {
      s.vertexShader += '\n// MARKER';
    };
    const shader = compile(retroMaterial(base), 'void main() {\n#include <project_vertex>\n}');
    expect(shader.vertexShader).toContain('// MARKER');
    expect(shader.vertexShader).toContain(RETRO_SNAP_GLSL);
  });
  it('cache keys differ when pre-existing keys differ', () => {
    const a = new THREE.MeshBasicMaterial();
    a.customProgramCacheKey = () => 'custom-a';
    const b = retroMaterial(new THREE.MeshBasicMaterial());
    const ka = retroMaterial(a).customProgramCacheKey();
    const kb = b.customProgramCacheKey();
    expect(ka).not.toBe(kb);
    expect(ka).toContain('retro-snap');
    expect(ka).toContain('custom-a');
    expect(kb).toContain('retro-snap');
  });
  it('leaves shader unchanged when the include is missing', () => {
    const shader = compile(retroMaterial(new THREE.MeshBasicMaterial()), 'void main() {}');
    expect(shader.vertexShader).toBe('void main() {}');
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
