import { DataTexture, DoubleSide, LinearFilter, MeshLambertMaterial, RepeatWrapping, RGBAFormat, Vector3, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { retroMaterial, retroTexture } from '@/retro/retroMaterial';
import { PEAK_GLSL_HEADER, PEAK_NORMAL_GLSL, PEAK_POSITION_GLSL } from '../wave/peak';
import { SHALLOWS, SHALLOWS_GLSL } from './shallows';
import { SKY_GLSL, seaReflection, skyUniforms } from './sky';

export interface WaveUniforms {
  uTime: { value: number };
  /** Frame distance travelled along the reef (m): foam is fixed to the water, so it scrolls with the break. */
  uTravel: { value: number };
  uFoamTex: { value: Texture };
  uSSS: { value: Vector3 };
  /** The section peak: (frame x, extra height as a fraction, half-width) — see wave/peak.ts. y = 0: none. */
  uPeak: { value: Vector3 };
}

/**
 * Sky reflection (applied to the lit colour, before fog): the water mirrors the sky gradient with
 * Schlick's Fresnel and turns opaque at grazing angles and with distance. The reflection is partial
 * on near water and on the wave body (so the sea and the wave keep their teal) and rises to full on
 * grazing open sea and where the fog takes over, so the far sea runs into the haze (= the fog
 * colour) with no line. Every factor grows toward the horizon, so the rows below it only brighten
 * toward it (no band). A low-contrast, cross-hatched swell (diagonal crests, so it never lines up
 * into horizontal bands) modulates the reflection on near water only; it fades by distance, and all
 * at once where its phase would change too fast per pixel (low cameras), before it could alias.
 * Foam doesn't reflect, the translucent face keeps most of its colour, and `uReflect` = 0 turns the
 * reflection off (underwater cut).
 */
const f = (v: number) => v.toFixed(3);
const SKY_REFLECTION_GLSL = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    vec3 N = normalize(normal);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    float p1 = dot(vSea, vec2(0.16, 0.2)) + uTime * 0.9;
    float p2 = dot(vSea, vec2(-0.19, 0.15)) - uTime * 0.7;
    float swellAmp = (1.0 - smoothstep(10.0, 45.0, length(vViewPosition))) * (1.0 - smoothstep(0.3, 1.2, max(fwidth(p1), fwidth(p2))));
    float swell = (0.6 * sin(p1) + 0.4 * sin(p2)) * swellAmp;
    float farSea = 1.0;
    #ifdef USE_FOG
      farSea = smoothstep(0.5 * fogNear, fogFar, vFogDepth);
    #endif
    float body = smoothstep(0.15, 1.0, vHeight);
    // Full strength near the horizon on the open sea (grazing), or wherever the fog takes over.
    float grazing = smoothstep(0.5, 0.97, fres) * (1.0 - body);
    float strength = mix(0.45 * (1.0 - 0.7 * body), 1.0, max(farSea, grazing));
    float clean = 1.0 - foamCover;
    // Grazing and distant water is opaque (little light gets back out), however much sky it shows:
    // the reef shows through near the rider but doesn't smear across the mid-distance. The clear
    // shallows in front of the wave (shallowClear) are see-through further out (waterOpacity in shallows.ts).
    float clearW = shallowClear * clean;
    diffuseColor.a = mix(diffuseColor.a, ${f(SHALLOWS.alpha)}, clearW);
    float nearOpaque = smoothstep(mix(8.0, ${f(SHALLOWS.opaqueNear)}, clearW), mix(35.0, ${f(SHALLOWS.opaqueFar)}, clearW), length(vViewPosition));
    float fresOpaque = fres * (1.0 - ${f(SHALLOWS.fresnelCut)} * clearW * (1.0 - fres));
    diffuseColor.a = mix(diffuseColor.a, 1.0, max(fresOpaque, nearOpaque) * clean);
    float refl = clamp(fres * (1.0 + 0.25 * swell), 0.0, 1.0) * strength * clean * (1.0 - 0.6 * vFace) * uReflect;
    refl *= 1.0 - ${f(SHALLOWS.reflectCut)} * clearW * (1.0 - farSea);
    vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 sky = skyGradient(dot(reflect(-V, N), up));
    outgoingLight = mix(outgoingLight, sky, refl);
  }
