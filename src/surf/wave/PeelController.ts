import type { SurfConfig } from '../config';
import { mulberry32 } from '../math/random';
import { smoothstep } from '../math/scalar';

/**
 * 'start': a fast section begins and its peak starts to form; 'pitch': the race is over and the
 * peak pitches (the surge to it begins); 'surged': the curl has reached the peak; 'end': the peel is
 * back at base speed.
 */
export type PeelTransition = 'start' | 'pitch' | 'surged' | 'end' | null;

export type PeakPhase = 'none' | 'rising' | 'pitching' | 'fading';

/**
 * The section peak of the current fast section, in wave-frame coordinates (the curl at x = 0).
 *
 * The math (playtest 5). The wave frame moves along the reef at the live peel speed. The peak forms
 * at the start of the section at x0 = rider x + ahead (`peak.minAhead`–`maxAhead`, seeded) and
 * drifts toward the curl at a constant frame speed `approach` so that at the pitch (race time T
 * later, `sections.minRace`–`maxRace`) it sits at
 *   xPitch = rider x at the start − allowance · T     (clamped to ≥ minPitchX, ≤ x0 − minApproach · T),
 *   approach = (x0 − xPitch) / T.
 * The rider makes the section by being at x ≥ xPitch at the pitch: by losing frame ground over the
 * race no faster than `allowance` m/s (the fast section's boost costs a steady pumper ≈ 1.5–1.7 m/s).
 * In the frame the peak comes toward the rider at `approach` while the rider drifts back: they meet
 * on the peak about when it pitches — the race. (A world-fixed peak, approaching at the full peel
 * speed, would reach the curl by itself within the race for any rider near it, and anyone ahead of
 * the curl would pass it: no race.)
 * The pitch is a surge of peel speed that carries the curl to the peak: over
 *   surgeTime = max(minSurge, xPitch / surgeSpeed)
 * the peak's frame x eases xPitch → 0 (smoothstep) and the peel runs that much faster on top of the
 * boost, so every frame x moves back by xPitch with it (a rider on or past the peak ends up just
 * ahead of the new curl, the barrel right behind; one short of it is caught by the closing section).
 * The bump grows to `peak.height` over the rise time (smoothstep), holds, and from the pitch blends
 * back into the wave by the end of the ramp down (smoothstep). Everything is a pure function of the
 * time since the section started and the rider's x at that moment (pier-style features can reuse
 * the same frame / time math: a world-fixed point moves through the frame at −peel speed).
 */
export interface SectionPeak {
  phase: PeakPhase;
  /** Frame x of the top of the bump (m). */
  x: number;
  /** Current extra height at the top (fraction of the wave height). */
  amp: number;
  /** Half-width along the wave (m). */
  width: number;
  /** Where it formed, and where it pitches (frame x, m). */
  x0: number;
  xPitch: number;
  /** Frame speed toward the curl during the race (m/s). */
  approach: number;
  /** Seconds from the start to the pitch, to full height, and of the surge. */
  raceTime: number;
  riseTime: number;
  surgeTime: number;
  /** Seconds since the section started (−1 = no section). */
  age: number;
}

/**
 * The peel speed over a run: the base Vp plus "fast sections" — every minGap–maxGap s (seeded per
 * run) a section breaks faster while a peak forms down the line: Vp ramps up by minBoost–maxBoost
 * over `ramp` s and holds through the race; at the pitch a surge carries the curl to the peak; then
 * the peel ramps back. A pure function of sim time (and the rider's x when the section starts); the
 * game feeds `speed` to the surfer and `peak` to the wave shape.
 */
export class PeelController {
  /** Current peel speed (m/s). */
  speed: number;
  /** 0 … 1: how far the current fast section's boost has ramped in. */
  level = 0;
  /** Boost of the current / next section (fraction of Vp). */
  boost = 0;
  /** Extra peel speed of the pitch's surge (m/s; 0 outside it). */
  surge = 0;
  readonly peak: SectionPeak = { phase: 'none', x: 0, amp: 0, width: 7, x0: 0, xPitch: 0, approach: 0, raceTime: 0, riseTime: 0, surgeTime: 0, age: -1 };
  private start = 0;
  private ahead = 0;
  private inSection = false;
  /** The current section's 'surged' has been reported. */
  private surged = false;
  /**
   * The rider was too far down the line for the peak to form 15–25 m ahead of them within maxSpawnX:
   * this section is a plain fast section (the boost through the race time, then the ramp down) — no
   * peak, no pitch, nothing to make.
   */
  peakless = false;
  private rand: () => number = Math.random;

  constructor(
    private readonly wave: { peelSpeed: number },
    private readonly cfg: SurfConfig['sections'],
    private readonly peakCfg: SurfConfig['peak'],
  ) {
    this.speed = wave.peelSpeed;
  }

