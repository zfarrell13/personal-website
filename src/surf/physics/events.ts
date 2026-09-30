export type GrabKind = 'method' | 'rail' | 'stalefish' | 'indy';
export type WipeoutReason = 'swallowed' | 'badLanding' | 'grabbing' | 'whitewater';
export type LaunchKind = 'ollie' | 'crest';

export interface GrabRecord {
  kind: GrabKind;
  heldSec: number;
}

/** Everything the surfer physics announces. `time` is simulation seconds. */
export type SurfEvent =
  | { type: 'launched'; time: number; kind: LaunchKind }
  | { type: 'landed'; time: number; spinDeg: number; grabs: GrabRecord[]; revert: boolean; ollie: boolean; airTime: number }
  | { type: 'grabStart'; time: number; kind: GrabKind }
  | { type: 'grabEnd'; time: number; kind: GrabKind; heldSec: number }
  | { type: 'snap'; time: number }
  | { type: 'carve'; time: number; degrees: number }
  | { type: 'pump'; time: number; efficiency: number }
  | { type: 'floaterStart'; time: number }
  | { type: 'floaterEnd'; time: number; duration: number; landed: boolean }
  | { type: 'tubeEnter'; time: number }
  | { type: 'tubeExit'; time: number; duration: number }
  | { type: 'wipeout'; time: number; reason: WipeoutReason }
  | { type: 'kickedOut'; time: number }
  /** A fast section begins (the peel speeds up by `boost` × Vp). */
  | { type: 'fastSection'; time: number; boost: number }
  /** A fast section ended with the rider still up. */
  | { type: 'sectionMade'; time: number };

export type SurfEventType = SurfEvent['type'];
export type EventOf<T extends SurfEventType> = Extract<SurfEvent, { type: T }>;

/**
 * Tiny typed pub/sub. Physics emits; scoring, audio, particles and the camera
 * subscribe — nothing reaches into another module's state.
 */
export class EventBus<E extends { type: string }> {
  private readonly handlers = new Map<string, Set<(e: E) => void>>();
  private readonly any = new Set<(e: E) => void>();

  on<T extends E['type']>(type: T, fn: (e: Extract<E, { type: T }>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn as (e: E) => void);
    this.handlers.set(type, set);
    return () => set.delete(fn as (e: E) => void);
  }

  onAny(fn: (e: E) => void): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit(e: E): void {
    this.handlers.get(e.type)?.forEach((fn) => fn(e));
    this.any.forEach((fn) => fn(e));
  }

  clear(): void {
    this.handlers.clear();
    this.any.clear();
  }
}