`;

/** How far (m) the lip tip throws out toward shore, and lifts, at the top of its cycle (aLip = 1). */
export const LIP_THROW = 0.45;
export const LIP_LIFT = 0.15;
/** Upper bound on the lip animation's displacement (m). */
export const LIP_MAX_OFFSET = Math.hypot(LIP_THROW, LIP_LIFT);
/** Throw / churn waves running along the break: [x frequency (rad/m), time frequency (rad/s)]. */
const THROW_WAVES = [
  [0.9, -5.0],
  [2.3, 8.0],
] as const;
const CHURN_WAVE = [1.3, 6.1] as const;

/**
 * The pitching lip's animation (the GPU twin is LIP_GLSL, same formula): the lip throws out toward
 * shore and lifts in waves running along the break, weighted by `aLip` (0 on the rideable face and
 * the crest, so physics and render still agree where the rider can be). It only ever moves up and
 * out from the rest shape, away from the face — it never sags into the tube or across the eye
 * (barrel.test raycasts the eye with it applied).
 */
export function lipOffset(x: number, lip: number, time: number, out: Vector3): Vector3 {
  const [a, b] = THROW_WAVES;
  const thrown = 0.5 + 0.5 * (0.6 * Math.sin(x * a[0] + time * a[1]) + 0.4 * Math.sin(x * b[0] + time * b[1]));
  const lift = 0.5 + 0.5 * Math.sin(x * CHURN_WAVE[0] + time * CHURN_WAVE[1]);
  return out.set(0, lip * LIP_LIFT * lift, lip * LIP_THROW * thrown);
}

const LIP_GLSL = /* glsl */ `
  float lipThrow = 0.5 + 0.5 * (0.6 * sin(position.x * ${f(THROW_WAVES[0][0])} + uTime * ${f(THROW_WAVES[0][1])}) + 0.4 * sin(position.x * ${f(THROW_WAVES[1][0])} + uTime * ${f(THROW_WAVES[1][1])}));
  float lipLift = 0.5 + 0.5 * sin(position.x * ${f(CHURN_WAVE[0])} + uTime * ${f(CHURN_WAVE[1])});
  transformed.yz += aLip * vec2(${f(LIP_LIFT)} * lipLift, ${f(LIP_THROW)} * lipThrow);
`;

/**
 * Aerated whitewater (in the colour pass): two scales of the foam noise — one streaked along the
 * break — break the foam into patches and streaks where it thins out; covered foam is bright white
 * (self-lit: it scatters light, so it never reads as a grey slab in shade), the gaps between the
 * patches milky turquoise.
 */
const FOAM_GLSL = /* glsl */ `
  float foamA = texture2D(uFoamTex, vFoamUv).r;
  // Streaks drawn out along the break (the water runs through the frame along x).
  float foamB = texture2D(uFoamTex, vFoamUv * vec2(0.3, 2.6) + vec2(0.37, 0.61)).r;
  // Fine, slowly boiling detail: lumps, holes and sparkle inside the foam (volume up close).
  float foamC = texture2D(uFoamTex, vFoamUv * vec2(1.6, 5.5) + vec2(0.11 + uTime * 0.05, 0.53 - uTime * 0.09)).r;
  float foamN = 0.4 * foamA + 0.4 * foamB + 0.2 * foamC;
  float foamAmt = clamp(vFoam, 0.0, 1.0);
  float foamCover = foamAmt * smoothstep(0.92 - foamAmt, 1.12 - foamAmt, foamN);
  // Between the lumps of thick foam: aerated turquoise water (never a flat milky sheet).
  float foamMilky = smoothstep(0.35, 0.9, foamAmt) * (1.0 - foamCover);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.74, 0.74), 0.7 * foamMilky);
  // Lumpy white foam: brighter crests on the fine noise, shadowed troughs between them.
  float foamLump = 0.72 + 0.38 * smoothstep(0.25, 0.85, foamC) + 0.1 * foamB;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 1.0, 1.0) * foamLump, foamCover);
  float foamSparkle = foamCover * smoothstep(0.78, 0.9, foamC);