  /** New run: first section minGap–maxGap s after the drop-in. */
  reset(seed: number): void {
    this.rand = mulberry32(seed);
    this.level = 0;
    this.surge = 0;
    this.inSection = false;
    this.peakless = false;
    this.clearPeak();
    this.schedule(0);
    this.speed = this.wave.peelSpeed;
  }

  /** True from the start of the ramp up to the end of the ramp down. */
  get active(): boolean {
    return this.inSection;
  }

  /** Seconds the whole section lasts (race + surge + ramp down) once the peak has formed. */
  private get total(): number {
    return this.peak.raceTime + this.peak.surgeTime + this.cfg.ramp;
  }

  /**
   * Advance to sim time `t` (s since the drop-in). `riderX` = the rider's frame x (the peak forms
   * relative to it on the section's first tick). Returns the transition on the tick it happens.
   */
  update(t: number, riderX = 0): PeelTransition {
    const c = this.cfg;
    const pk = this.peak;
    let transition: PeelTransition = null;
    const u = t - this.start;
    if (u >= 0 && !this.inSection) {
      this.inSection = true;
      this.form(riderX);
      transition = 'start';
    }
    if (this.inSection && u >= this.total) {
      this.inSection = false;
      this.clearPeak();
      this.schedule(this.start + this.total);
      this.level = 0;
      this.surge = 0;
      this.speed = this.wave.peelSpeed;
      return 'end';
    }
    if (!this.inSection) {
      this.level = 0;
      this.surge = 0;
      this.speed = this.wave.peelSpeed;
      return transition;
    }
    const T = pk.raceTime;
    const S = pk.surgeTime;
    const prev = pk.phase;
    // Boost: ramps in, holds through the race and the surge, ramps out.
    this.level = Math.min(1, u / c.ramp, (this.total - u) / c.ramp);
    if (this.peakless) {
      this.surge = 0;
      this.speed = this.wave.peelSpeed * (1 + this.boost * this.level);
      return transition;
    }
    pk.age = u;
    if (u < T) {
      pk.phase = 'rising';
      pk.x = pk.x0 - pk.approach * u;
      pk.amp = this.peakCfg.height * smoothstep(0, pk.riseTime, u);
      this.surge = 0;
    } else {
      const s = Math.min(1, (u - T) / S);
      pk.phase = s < 1 ? 'pitching' : 'fading';
      // The curl surges to the peak: its frame x eases xPitch → 0, the peel runs that much faster.
      pk.x = pk.xPitch * (1 - smoothstep(0, 1, s));
      this.surge = s < 1 ? (pk.xPitch * 6 * s * (1 - s)) / S : 0;
      pk.amp = this.peakCfg.height * (1 - smoothstep(T, this.total, u));
      if (prev === 'rising') transition = 'pitch';
      else if (s >= 1 && !this.surged) {
        this.surged = true;
        transition = 'surged';
      }
    }
    this.speed = this.wave.peelSpeed * (1 + this.boost * this.level) + this.surge;
    return transition;
  }

  /** The peak forms ahead of the rider: place it and set its race (see SectionPeak). */
  private form(riderX: number): void {
    const p = this.peakCfg;
    const pk = this.peak;
    const T = pk.raceTime;
    pk.width = p.width;
    this.surged = false;
    // Too far down the line for 15–25 m ahead: no peak this time (never one behind or beside the rider).
    this.peakless = riderX + this.ahead > p.maxSpawnX;
    if (this.peakless) {
      pk.surgeTime = 0;
      pk.amp = 0;
      pk.phase = 'none';
      pk.age = -1;
      return;
    }
    pk.x0 = riderX + this.ahead;
    pk.xPitch = Math.max(p.minPitchX, Math.min(riderX - p.allowance * T, pk.x0 - p.minApproach * T));
    pk.approach = (pk.x0 - pk.xPitch) / T;
    pk.surgeTime = Math.max(p.minSurge, pk.xPitch / p.surgeSpeed);
    pk.x = pk.x0;
    pk.amp = 0;
    pk.phase = 'rising';
    pk.age = 0;
    this.surged = false;
  }

  private clearPeak(): void {
    const pk = this.peak;
    pk.phase = 'none';
    pk.amp = 0;
    pk.age = -1;
  }

  private schedule(after: number): void {
    const c = this.cfg;
    const p = this.peakCfg;
    const r = this.rand;
    this.start = after + c.minGap + (c.maxGap - c.minGap) * r();
    this.peak.raceTime = c.minRace + (c.maxRace - c.minRace) * r();
    this.boost = c.minBoost + (c.maxBoost - c.minBoost) * r();
    this.ahead = p.minAhead + (p.maxAhead - p.minAhead) * r();
    this.peak.riseTime = p.minRise + (p.maxRise - p.minRise) * r();
  }
}
