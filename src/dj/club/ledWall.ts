import * as THREE from 'three';
import { RETRO_SNAP_GLSL, RETRO_SNAP_UNIFORMS_GLSL, retroUniforms } from '@/retro/retroMaterial';
import { DEFAULT_PALETTE, paletteFrom } from './palette';

const VERT = /* glsl */ `
${RETRO_SNAP_UNIFORMS_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${RETRO_SNAP_GLSL}
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uFft;
uniform float uTime;
uniform float uBeat;
uniform float uEnergy;
uniform float uDrop;
uniform float uIdle;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
void main() {
  vec2 grid = vec2(96.0, 36.0);
  vec2 cell = floor(vUv * grid);
  vec2 f = fract(vUv * grid);
  float led = smoothstep(0.5, 0.3, length(f - 0.5));
  float x = (cell.x + 0.5) / grid.x;
  float h = (cell.y + 0.5) / grid.y;
  float bin = texture2D(uFft, vec2(abs(x - 0.5) * 1.4 + 0.02, 0.5)).r;
  float bar = step(h, bin * (0.55 + 0.6 * uEnergy));
  float pulse = 0.25 + 0.75 * pow(1.0 - fract(uBeat), 3.0);
  vec3 bg = mix(uColA, uColB, 0.5 + 0.5 * sin(uTime * 0.4 + x * 6.0)) * 0.22 * mix(pulse, 0.6, uIdle);
  vec3 col = mix(bg, mix(uColA, uColB, h), bar * (1.0 - uIdle));
  col += uDrop * 0.8;
  gl_FragColor = vec4(col * led, 1.0);
}
`;

export const SPECTRUM_BINS = 128;

/**
 * Spectrum LED wall behind the booth: mirrored FFT bars on an LED dot grid, a
 * beat pulse on the background and a white flash on the drop. Fill `spectrum`
 * (AnalyserNode.getByteFrequencyData) in place, then call `update`.
 */
export class LedWall {
  readonly mesh: THREE.Mesh;
  readonly spectrum = new Uint8Array(SPECTRUM_BINS);
  private readonly tex: THREE.DataTexture;
  private readonly mat: THREE.ShaderMaterial;
  private readonly colA: THREE.Color;
  private readonly colB: THREE.Color;

  constructor() {
    this.tex = new THREE.DataTexture(this.spectrum, SPECTRUM_BINS, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.colA = new THREE.Color(...DEFAULT_PALETTE.a);
    this.colB = new THREE.Color(...DEFAULT_PALETTE.b);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uFft: { value: this.tex },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uEnergy: { value: 0 },
        uDrop: { value: 0 },
        uIdle: { value: 1 },
        uColA: { value: this.colA },
        uColB: { value: this.colB },
        // shared objects, so RetroRenderer's snap strength applies here too
        uSnapRes: retroUniforms.uSnapRes,
        uSnapStrength: retroUniforms.uSnapStrength,
      },
    });
    // 16×6 segments so the PS2 vertex snap has vertices to wobble
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 3, 16, 6), this.mat);
    this.mesh.name = 'ledWall';
    this.mesh.position.set(0, 3.1, 2.2);
    this.mesh.rotation.y = Math.PI; // face the crowd (−z)
  }

  setPalette(rgb: readonly [number, number, number]): void {
    const p = paletteFrom(rgb);
    this.colA.setRGB(p.a[0], p.a[1], p.a[2]);
    this.colB.setRGB(p.b[0], p.b[1], p.b[2]);
  }

  /** Call after filling `spectrum`. `beat` is the audible master beat (float beats). */
  update(time: number, beat: number, energy: number, drop: number, idle: boolean): void {
    this.tex.needsUpdate = true;
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    u.uBeat!.value = beat;
    u.uEnergy!.value = energy;
    u.uDrop!.value = drop;
    u.uIdle!.value = idle ? 1 : 0;
  }

  dispose(): void {
    this.tex.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
