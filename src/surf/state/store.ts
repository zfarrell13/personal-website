import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Side } from '../config';
import type { WipeoutReason } from '../physics/events';

export type Phase = 'loading' | 'title' | 'playing' | 'paused' | 'results';

export interface TickerItem {
  id: number;
  text: string;
  points: number;
}

export interface RunSummary {
  score: number;
  side: Side;
  end: 'wipeout' | 'kickedOut';
  wipeoutReason: WipeoutReason | null;
  bestCombo: number;
  longestTube: number;
  tricks: number;
  durationSec: number;
}

export interface NowPlaying {
  key: number;
  title: string;
  artist: string;
}

export interface SurfHudState {
  phase: Phase;
  side: Side;
  score: number;
  pot: number;
  multiplier: number;
  tubeTime: number;
  speedKmh: number;
  ticker: TickerItem[];
  nowPlaying: NowPlaying | null;
  run: RunSummary | null;
  underwater: boolean;
  /** A fast section is on: the HUD shows ⚡ FAST SECTION. */
  fastSection: boolean;
}

export type SurfStore = StoreApi<SurfHudState>;

export const INITIAL_HUD: SurfHudState = {
  phase: 'loading',
  side: 'right',
  score: 0,
  pot: 0,
  multiplier: 0,
  tubeTime: 0,
  speedKmh: 0,
  ticker: [],
  nowPlaying: null,
  run: null,
  underwater: false,
  fastSection: false,
};

/** Vanilla (React-free) store; the engine writes, HUD components read via `useStore`. */
export function createSurfStore(): SurfStore {
  return createStore<SurfHudState>()(() => ({ ...INITIAL_HUD }));
}

export const MAX_TICKER = 5;

export function pushTicker(list: readonly TickerItem[], item: TickerItem): TickerItem[] {
  return [...list, item].slice(-MAX_TICKER);
}

/**
 * Coalesces engine -> store writes to at most `hz` per second so React
 * re-renders the HUD at <= 15 Hz. `push` merges into a pending patch; `tick`
 * flushes when the interval has elapsed; `flush` forces it (phase changes).
 */
export class ThrottledWriter {
  private pending: Partial<SurfHudState> | null = null;
  private last = -Infinity;

  constructor(
    private readonly store: SurfStore,
    private readonly hz = 15,
  ) {}

  push(patch: Partial<SurfHudState>): void {
    this.pending = this.pending ? { ...this.pending, ...patch } : { ...patch };
  }

  tick(nowMs: number): boolean {
    if (!this.pending || nowMs - this.last < 1000 / this.hz) return false;
    this.store.setState(this.pending);
    this.pending = null;
    this.last = nowMs;
    return true;
  }

  flush(nowMs: number): void {
    if (this.pending) this.store.setState(this.pending);
    this.pending = null;
    this.last = nowMs;
  }
}
