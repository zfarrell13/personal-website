import {
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { EventBus, SurfEvent } from '../physics/events';
import type { SurferState } from '../physics/Surfer';
import type { WaveShape } from '../wave/WaveShape';
import { smoothstep } from '../math/scalar';
import { ParticlePool, RateAccumulator } from './ParticlePool';

const ATTRIBUTES = ['position', 'aAlpha', 'aSize', 'aShade'] as const;
/** View depth (m) over which particles fade in: invisible nearer than 0.8 m, full from 2.5 m. */
export const NEAR_FADE = [0.8, 2.5] as const;
/** Largest point size, as a fraction of the internal render height. */
export const MAX_POINT_FRACTION = 0.06;
/** View depth (m) over which drops grow from nothing to full size (they shrink away toward the lens). */
export const NEAR_SHRINK = [0.8, 3.5] as const;
/**
 * Attract mode (the dimmed wave behind a site page): the camera sits by the lip, so near spray would be big
 * flat discs behind the page's text. They fade and shrink away much further out, points stay small, and
 * the lip curtain and shoulder feathering are thinned (`thin` × their rates). The distant spray line and the
 * impact plume are untouched.
 */
export const ATTRACT_PARTICLES = { nearFade: [4, 6], nearShrink: [4, 12], maxPointFraction: 0.02, thin: 0.35 } as const;
/** A dying drop shrinks to this fraction of its size as it fades … */
export const DROP_MIN_SIZE = 0.3;
/** … and is fully opaque until its fade value (ParticlePool alpha, 1 → 0 over the last 30% of life) drops below this. */
export const DROP_FADE_ALPHA = 0.25;

const VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
attribute float aShade;
uniform float uScale;
uniform float uMaxSize;
uniform vec2 uNearFade;
uniform vec2 uNearShrink;
varying float vAlpha;
varying float vShade;
${ShaderChunk.fog_pars_vertex}
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Spray right at the lens (the tube camera sits under the falling lip) fades out instead of
  // filling the screen with giant discs; point sizes are capped for the same reason.
  // A dying drop fades by SHRINKING (it stays white water), only going transparent at the very end:
  // translucent white over the teal read as dirty grey discs. Drops near the lens do the same: they
  // shrink away over NEAR_SHRINK (big discs right at the camera cluttered the title and the tube
  // view) and only go transparent within NEAR_FADE.
  // uNearFade / uNearShrink are NEAR_FADE / NEAR_SHRINK in play, further out in attract mode.
  float nearFade = smoothstep(uNearFade.x, uNearFade.y, -mvPosition.z);
  float nearShrink = smoothstep(uNearShrink.x, uNearShrink.y, -mvPosition.z);
  vAlpha = smoothstep(0.0, ${DROP_FADE_ALPHA.toFixed(2)}, aAlpha) * smoothstep(0.0, 0.4, nearFade);
  vShade = aShade;
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = vAlpha > 0.0 ? clamp(aSize * (${DROP_MIN_SIZE.toFixed(2)} + ${(1 - DROP_MIN_SIZE).toFixed(2)} * aAlpha) * nearShrink * uScale / -mvPosition.z, 1.0, uMaxSize) : 0.0;
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
  gl_FragColor = vec4(min(vec3(1.0), vec3(0.86, 0.97, 1.0) * vShade + 0.12), vAlpha * 0.95);
  ${ShaderChunk.fog_fragment}
}
`;

/** Pool size: the crashing wave (≈ 500 alive) plus rooster tails, snaps, splashes and the spit. Still one draw call. */
const CAPACITY = 4096;
/**
 * Spawn rates (per s) of the crashing-wave emitters; bursts spawn `burstSize` particles each.
 * `feather` and `lipSmoke` are dense on purpose: from the chase camera (looking down the line, the
 * curl beside / behind it) the lip's spray is what shows the wave crashing. `fizz` is the aerated
 * surface of the whitewater (it gives the foam sheet volume up close).
 */
export const PARTICLE_RATES = { lip: 240, bursts: 12, burstSize: 16, churn: 140, feather: 240, lipSmoke: 110, fizz: 380 } as const;
/**
 * Board spray. A steady wake of `cruise` per (m/s); a rooster tail thrown off the outside rail that
 * grows with speed × turn rate (`fan` per (m/s · rad/s), fuller with the carve held, and a little
 * smaller low on the face — bottom turns); a big burst on every snap / lip turn and a smaller one on a
 * cutback (a genuine reversal: the board turns from running down the line to running back toward the
 * curl, or the other way round, while carving).
 * In the tube (or under the tube camera) it is cut to `inTube`: the camera is right behind the rider.
 */
export const BOARD_SPRAY = { cruise: 2, stall: 40, fan: 22, snapBurst: 160, cutbackBurst: 80, inTube: 0.3 } as const;
/** Feathering starts this far (m) ahead of the curl. */
const FEATHER_FROM = 5;
/** |heading.x| beyond which the board clearly runs one way along the wave (cutback detection hysteresis). */
const LINE_CLEAR = 0.35;
/** Turn rate (rad/s) that counts as carving through a reversal (not a drift). */
const CUTBACK_TURN = 0.8;
/** Speed × turn rate (m/s · rad/s) of a full-blooded carve: the rooster tail's full height and throw. */
const HARD_TURN = 20;
/** The falling-lip curtain streams off the lip where it pitches over into the trough: from the landing (x = −D) up to here (m), well behind the barrel's mouth, so it never hangs across the eye. */
const CURTAIN_TO = -2;

/**
 * All water particles in one pooled THREE.Points (one draw call): the falling-lip curtain,
 * whitewater explosions where the lip lands, churn behind it, feathering along the shoulder crest,
 * board spray and rooster tails, tube spit, wipeout splash and bubbles. Positions are wave-frame
 * coordinates (the Points live in the frame group). Driven by the sim dt the game passes in, so
 * pausing freezes them.
 */
export class Particles {
  readonly pool = new ParticlePool(CAPACITY);
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly lipRate = new RateAccumulator();
  private readonly burstRate = new RateAccumulator();
  private readonly churnRate = new RateAccumulator();
  private readonly featherRate = new RateAccumulator();
  private readonly smokeRate = new RateAccumulator();
  private readonly fizzRate = new RateAccumulator();
  /** Which way along the wave the board last clearly ran (+1 / −1; 0 = not riding). */
  private lineSign = 0;
  private readonly sprayRate = new RateAccumulator();
  private readonly bubbleRate = new RateAccumulator();
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly out = new Vector3();
  private readonly lift = new Vector3();
  private readonly off: Array<() => void> = [];
  private readonly rnd = (a: number, b: number) => a + this.random() * (b - a);
  bubbles = false;
  /** Set by the game while the tube camera is on (it sits right behind the rider): board spray is cut to BOARD_SPRAY.inTube. */
  tubeView = false;
  private readonly bubbleAt = new Vector3();
  private attract = false;
  /** The last internal render height given to setScale (uMaxSize is a fraction of it). */
  private renderHeight = 448;

  constructor(
    private readonly wave: WaveShape,
    bus: EventBus<SurfEvent>,
    private readonly surfer: SurferState,
    /** Uniform [0, 1) source (tests pass a seeded one). */
    private readonly random: () => number = Math.random,
  ) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pool.pos, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this.pool.alpha, 1));
    geo.setAttribute('aSize', new BufferAttribute(this.pool.size, 1));
    geo.setAttribute('aShade', new BufferAttribute(this.pool.shade, 1));
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, {
          uScale: { value: 400 },
          uMaxSize: { value: 27 },
          uNearFade: { value: new Vector2(...NEAR_FADE) },
          uNearShrink: { value: new Vector2(...NEAR_SHRINK) },
        }]),
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
      bus.on('snap', () => this.roosterBurst(BOARD_SPRAY.snapBurst)),
      bus.on('roundhouse', () => this.roosterBurst(BOARD_SPRAY.snapBurst)),
    );
  }

  /** Projected point size scale: internal render height × focal factor. */
  setScale(camera: PerspectiveCamera, internalHeight: number): void {
    this.points.material.uniforms.uScale!.value = internalHeight * 0.5 * camera.projectionMatrix.elements[5]!;
    this.renderHeight = internalHeight;
    this.points.material.uniforms.uMaxSize!.value = internalHeight * this.maxPointFraction();
  }

  /** Attract mode (see ATTRACT_PARTICLES); off restores the play-mode look exactly. */
  setAttract(on: boolean): void {
    this.attract = on;
    const u = this.points.material.uniforms;
    (u.uNearFade!.value as Vector2).fromArray(on ? ATTRACT_PARTICLES.nearFade : NEAR_FADE);
    (u.uNearShrink!.value as Vector2).fromArray(on ? ATTRACT_PARTICLES.nearShrink : NEAR_SHRINK);
    u.uMaxSize!.value = this.renderHeight * this.maxPointFraction();
  }

  private maxPointFraction(): number {
    return this.attract ? ATTRACT_PARTICLES.maxPointFraction : MAX_POINT_FRACTION;
  }

  setBubbles(on: boolean, at?: Vector3): void {
    this.bubbles = on;
    if (at) this.bubbleAt.copy(at);
  }

  update(dt: number, playing: boolean): void {
    const w = this.wave;
    const D = w.params.tubeDepth;
    const thin = this.attract ? ATTRACT_PARTICLES.thin : 1;
    // Falling lip: a curtain streaming off the lip tip where it pitches over into the trough, thrown
    // out and down (behind the barrel's mouth: from the tube camera it is the tube's outer wall).
    for (let n = this.lipRate.take(PARTICLE_RATES.lip * thin, dt); n > 0; n--) {
      const x = this.rnd(-D, CURTAIN_TO);
      w.profile(x, 1, this.p);
      w.profile(x, 0.96, this.q);
      const throwDir = this.q.subVectors(this.p, this.q).normalize();
      const v = this.rnd(2, 4);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: this.rnd(-0.6, 0.6), vy: throwDir.y * v, vz: Math.max(0, throwDir.z) * v + this.rnd(0.5, 1.5), life: this.rnd(0.5, 0.9), size: 0.16, gravity: -9.81, drag: 0.4, shade: 1 });
    }
    // Impact: whitewater explosions where the lip lands in the trough (around x = −D) and just behind.
    for (let n = this.burstRate.take(PARTICLE_RATES.bursts, dt); n > 0; n--) {
      const x = this.rnd(-D - 3, -D + 1.5);
      w.profile(x, x < -D ? w.crestT(x) : 1, this.p);
      for (let k = 0; k < PARTICLE_RATES.burstSize; k++) {
        this.pool.spawn({ x: this.p.x + this.rnd(-0.4, 0.4), y: this.p.y, z: this.p.z + this.rnd(-0.2, 0.5), vx: this.rnd(-2, 1), vy: this.rnd(4, 9), vz: this.rnd(0, 3), life: this.rnd(0.7, 1.3), size: this.rnd(0.16, 0.28), gravity: -9.81, drag: 0.8, shade: 1 });
      }
    }
    for (let n = this.churnRate.take(PARTICLE_RATES.churn, dt); n > 0; n--) {
      const x = -D - this.rnd(0, 14);
      w.profile(x, w.crestT(x) - this.rnd(0, 0.25), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: this.rnd(-1.5, 0.5), vy: this.rnd(1, 3.5), vz: this.rnd(0.5, 2.5), life: this.rnd(0.6, 1.1), size: 0.3, gravity: -6, drag: 1, shade: 0.95 });
    }
    // Feathering: spray blown back off the crest (seaward, away from the face), thickest near the curl
    // and thinning down the shoulder. It starts FEATHER_FROM ahead: nearer, the crest lies on the tube
    // camera's line out through the eye (lip smoke covers the curl itself).
    for (let n = this.featherRate.take(PARTICLE_RATES.feather * thin, dt); n > 0; n--) {
      const u = this.random();
      const x = FEATHER_FROM + (w.params.shoulderLength - FEATHER_FROM) * u * u;
      w.profile(x, w.crestT(x), this.p);
      const k = w.hollowness(x);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: this.rnd(-0.5, 0.5), vy: this.rnd(1, 2.5) * (1 + k), vz: this.rnd(-4, -1.5), life: this.rnd(0.5, 0.9), size: this.rnd(0.14, 0.24), gravity: -3, drag: 0.8, shade: 1 });
    }
    // Lip smoke: spray torn up off the top of the pitching lip and blown back over the wave (it rises
    // behind the lip, so from inside the tube the lip itself hides it).
    for (let n = this.smokeRate.take(PARTICLE_RATES.lipSmoke, dt); n > 0; n--) {
      const x = this.rnd(-D, 1);
      w.profile(x, w.crestT(x), this.p);
      this.pool.spawn({ x: this.p.x + this.rnd(-0.2, 0.2), y: this.p.y + 0.1, z: this.p.z, vx: this.rnd(-1, 1), vy: this.rnd(3, 6), vz: this.rnd(-3.5, -1), life: this.rnd(0.6, 1.1), size: this.rnd(0.09, 0.17), gravity: -4, drag: 0.9, shade: 1 });
    }
    // Fizz: the aerated surface of the whitewater behind the impact (the foam sheet has volume).
    for (let n = this.fizzRate.take(PARTICLE_RATES.fizz, dt); n > 0; n--) {
      const behind = 22 * this.random() ** 1.2;
      const x = -D - behind;
      // Over the whitewater mound, and over the foam spreading onto the flats in front of it.
      if (this.random() < 0.3) this.p.set(x, 0, w.profile(x, 0, this.q).z + this.rnd(0, 6));
      else w.profile(x, w.crestT(x) * this.rnd(0, 1.05), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y + 0.05, z: this.p.z + this.rnd(0, 1.5), vx: this.rnd(-0.8, 0.4), vy: this.rnd(0.4, 1.6), vz: this.rnd(-0.3, 0.8), life: this.rnd(0.4, 0.9), size: this.rnd(0.1, 0.24), gravity: -4, drag: 1.2, shade: 1 });
    }
    const s = this.surfer;
    if (playing && s.mode === 'riding') {
      this.cutbackCheck();
      const speed = s.v.length();
      const turn = speed * Math.abs(s.turnRate);
      const fan = BOARD_SPRAY.fan * turn * (0.4 + 0.6 * Math.abs(s.carve)) * this.faceHeight() * this.lensFactor();
      const rate = BOARD_SPRAY.cruise * speed + (s.stalling ? BOARD_SPRAY.stall : 0) + fan;
      for (let n = this.sprayRate.take(rate, dt); n > 0; n--) {
        if (this.random() * rate < fan) this.rooster(turn / HARD_TURN, s.turnRate);
        else this.wake(speed);
      }
    } else this.lineSign = 0;
    if (this.bubbles) {
      for (let n = this.bubbleRate.take(60, dt); n > 0; n--) {
        const b = this.bubbleAt;
        this.pool.spawn({ x: b.x + this.rnd(-1.5, 1.5), y: b.y + this.rnd(-1, 0.5), z: b.z + this.rnd(-1.5, 1.5), vx: 0, vy: this.rnd(0.5, 1.5), vz: 0, life: this.rnd(1, 1.8), size: 0.08, gravity: 2, drag: 1.5, shade: 0.7 });
      }
    }
    this.pool.update(dt);
    const g = this.points.geometry;
    for (const name of ATTRIBUTES) g.getAttribute(name).needsUpdate = true;
  }

  /** A cutback: while carving, the board clearly reverses its run along the wave. */
  private cutbackCheck(): void {
    const s = this.surfer;
    const along = s.heading.x;
    if (Math.abs(along) < LINE_CLEAR) return;
    const sign = along > 0 ? 1 : -1;
    if (this.lineSign !== 0 && sign !== this.lineSign && Math.abs(s.turnRate) > CUTBACK_TURN) this.roosterBurst(BOARD_SPRAY.cutbackBurst);
    this.lineSign = sign;
  }

  /** In the barrel, or with the tube camera right behind the rider, the tail is kept down (it would fill the lens). */
  private lensFactor(): number {
    return this.surfer.inTube || this.tubeView ? BOARD_SPRAY.inTube : 1;
  }

  /** 0.6 in the trough (bottom turns throw less) → 1 high on the face (cutbacks, lip turns). */
  private faceHeight(): number {
    const s = this.surfer;
    const crest = this.wave.crestY(s.param.x);
    return 0.6 + 0.4 * smoothstep(0.2, 0.8, s.p.y / Math.max(crest, 0.01));
  }

  /** The steady wake off the rails. */
  private wake(speed: number): void {
    const s = this.surfer;
    this.pool.spawn({
      x: s.p.x + s.normal.x * 0.05,
      y: s.p.y + s.normal.y * 0.05,
      z: s.p.z + s.normal.z * 0.05,
      vx: -s.heading.x * speed * 0.25 + s.normal.x * this.rnd(1.5, 3.5) + this.rnd(-0.5, 0.5),
      vy: -s.heading.y * speed * 0.25 + s.normal.y * this.rnd(1.5, 3.5),
      vz: -s.heading.z * speed * 0.25 + s.normal.z * this.rnd(1.5, 3.5) + this.rnd(-0.5, 0.5),
      life: this.rnd(0.35, 0.6),
      size: 0.12,
      gravity: -9.81,
      drag: 0.8,
      shade: 1,
    });
  }

  /**
   * One drop of the rooster tail: thrown off the rail on the outside of the turn, up and back from
   * the tail, higher and wider the harder the turn (`power` 1 = a full-blooded carve).
   */
  private rooster(power: number, turnRate: number): void {
    const s = this.surfer;
    const k = Math.min(1.4, Math.max(0.15, power));
    const side = turnRate > 0 ? -1 : turnRate < 0 ? 1 : this.random() < 0.5 ? -1 : 1;
    // Outside of the turn: the board's line turns toward n × heading, the spray flies the other way.
    const out = this.out.crossVectors(s.normal, s.heading).multiplyScalar(side);
    const up = this.lift.copy(s.normal).multiplyScalar(0.6);
    up.y += 0.4;
    const speed = s.v.length();
    const tail = this.rnd(0.4, 0.9);
    const throwOut = this.rnd(1.5, 3.5) * (0.6 + 0.7 * k);
    const rise = this.rnd(2.5, 4.5) * (0.6 + 0.8 * k);
    const back = speed * this.rnd(0.12, 0.3);
    this.pool.spawn({
      x: s.p.x - s.heading.x * tail + out.x * 0.2,
      y: s.p.y - s.heading.y * tail + out.y * 0.2 + 0.05,
      z: s.p.z - s.heading.z * tail + out.z * 0.2,
      vx: out.x * throwOut + up.x * rise - s.heading.x * back + this.rnd(-0.6, 0.6),
      vy: out.y * throwOut + up.y * rise - s.heading.y * back,
      vz: out.z * throwOut + up.z * rise - s.heading.z * back + this.rnd(-0.6, 0.6),
      life: this.rnd(0.5, 0.95),
      size: this.rnd(0.08, 0.18),
      gravity: -9.81,
      drag: 0.9,
      shade: 1,
    });
  }

  /** A snap / lip turn or a cutback: a full fan all at once (riding only). */
  private roosterBurst(count: number): void {
    const s = this.surfer;
    if (s.mode !== 'riding') return;
    const n = Math.round(count * this.lensFactor());
    for (let i = 0; i < n; i++) this.rooster(this.rnd(0.9, 1.4), s.turnRate);
  }

  /** The tube "spit": a fast burst blowing out of the barrel toward the shoulder. */
  spit(): void {
    for (let i = 0; i < 220; i++) {
      this.wave.profile(this.rnd(-2, 0.5), this.rnd(0.3, 0.55), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: this.rnd(8, 16), vy: this.rnd(0, 3), vz: this.rnd(-1, 2), life: this.rnd(0.5, 1), size: 0.22, gravity: -4, drag: 1.2, shade: 1 });
    }
  }

  splash(at: Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const r = this.rnd(1, 4);
      this.pool.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * r, vy: this.rnd(2, 6), vz: Math.sin(a) * r, life: this.rnd(0.5, 1), size: 0.2, gravity: -9.81, drag: 0.5, shade: 1 });
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
