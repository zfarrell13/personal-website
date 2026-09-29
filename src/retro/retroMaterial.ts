import * as THREE from 'three';

export const retroUniforms = {
  uSnapRes: { value: new THREE.Vector2(640, 448) },
  uSnapStrength: { value: 0.35 },
};

export const RETRO_SNAP_UNIFORMS_GLSL = /* glsl */ `uniform vec2 uSnapRes;
uniform float uSnapStrength;
`;

/** Snap block: place after gl_Position is computed. */
export const RETRO_SNAP_GLSL = /* glsl */ `
{
  vec4 sp = gl_Position;
  if (sp.w > 0.0) {
    vec2 ndc = sp.xy / sp.w;
    vec2 grid = uSnapRes * 0.5;
    vec2 snapped = floor(ndc * grid + 0.5) / grid;
    sp.xy = mix(ndc, snapped, uSnapStrength) * sp.w;
    gl_Position = sp;
  }
}
`;

const INCLUDE = '#include <project_vertex>';
let warned = false;

/** Adds PS2-style vertex snapping to any built-in material. Fog/lighting stay three.js-native. */
export function retroMaterial<M extends THREE.Material>(material: M, opts: { snap?: boolean } = {}): M {
  if (opts.snap === false) return material;
  const prev = material.onBeforeCompile;
  // three's default key is onBeforeCompile.toString(); capture it from the ORIGINAL hook,
  // since the wrapper installed below would otherwise make every material's key identical.
  const prevKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
      ? (() => {
          const base = prev.toString();
          return () => base;
        })()
      : material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    if (!shader.vertexShader.includes(INCLUDE)) {
      if (!warned) {
        warned = true;
        console.warn('retroMaterial: "#include <project_vertex>" not found; vertex snapping skipped.');
      }
      return;
    }
    shader.uniforms.uSnapRes = retroUniforms.uSnapRes;
    shader.uniforms.uSnapStrength = retroUniforms.uSnapStrength;
    shader.vertexShader = RETRO_SNAP_UNIFORMS_GLSL + shader.vertexShader.replace(INCLUDE, `${INCLUDE}\n${RETRO_SNAP_GLSL}`);
  };
  material.customProgramCacheKey = () => `${prevKey()}|retro-snap`;
  return material;
}

export function retroTexture<T extends THREE.Texture>(texture: T): T {
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
