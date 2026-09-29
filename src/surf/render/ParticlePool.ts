/**
 * Fixed-size structure-of-arrays particle pool (no allocation per frame).
 * When full, the oldest slot is recycled (ring buffer).
 */
export interface SpawnOpts {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Per-particle vertical acceleration (m/s²): −9.81 spray, +2 bubbles. */
  gravity: number;
  /** Linear drag (1/s). */
  drag: number;
  /** Brightness 0–1 (white foam = 1, bubbles ≈ 0.7). */
  shade: number;
}

export class ParticlePool {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly shade: Float32Array;
  /** Alpha output for rendering (0 = dead). */
  readonly alpha: Float32Array;
  private next = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.shade = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
  }

  spawn(o: SpawnOpts): number {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx;
    this.vel[i * 3 + 1] = o.vy;
    this.vel[i * 3 + 2] = o.vz;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size[i] = o.size;
    this.gravity[i] = o.gravity;
    this.drag[i] = o.drag;
    this.shade[i] = o.shade;
    this.alpha[i] = 1;
    return i;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const k = Math.max(0, 1 - this.drag[i]! * dt);
      const j = i * 3;
      this.vel[j]! *= k;
      this.vel[j + 1] = this.vel[j + 1]! * k + this.gravity[i]! * dt;
      this.vel[j + 2]! *= k;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      const f = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.alpha[i] = f < 0.3 ? f / 0.3 : 1;
    }
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

/** Converts a spawn rate into a whole count this frame, carrying the fraction. */
export class RateAccumulator {
  private acc = 0;
  take(ratePerSec: number, dt: number): number {
    this.acc += Math.max(0, ratePerSec) * dt;
    const n = Math.floor(this.acc);
    this.acc -= n;
    return n;
  }
}
