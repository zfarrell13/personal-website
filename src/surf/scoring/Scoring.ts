import type { SurfConfig } from '../config';
import type { EventBus, GrabKind, SurfEvent } from '../physics/events';

export type TrickName =
  | 'Ollie'
  | 'Snap'
  | 'Floater'
  | 'Barrel'
  | 'Air 180'
  | 'Air 360'
  | 'Air 540'
  | 'Air 720'
  | 'Method'
  | 'Rail Grab'
  | 'Stalefish'
  | 'Indy'
  | 'Revert'
  | 'Section Made';

export const TRICK_BASE = {
  Ollie: 100,
  Snap: 250,
  Revert: 150,
  sectionMade: 500,
  floaterBase: 400,
  floaterPerSec: 100,
  barrelPerSec: 500,
  grabBase: 200,
  grabPerHalfSec: 150,
  spins: { 180: 300, 360: 700, 540: 1200, 720: 1800 } as Record<number, number>,
} as const;

export const GRAB_NAMES: Record<GrabKind, TrickName> = {
  method: 'Method',
  rail: 'Rail Grab',
  stalefish: 'Stalefish',
  indy: 'Indy',
};

export interface TrickAward {
  name: TrickName;
  /** Points added to the pot (after the repeat penalty). */
  points: number;
  repeated: boolean;
}

export interface ScoringListener {
  onAward?(a: TrickAward): void;
  onBank?(banked: { points: number; pot: number; multiplier: number }): void;
  onLost?(pot: number): void;
}

export function spinPoints(spinDeg: number): { name: TrickName; points: number } | null {
  if (spinDeg < 180) return null;
  const capped = Math.min(720, spinDeg);
  return { name: `Air ${capped}` as TrickName, points: TRICK_BASE.spins[capped]! };
}

export function grabPoints(heldSec: number): number {
  return TRICK_BASE.grabBase + TRICK_BASE.grabPerHalfSec * Math.floor(heldSec / 0.5);
}

/**
 * Combo scoring. Every trick adds to the pot; the multiplier is the number of
 * distinct tricks in the combo. The combo stays alive while another trick (or
 * a 60°+ carve) lands within `comboWindow`; then pot × multiplier is banked.
 * A wipeout loses the unbanked pot. Repeats within a combo score half.
 */
export class Scoring {
  score = 0;
  pot = 0;
  bestCombo = 0;
  longestTube = 0;
  tricksLanded = 0;
  private readonly distinct = new Set<TrickName>();
  private lastActivity = -Infinity;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly cfg: SurfConfig['scoring'],
    private readonly listener: ScoringListener = {},
  ) {}

  get multiplier(): number {
    return this.distinct.size;
  }

  get comboActive(): boolean {
    return this.distinct.size > 0;
  }

  reset(): void {
    this.score = 0;
    this.pot = 0;
    this.bestCombo = 0;
    this.longestTube = 0;
    this.tricksLanded = 0;
    this.distinct.clear();
    this.lastActivity = -Infinity;
  }

  /** Subscribe to surfer events. Returns an unsubscribe function. */
  attach(bus: EventBus<SurfEvent>): () => void {
    this.unsubscribe.push(
      bus.on('landed', (e) => {
        if (e.ollie) this.award('Ollie', TRICK_BASE.Ollie, e.time);
        const spin = spinPoints(e.spinDeg);
        if (spin) this.award(spin.name, spin.points, e.time);
        for (const g of e.grabs) this.award(GRAB_NAMES[g.kind], grabPoints(g.heldSec), e.time);
        if (e.revert) this.award('Revert', TRICK_BASE.Revert, e.time);
        this.touch(e.time);
      }),
      bus.on('snap', (e) => this.award('Snap', TRICK_BASE.Snap, e.time)),
      bus.on('floaterEnd', (e) => {
        if (e.landed) this.award('Floater', Math.round(TRICK_BASE.floaterBase + TRICK_BASE.floaterPerSec * e.duration), e.time);
      }),
      bus.on('tubeExit', (e) => {
        this.longestTube = Math.max(this.longestTube, e.duration);
        this.award('Barrel', Math.round(TRICK_BASE.barrelPerSec * e.duration), e.time);
      }),
      bus.on('sectionMade', (e) => this.award('Section Made', TRICK_BASE.sectionMade, e.time)),
      bus.on('carve', (e) => this.touch(e.time)),
      bus.on('launched', (e) => this.touch(e.time)),
      bus.on('wipeout', () => this.lose()),
      bus.on('kickedOut', () => this.bank()),
    );
    return () => this.unsubscribe.splice(0).forEach((u) => u());
  }

  award(name: TrickName, basePoints: number, time: number): TrickAward {
    const repeated = this.distinct.has(name);
    const points = Math.round(repeated ? basePoints * this.cfg.repeatFactor : basePoints);
    this.distinct.add(name);
    this.pot += points;
    this.tricksLanded++;
    this.lastActivity = time;
    const a = { name, points, repeated };
    this.listener.onAward?.(a);
    return a;
  }

  /** Keep an active combo alive (carves, launches) without scoring. */
  touch(time: number): void {
    if (this.comboActive) this.lastActivity = time;
  }

  /**
   * Call every tick. `holding` (airborne, in the tube, floating) keeps the
   * combo from expiring while a trick is still in progress.
   */
  update(time: number, holding: boolean): void {
    if (!this.comboActive) return;
    if (holding) {
      this.lastActivity = time;
      return;
    }
    if (time - this.lastActivity > this.cfg.comboWindow) this.bank();
  }

  bank(): void {
    if (!this.comboActive) return;
    const multiplier = this.multiplier;
    const points = this.pot * multiplier;
    this.score += points;
    this.bestCombo = Math.max(this.bestCombo, points);
    this.listener.onBank?.({ points, pot: this.pot, multiplier });
    this.pot = 0;
    this.distinct.clear();
  }

  lose(): void {
    const pot = this.pot;
    this.pot = 0;
    this.distinct.clear();
    if (pot > 0) this.listener.onLost?.(pot);
  }
}
