export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Pass A (internal res): blend the new frame with the previous blend — the PS2 "trail". */
export const BLEND_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform float trail;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tScene, vUv).rgb;
  vec3 p = texture2D(tPrev, vUv).rgb;
  gl_FragColor = vec4(mix(s, p, trail), 1.0);
}
`;

/** Pass B (screen): chunky pixels, gamma, ordered dither, RGB565-style quantization. */
export const OUTPUT_FRAG = /* glsl */ `
uniform sampler2D tBlend;
uniform vec2 internalRes;
uniform vec3 levels;
uniform float gammaLift;
uniform float ditherAmount;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 px = floor(vUv * internalRes);
  vec2 uv = (px + 0.5) / internalRes;
  vec3 c = texture2D(tBlend, uv).rgb;
  c = pow(max(c, vec3(0.0)), vec3(1.0 / (2.2 * gammaLift)));
  float d = (bayer4(px) - 0.5) * ditherAmount;
  c = floor(c * levels + d + 0.5) / levels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
