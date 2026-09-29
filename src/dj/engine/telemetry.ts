import type { DeckId } from '../constants';
import type { TransportState } from './core/DeckCore';
import { STATE_CODES, TEL, TEL_FRAME, TEL_MASTER, TEL_STRIDE } from './core/protocol';

/** Mutable per-deck telemetry, updated ~60×/s from the decks worklet. Read by rAF loops, never by React state. */
export interface DeckTelemetry {
  loaded: boolean;
  state: TransportState;
  posSec: number;
  rate: number;
  baseRate: number;
  beat: number;
  cueSec: number;
  atCue: boolean;
  loopInSec: number;
  loopOutSec: number;
  loopActive: boolean;
  slipFlags: number;
  shadowSec: number;
  scratching: boolean;
  /** Gliding back to motor speed after a scratch. */
  releasing: boolean;
  ended: boolean;
  lengthSec: number;
  synced: boolean;
  trim: number;
  motor: number;
  bpm: number;
}

export interface MixerLevels {
  /** Pre-fader peak per channel (mono). */
  ch: [number, number];
  /** Master peak [L, R]. */
  master: [number, number];
  /** Smoothed low-band RMS of the master (club energy input). */
  lowRms: number;
}

export interface EngineTelemetry {
  decks: [DeckTelemetry, DeckTelemetry];
  master: DeckId | -1;
  /** AudioContext frame at which the snapshot was taken. */
  frame: number;
  sampleRate: number;
  /** Stretch latency (dry path is delayed by the same amount) + context output latency, seconds. */
  latencySec: number;
  levels: MixerLevels;
}

const emptyDeck = (): DeckTelemetry => ({
  loaded: false,
  state: 'PAUSED',
  posSec: 0,
  rate: 0,
  baseRate: 1,
  beat: 0,
  cueSec: 0,
  atCue: false,
  loopInSec: NaN,
  loopOutSec: NaN,
  loopActive: false,
  slipFlags: 0,
  shadowSec: 0,
  scratching: false,
  releasing: false,
  ended: false,
  lengthSec: 0,
  synced: false,
  trim: 0,
  motor: 0,
  bpm: 0,
});

export function createTelemetry(sampleRate = 48000): EngineTelemetry {
  return {
    decks: [emptyDeck(), emptyDeck()],
    master: -1,
    frame: 0,
    sampleRate,
    latencySec: 0,
    levels: { ch: [0, 0], master: [0, 0], lowRms: 0 },
  };
}

/** Copies a worklet snapshot into the mutable telemetry object (no allocation). */
export function applyTelemetry(t: EngineTelemetry, data: Float64Array): void {
  for (const id of [0, 1] as const) {
    const o = id * TEL_STRIDE;
    const d = t.decks[id];
    d.loaded = data[o + TEL.loaded] === 1;
    d.state = STATE_CODES[data[o + TEL.state]!] ?? 'PAUSED';
    d.posSec = data[o + TEL.posSec]!;
    d.rate = data[o + TEL.rate]!;
    d.baseRate = data[o + TEL.baseRate]!;
    d.beat = data[o + TEL.beat]!;
    d.cueSec = data[o + TEL.cueSec]!;
    d.atCue = data[o + TEL.atCue] === 1;
    d.loopInSec = data[o + TEL.loopInSec]!;
    d.loopOutSec = data[o + TEL.loopOutSec]!;
    d.loopActive = data[o + TEL.loopActive] === 1;
    d.slipFlags = data[o + TEL.slipFlags]!;
    d.shadowSec = data[o + TEL.shadowSec]!;
    d.scratching = data[o + TEL.scratching] === 1;
    d.releasing = data[o + TEL.releasing] === 1;
    d.ended = data[o + TEL.ended] === 1;
    d.lengthSec = data[o + TEL.lengthSec]!;
    d.synced = data[o + TEL.synced] === 1;
    d.trim = data[o + TEL.trim]!;
    d.motor = data[o + TEL.motor]!;
    d.bpm = data[o + TEL.bpm]!;
  }
  const m = data[TEL_MASTER]!;
  t.master = m === 0 || m === 1 ? m : -1;
  t.frame = data[TEL_FRAME]!;
}

/**
 * Position the listener hears now: extrapolates the snapshot to `nowFrame`
 * (AudioContext.currentTime × sampleRate) and subtracts the output latency.
 */
export function audiblePosSec(t: EngineTelemetry, deck: DeckId, nowFrame: number): number {
  const d = t.decks[deck];
  if (!d.loaded) return 0;
  const elapsed = Math.max(0, nowFrame - t.frame) / t.sampleRate;
  const p = d.posSec + d.rate * (elapsed - t.latencySec);
  return Math.min(d.lengthSec, Math.max(0, p));
}

/** Beat position the listener hears now (same extrapolation and latency as audiblePosSec). */
export function audibleBeat(t: EngineTelemetry, deck: DeckId, nowFrame: number): number {
  const d = t.decks[deck];
  if (!d.loaded) return 0;
  const elapsed = Math.max(0, nowFrame - t.frame) / t.sampleRate;
  return d.beat + (d.rate * (elapsed - t.latencySec) * d.bpm) / 60;
}

/** Current effective BPM of a deck (track BPM × applied rate). */
export const deckBpm = (d: DeckTelemetry): number => d.bpm * d.baseRate;
