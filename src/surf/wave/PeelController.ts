import type { SurfConfig } from '../config';
import { mulberry32 } from '../math/random';

export type PeelTransition = 'start' | 'end' | null;

/**
 * The peel speed over a run: the base Vp plus "fast sections" — every minGap–maxGap s (seeded per
 * run) a section breaks faster for minHold–maxHold s: Vp ramps up by minBoost–maxBoost over `ramp`
 * s, holds, and ramps back. A pure function of sim time; the game feeds `speed` to the surfer.
 */
export class PeelController {
  /** Current peel speed (m/s). */
  speed: number;
  /** 0 … 1: how far the current fast section has ramped in. */
  level = 0;
  /** Boost of the current / next section (fraction of Vp). */
  boost = 0;
  private start = 0;
  private hold = 0;
  private inSection = false;
  private rand: () => number = Math.random;

  constructor(
    private readonly wave: { peelSpeed: number },
    private readonly cfg: SurfConfig['sections'],
  ) {
    this.speed = wave.peelSpeed;
  }

  /** New run: first section minGap–maxGap s after the drop-in. */
  reset(seed: number): void {
    this.rand = mulberry32(seed);
    this.level = 0;
    this.inSection = false;
    this.schedule(0);
    this.speed = this.wave.peelSpeed;
  }

  /** True from the start of the ramp up to the end of the ramp down. */
  get active(): boolean {
    return this.inSection;
  }

  /** Advance to sim time `t` (s since the drop-in). Returns 'start' / 'end' on the tick a section begins / ends. */
  update(t: number): PeelTransition {
    const c = this.cfg;
    let transition: PeelTransition = null;
    const u = t - this.start;
    const total = 2 * c.ramp + this.hold;
    if (u >= total) {
      if (this.inSection) transition = 'end';
      this.inSection = false;
      this.schedule(this.start + total);
      this.level = 0;
    } else if (u >= 0) {
      if (!this.inSection) transition = 'start';
      this.inSection = true;
      this.level = Math.min(1, u / c.ramp, (total - u) / c.ramp);
    } else {
      this.level = 0;
    }
    this.speed = this.wave.peelSpeed * (1 + this.boost * this.level);
    return transition;
  }

  private schedule(after: number): void {
    const c = this.cfg;
    const r = this.rand;
    this.start = after + c.minGap + (c.maxGap - c.minGap) * r();
    this.hold = c.minHold + (c.maxHold - c.minHold) * r();
    this.boost = c.minBoost + (c.maxBoost - c.minBoost) * r();
  }
}
