import { DataTexture, DoubleSide, MeshLambertMaterial, RepeatWrapping, RGBAFormat, Vector3, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { retroMaterial, retroTexture } from '@/retro/retroMaterial';
import { SKY_GLSL, skyUniforms } from './sky';

export interface WaveUniforms {
  uTime: { value: number };
  uPeel: { value: number };
  uFoamTex: { value: Texture };
  uSSS: { value: Vector3 };
}

/**
 * Sky reflection (applied to the lit colour, before fog): the water mirrors the sky gradient with
 * Schlick's Fresnel, so it runs from its own colour underfoot to the sky's haze (= the fog colour)
 * at grazing angles near the horizon, and turns opaque as it does. A low-contrast swell modulates
 * the reflection; each wave fades out where it would alias (its phase changes too fast per pixel).
 * Foam doesn't reflect; the translucent face keeps most of its colour.
 */
const SKY_REFLECTION_GLSL = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    vec3 N = normalize(normal);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    float p1 = dot(vSea, vec2(0.03, 0.19)) + uTime * 0.9;
    float p2 = dot(vSea, vec2(-0.1, 0.12)) - uTime * 0.7;
    float swell = 0.6 * sin(p1) * (1.0 - smoothstep(0.1, 0.8, fwidth(p1))) + 0.4 * sin(p2) * (1.0 - smoothstep(0.1, 0.8, fwidth(p2)));
    fres = clamp(fres * (1.0 + 0.2 * swell), 0.0, 1.0) * (1.0 - clamp(vFoam, 0.0, 1.0)) * (1.0 - 0.6 * vFace);
    vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 sky = skyGradient(dot(reflect(-V, N), up));
    outgoingLight = mix(outgoingLight, sky, fres);
    diffuseColor.a = mix(diffuseColor.a, 1.0, fres);
  }
`;

/** Inject ripple, foam scrolling, fake subsurface and sky reflection into a Lambert shader. Pure string surgery (unit-tested). */
export function injectWaveShader(shader: Pick<WebGLProgramParametersWithUniforms, 'uniforms' | 'vertexShader' | 'fragmentShader'>, u: WaveUniforms): void {
  Object.assign(shader.uniforms, u, skyUniforms);
  shader.vertexShader =
    'uniform float uTime;\nuniform float uPeel;\nattribute float aFoam;\nattribute float aFace;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\nvarying vec2 vSea;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  transformed += objectNormal * (sin(position.x * 1.7 + uTime * 2.3) * sin(position.z * 1.3 - uTime * 1.9)) * 0.035;
  vFoam = aFoam;
  vFace = aFace;
  vSea = position.xz;
  vFoamUv = vec2((position.x + uTime * uPeel) / 7.0, uv.y * 9.0 + position.z * 0.05);`,
    );
  shader.fragmentShader =
    'uniform sampler2D uFoamTex;\nuniform vec3 uSSS;\nuniform float uTime;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\nvarying vec2 vSea;\n' +
    SKY_GLSL +
    shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float foamN = texture2D(uFoamTex, vFoamUv).r;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.99, 1.0), clamp(vFoam * (0.55 + 0.6 * foamN), 0.0, 1.0));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  totalEmissiveRadiance += uSSS * rim * rim * vFace;`,
      )
      .replace('#include <opaque_fragment>', `${SKY_REFLECTION_GLSL}\n#include <opaque_fragment>`);
}

/** 64×64 value-noise texture for scrolling foam (generated, no assets). */
export function makeFoamTexture(seed = 1): DataTexture {
  const N = 64;
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid = Array.from({ length: 16 * 16 }, rand);
  const at = (x: number, y: number) => grid[((y & 15) << 4) | (x & 15)]!;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = x / 4;
      const gy = y / 4;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      const v = Math.round((top * (1 - fy) + bot * fy) * 255);
      data.set([v, v, v, 255], (y * N + x) * 4);
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return retroTexture(tex);
}

export function createWaveMaterial(peelSpeed: number): { material: MeshLambertMaterial; uniforms: WaveUniforms } {
  const uniforms: WaveUniforms = {
    uTime: { value: 0 },
    uPeel: { value: peelSpeed },
    uFoamTex: { value: makeFoamTexture() },
    uSSS: { value: new Vector3(0.18, 0.55, 0.42) },
  };
  const material = retroMaterial(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true }));
  const snap = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    snap.call(material, shader, renderer);
    injectWaveShader(shader, uniforms);
  };
  material.customProgramCacheKey = () => 'retro-snap-wave';
  return { material, uniforms };
}
