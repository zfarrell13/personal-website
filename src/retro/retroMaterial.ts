import * as THREE from 'three';

export const retroUniforms = {
  uSnapRes: { value: new THREE.Vector2(640, 448) },
  uSnapStrength: { value: 0.35 },
};

const SNAP_GLSL = /* glsl */ `
{
  vec4 sp = gl_Position;
  vec2 ndc = sp.xy / sp.w;
  vec2 grid = uSnapRes * 0.5;
  vec2 snapped = floor(ndc * grid + 0.5) / grid;
  sp.xy = mix(ndc, snapped, uSnapStrength) * sp.w;
  gl_Position = sp;
}
`;

/** Adds PS2-style vertex snapping to any built-in material. Fog/lighting stay three.js-native. */
export function retroMaterial<M extends THREE.Material>(material: M, opts: { snap?: boolean } = {}): M {
  if (opts.snap === false) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = retroUniforms.uSnapRes;
    shader.uniforms.uSnapStrength = retroUniforms.uSnapStrength;
    shader.vertexShader =
      'uniform vec2 uSnapRes;\nuniform float uSnapStrength;\n' +
      shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${SNAP_GLSL}`);
  };
  material.customProgramCacheKey = () => 'retro-snap';
  return material;
}

export function retroTexture<T extends THREE.Texture>(texture: T): T {
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
