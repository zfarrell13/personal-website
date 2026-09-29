import {
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { EventBus, SurfEvent } from '../physics/events';
import type { SurferState } from '../physics/Surfer';
import type { WaveShape } from '../wave/WaveShape';
import { ParticlePool, RateAccumulator } from './ParticlePool';

const ATTRIBUTES = ['position', 'aAlpha', 'aSize', 'aShade'] as const;

const VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
attribute float aShade;
uniform float uScale;
varying float vAlpha;
varying float vShade;
${ShaderChunk.fog_pars_vertex}
void main() {
  vAlpha = aAlpha;
  vShade = aShade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aAlpha > 0.0 ? max(1.0, aSize * uScale / -mvPosition.z) : 0.0;
  ${ShaderChunk.fog_vertex}
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying float vShade;
${ShaderChunk.fog_pars_fragment}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25 || vAlpha <= 0.0) discard;
  gl_FragColor = vec4(vec3(0.82, 0.95, 1.0) * vShade + 0.15, vAlpha * 0.9);
  ${ShaderChunk.fog_fragment}
}
`;

const CAPACITY = 2048;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * All water particles in one pooled THREE.Points (one draw call): lip spray,
 * whitewater churn, board spray, tube spit, wipeout splash and bubbles.
 * Positions are wave-frame coordinates (the Points live in the frame group).
 * Driven by the sim dt the game passes in, so pausing freezes them.
 */
export class Particles {
  readonly pool = new ParticlePool(CAPACITY);
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly lipRate = new RateAccumulator();
  private readonly churnRate = new RateAccumulator();
  private readonly sprayRate = new RateAccumulator();
  private readonly bubbleRate = new RateAccumulator();
  private readonly p = new Vector3();
  private readonly off: Array<() => void> = [];
  bubbles = false;
  private readonly bubbleAt = new Vector3();

  constructor(
    private readonly wave: WaveShape,
    bus: EventBus<SurfEvent>,
    private readonly surfer: SurferState,
  ) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pool.pos, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this.pool.alpha, 1));
    geo.setAttribute('aSize', new BufferAttribute(this.pool.size, 1));
    geo.setAttribute('aShade', new BufferAttribute(this.pool.shade, 1));
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    this.points = new Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.off.push(
      bus.on('tubeExit', (e) => {
        if (e.duration > 1) this.spit();
      }),
      bus.on('wipeout', () => this.splash(this.surfer.p, 150)),
      bus.on('landed', () => this.splash(this.surfer.p, 40)),
    );
  }

  /** Projected point size scale: internal render height × focal factor. */
  setScale(camera: PerspectiveCamera, internalHeight: number): void {
    this.points.material.uniforms.uScale!.value = internalHeight * 0.5 * camera.projectionMatrix.elements[5]!;
  }

  setBubbles(on: boolean, at?: Vector3): void {
    this.bubbles = on;
    if (at) this.bubbleAt.copy(at);
  }

  update(dt: number, playing: boolean): void {
    const w = this.wave;
    const D = w.params.tubeDepth;
    for (let n = this.lipRate.take(90, dt); n > 0; n--) {
      const x = rnd(-D, 4);
      w.profile(x, 1, this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.8, 0.8), vy: rnd(1.5, 4), vz: rnd(1, 3), life: rnd(0.7, 1.2), size: 0.18, gravity: -9.81, drag: 0.6, shade: 1 });
    }
    for (let n = this.churnRate.take(140, dt); n > 0; n--) {
      const x = -D - rnd(0, 14);
      w.profile(x, w.crestT(x) - rnd(0, 0.25), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-1.5, 0.5), vy: rnd(1, 3.5), vz: rnd(0.5, 2.5), life: rnd(0.6, 1.1), size: 0.3, gravity: -6, drag: 1, shade: 0.95 });
    }
    const s = this.surfer;
    if (playing && s.mode === 'riding') {
      const speed = s.v.length();
      const rate = 8 * speed * Math.abs(s.turnRate) + (s.stalling ? 40 : 0) + speed * 2;
      for (let n = this.sprayRate.take(rate, dt); n > 0; n--) {
        this.pool.spawn({
          x: s.p.x + s.normal.x * 0.05,
          y: s.p.y + s.normal.y * 0.05,
          z: s.p.z + s.normal.z * 0.05,
          vx: -s.heading.x * speed * 0.25 + s.normal.x * rnd(1.5, 3.5) + rnd(-0.5, 0.5),
          vy: -s.heading.y * speed * 0.25 + s.normal.y * rnd(1.5, 3.5),
          vz: -s.heading.z * speed * 0.25 + s.normal.z * rnd(1.5, 3.5) + rnd(-0.5, 0.5),
          life: rnd(0.35, 0.6),
          size: 0.12,
          gravity: -9.81,
          drag: 0.8,
          shade: 1,
        });
      }
    }
    if (this.bubbles) {
      for (let n = this.bubbleRate.take(60, dt); n > 0; n--) {
        const b = this.bubbleAt;
        this.pool.spawn({ x: b.x + rnd(-1.5, 1.5), y: b.y + rnd(-1, 0.5), z: b.z + rnd(-1.5, 1.5), vx: 0, vy: rnd(0.5, 1.5), vz: 0, life: rnd(1, 1.8), size: 0.08, gravity: 2, drag: 1.5, shade: 0.7 });
      }
    }
    this.pool.update(dt);
    const g = this.points.geometry;
    for (const name of ATTRIBUTES) g.getAttribute(name).needsUpdate = true;
  }

  /** The tube "spit": a fast burst blowing out of the barrel toward the shoulder. */
  spit(): void {
    for (let i = 0; i < 220; i++) {
      this.wave.profile(rnd(-2, 0.5), rnd(0.3, 0.55), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(8, 16), vy: rnd(0, 3), vz: rnd(-1, 2), life: rnd(0.5, 1), size: 0.22, gravity: -4, drag: 1.2, shade: 1 });
    }
  }

  splash(at: Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(1, 4);
      this.pool.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * r, vy: rnd(2, 6), vz: Math.sin(a) * r, life: rnd(0.5, 1), size: 0.2, gravity: -9.81, drag: 0.5, shade: 1 });
    }
  }

  clear(): void {
    this.pool.clear();
  }

  dispose(): void {
    this.off.forEach((u) => u());
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
