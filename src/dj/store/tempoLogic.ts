import { TEMPO_RESOLUTION, type DeckId, type TempoRange } from '../constants';

export interface TempoControls {
  /** Physical fader −1 (top, slower) … +1 (bottom, faster). */
  tempoFader: number;
  /** Engine tempo in percent (may differ from fader × range after sync edits). */
  tempoPct: number;
  range: TempoRange;
  tempoReset: boolean;
  sync: boolean;
  /** The exact tempo SYNC left behind plays unquantized until the next fader touch (no jump, no drift). */
  tempoHeld?: boolean;
}

export interface SyncContext {
  master: DeckId | -1;
  /** Track BPMs of the loaded tracks (0 = empty). */
  trackBpm: readonly [number, number];
}

const clampPct = (pct: number, range: TempoRange) => Math.max(-range, Math.min(range, pct));

/** Quantize to the range's resolution and clamp to ±range (DeckCore applies tempoPct unclamped). */
export const quantizeTempo = (pct: number, range: TempoRange): number => {
  const res = TEMPO_RESOLUTION[range];
  return clampPct(Math.round(pct / res) * res, range);
};

/**
 * The tempo the engine should use for a deck. TEMPO RESET plays at the original tempo.
 * A synced deck's tempo is the exact match for the master, so it is clamped but never quantized;
 * so is the tempo a deck keeps after SYNC goes off, until the fader is touched.
 */
export const effectiveTempoPct = (d: TempoControls): number => {
  if (d.tempoReset) return 0;
  return d.sync || d.tempoHeld ? clampPct(d.tempoPct, d.range) : quantizeTempo(d.tempoPct, d.range);
};

/** SYNC promotes the range to WIDE when the needed tempo doesn't fit. */
export const syncRangeFor = (neededPct: number, range: TempoRange): TempoRange => (Math.abs(neededPct) > range ? 100 : range);

/** Percent the follower needs to match the master's current BPM. */
export function neededSyncPct(ctx: SyncContext, masterPct: number, follower: DeckId): number {
  if (ctx.master === -1 || ctx.trackBpm[follower] === 0) return 0;
  const masterBpm = ctx.trackBpm[ctx.master] * (1 + masterPct / 100);
  return (masterBpm / ctx.trackBpm[follower] - 1) * 100;
}

/**
 * Keep every synced follower's tempoPct (and range, promoted to WIDE if needed) on the
 * master's tempo, so a master handover never snaps the tempo. Call after any change to
 * a tempo, to SYNC, or to the master. Returns the same array when nothing changes.
 */
export function trackSyncedTempo<T extends TempoControls>(decks: readonly [T, T], ctx: SyncContext): [T, T] {
  const m = ctx.master;
  const out: [T, T] = [decks[0], decks[1]];
  if (m === -1 || ctx.trackBpm[m] <= 0) return out;
  const masterPct = effectiveTempoPct(decks[m]); // what the master actually plays
  for (const i of [0, 1] as const) {
    const d = decks[i];
    if (i === m || !d.sync || ctx.trackBpm[i] <= 0) continue;
    const needed = neededSyncPct(ctx, masterPct, i);
    const range = syncRangeFor(needed, d.range);
    if (needed !== d.tempoPct || range !== d.range) out[i] = { ...d, tempoPct: needed, range };
  }
  return out;
}

/**
 * Tempo fader moved. Unsynced (or master) decks follow the fader absolutely.
 * On a synced follower, the fader change is applied to the MASTER's tempo
 * (CDJ-3000 BEAT SYNC: moving a synced deck's fader changes the master tempo);
 * the follower then re-tracks the (new) master tempo.
 */
export function applyTempoFader<T extends TempoControls>(decks: readonly [T, T], deck: DeckId, fader: number, ctx: SyncContext): [T, T] {
  const next: [T, T] = [{ ...decks[0] }, { ...decks[1] }];
  const d = next[deck];
  const f = Math.max(-1, Math.min(1, fader));
  const deltaPct = (f - d.tempoFader) * d.range;
  d.tempoFader = f;
  d.tempoPct = f * d.range;
  d.tempoHeld = false;
  const m = ctx.master;
  if (d.sync && m !== -1 && m !== deck && ctx.trackBpm[deck] > 0 && ctx.trackBpm[m] > 0) {
    const master = next[m];
    const deltaBpm = (ctx.trackBpm[deck] * deltaPct) / 100;
    master.tempoPct = clampPct(master.tempoPct + (deltaBpm / ctx.trackBpm[m]) * 100, master.range);
  }
  return trackSyncedTempo(next, ctx);
}