`;

/**
 * The face, concave like a halfpipe (in the colour pass, after the foam; `aRise` = height up the
 * wave): darker down in the trough curve where the face bends up out of the flat water, lighter up the
 * wall, and faint streaks running up the face (water drawn up the wave: two scales of the foam noise
 * stretched along t, fixed to the water). The streaks also flute the face's normal (FACE_NORMAL_GLSL),
 * so they catch the light. The clear shallows (shallowClear) are worked out here for the alpha pass.
 */
const FACE_GLSL = /* glsl */ `
  float shallowClear = shallowClarity(vSea.y, vHeight);
  float faceU = (vSea.x + uTravel) / 9.0;
  float faceV = vT * 0.18 + uTime * 0.012;
  float streakA = texture2D(uFoamTex, vec2(faceU, faceV)).r;
  float streakB = texture2D(uFoamTex, vec2(faceU * 2.6 + 0.43, faceV * 1.7 + 0.2)).r;
  float streak = smoothstep(0.42, 0.78, 0.65 * streakA + 0.35 * streakB);
  float streakSlope = texture2D(uFoamTex, vec2(faceU + 0.025, faceV)).r - texture2D(uFoamTex, vec2(faceU - 0.025, faceV)).r;
  float faceClean = 1.0 - foamCover;
  float troughCurve = smoothstep(0.0, 0.15, vRise) * (1.0 - smoothstep(0.15, 0.6, vRise));
  float faceWall = smoothstep(0.5, 0.92, vRise);
  diffuseColor.rgb *= (1.0 - 0.24 * troughCurve * faceClean) * (1.0 + 0.12 * faceWall * faceClean);
  diffuseColor.rgb *= 1.0 + 0.08 * vFace * (streak - 0.5);
  // Clear shallow water over pale sand: a brighter, greener aqua than the open sea.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.62, 0.55), 0.45 * shallowClear * faceClean);
  float lipRim = smoothstep(0.86, 0.98, vRise) * faceClean;
`;

/** After <normal_fragment_maps>: the streaks flute the face (view-space normal tilted along the break). */
const FACE_NORMAL_GLSL = /* glsl */ `
  normal = normalize(normal + vAlongView * streakSlope * 0.8 * vFace);
`;

/**
 * Inject the section peak, ripple, the animated pitching lip, foam scrolling, fake subsurface and sky
 * reflection into a Lambert shader. Pure string surgery (unit-tested). The peak scales the rest shape
 * exactly as WaveShape.heightScale does (normals included), before the ripple and the lip.
 */
export function injectWaveShader(shader: Pick<WebGLProgramParametersWithUniforms, 'uniforms' | 'vertexShader' | 'fragmentShader'>, u: WaveUniforms): void {
  Object.assign(shader.uniforms, u, skyUniforms, seaReflection);
  shader.vertexShader =
    'uniform float uTime;\nuniform float uTravel;\nattribute float aFoam;\nattribute float aFace;\nattribute float aLip;\nattribute float aRise;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\nvarying vec2 vSea;\nvarying float vHeight;\nvarying float vRise;\nvarying float vT;\nvarying vec3 vAlongView;\n' +
    PEAK_GLSL_HEADER +
    shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${PEAK_NORMAL_GLSL}`).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
${PEAK_POSITION_GLSL}
  transformed += objectNormal * (sin(position.x * 1.7 + uTime * 2.3) * sin(position.z * 1.3 - uTime * 1.9)) * 0.035;
${LIP_GLSL}
  vFoam = aFoam;
  vFace = aFace;
  vSea = position.xz;
  vHeight = position.y;
  vRise = aRise;
  vT = uv.y;
  vAlongView = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  // Foam is fixed to the water, which runs through the frame at the (live) peel speed; on the lip it
  // streams toward the tip.
  vFoamUv = vec2((position.x + uTravel) / 7.0, uv.y * 9.0 + position.z * 0.05 - aLip * uTime * 1.5);`,
    );
  shader.fragmentShader =
    'uniform sampler2D uFoamTex;\nuniform vec3 uSSS;\nuniform float uTime;\nuniform float uTravel;\nuniform float uReflect;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\nvarying vec2 vSea;\nvarying float vHeight;\nvarying float vRise;\nvarying float vT;\nvarying vec3 vAlongView;\n' +
    SKY_GLSL +
    SHALLOWS_GLSL +
    shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${FOAM_GLSL}
${FACE_GLSL}`,
      )
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FACE_NORMAL_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  totalEmissiveRadiance += uSSS * rim * rim * vFace;
  // A bright rim along the lip, where the light comes through its thin edge.
  totalEmissiveRadiance += vec3(0.5, 0.9, 0.8) * 0.3 * lipRim * uReflect;
  // Self-lit foam is for daylight above the water; from below (the wipeout cut, uReflect = 0) it stays dim.
  totalEmissiveRadiance += (diffuseColor.rgb * (0.45 * foamCover + 0.25 * foamMilky) + 0.35 * foamSparkle) * uReflect;`,
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
  retroTexture(tex);
  // Magnified up close (whitewater at the camera's feet), nearest texels read as square tiles, not foam.
  tex.magFilter = LinearFilter;
  return tex;
}

export function createWaveMaterial(): { material: MeshLambertMaterial; uniforms: WaveUniforms } {
  const uniforms: WaveUniforms = {
    uTime: { value: 0 },
    uTravel: { value: 0 },
    uFoamTex: { value: makeFoamTexture() },
    uSSS: { value: new Vector3(0.18, 0.55, 0.42) },
    uPeak: { value: new Vector3(0, 0, 1) },
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
