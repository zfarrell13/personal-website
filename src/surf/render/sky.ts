import { BackSide, Color, ShaderMaterial, Vector3 } from 'three';
import { FOG_CONFIG } from '../config';
import { smoothstep } from '../math/scalar';

/**
 * The sky gradient, by elevation e = sin(angle above the horizon): the haze at the horizon (and
 * below it) is exactly the fog colour, so fogged sea runs into the sky with no line; it clears to
 * the low sky and then the zenith. The water reflects the same gradient (waveMaterial).
 */
export const SKY = {
  haze: new Color(FOG_CONFIG.color),
  low: new Color('#62bdf0'),
  zenith: new Color('#2b76df'),
  /** Warm glow around the low sun (added; fades out toward the horizon so the haze stays the fog colour). */
  sunGlow: new Color('#ffcf94'),
};
/** e where the haze has cleared to the low sky, and the range over which that turns to the zenith. */
const HAZE_TOP = 0.3;
const ZENITH_FROM = 0.25;
/** The sun glow is gone at the horizon and full this high. */
const GLOW_FADE = 0.15;

/**
 * CPU twin of `skyGradient` in SKY_GLSL below: same formula, same constants, same colours. Change
 * one, change both (sky.test pins the horizon identity on this side; the GLSL gets the same
 * uniform objects and the constants are interpolated from HAZE_TOP / ZENITH_FROM).
 */
export function skyColor(e: number, out = new Color()): Color {
  const h = Math.max(e, 0);
  return out.copy(SKY.haze).lerp(SKY.low, smoothstep(0, HAZE_TOP, h)).lerp(SKY.zenith, smoothstep(ZENITH_FROM, 1, h));
}

/** Shared by the sky dome and the water's reflection (same objects, so they never disagree). */
export const skyUniforms = {
  uHaze: { value: SKY.haze },
  uSkyLow: { value: SKY.low },
  uZenith: { value: SKY.zenith },
};

/** How much the water reflects the sky (waveMaterial): 1 above water, 0 in the underwater cut (Environment). */
export const seaReflection = { uReflect: { value: 1 } };

/** GPU twin of `skyColor` above — keep the two formulas identical. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uSkyLow;
uniform vec3 uZenith;
vec3 skyGradient(float e) {
  e = max(e, 0.0);
  vec3 c = mix(uHaze, uSkyLow, smoothstep(0.0, ${HAZE_TOP.toFixed(3)}, e));
  return mix(c, uZenith, smoothstep(${ZENITH_FROM.toFixed(3)}, 1.0, e));
}
`;

/** Per-pixel sky for a camera-centred dome (no vertex-colour facets, no clear colour showing). */
export function createSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...skyUniforms, uSunDir: { value: new Vector3(0, 0.13, -1).normalize() }, uSunGlow: { value: SKY.sunGlow } },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
${SKY_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyGradient(d.y);
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (0.12 * pow(s, 8.0) + 0.45 * pow(s, 90.0)) * smoothstep(0.0, ${GLOW_FADE.toFixed(3)}, d.y);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
}
