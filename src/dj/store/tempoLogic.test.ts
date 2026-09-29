import { describe, expect, it } from 'vitest';
import { applyTempoFader, effectiveTempoPct, neededSyncPct, quantizeTempo, syncRangeFor, trackSyncedTempo, type TempoControls } from './tempoLogic';

const deck = (over: Partial<TempoControls> = {}): TempoControls => ({ tempoFader: 0, tempoPct: 0, range: 10, tempoReset: false, sync: false, ...over });
const bpm = (bpms: readonly [number, number], d: TempoControls, i: 0 | 1) => bpms[i] * (1 + d.tempoPct / 100);

describe('tempo logic', () => {
  it('quantizes to the range resolution', () => {
    expect(quantizeTempo(1.234, 6)).toBeCloseTo(1.23, 9);
    expect(quantizeTempo(1.234, 10)).toBeCloseTo(1.25, 9);
    expect(quantizeTempo(12.3, 100)).toBeCloseTo(12.5, 9);
  });

  it('clamps to the range', () => {
    expect(quantizeTempo(9, 6)).toBe(6);
    expect(quantizeTempo(-30, 16)).toBe(-16);
    expect(effectiveTempoPct(deck({ tempoPct: 12, range: 10 }))).toBe(10);
    expect(effectiveTempoPct(deck({ tempoPct: 250, range: 100 }))).toBe(100);
  });

  it('TEMPO RESET plays at the original tempo', () => {
    expect(effectiveTempoPct(deck({ tempoPct: 4, tempoReset: true }))).toBe(0);
    expect(effectiveTempoPct(deck({ tempoPct: 4 }))).toBe(4);
  });

  it('an unsynced deck follows the fader absolutely', () => {
    const [a] = applyTempoFader([deck(), deck()], 0, 0.5, { master: -1, trackBpm: [120, 124] });
    expect(a.tempoPct).toBe(5);
    expect(a.tempoFader).toBe(0.5);
  });

  it('SYNC promotes the range to WIDE when needed', () => {
    const ctx = { master: 0 as const, trackBpm: [128, 100] as const };
    expect(neededSyncPct(ctx, 0, 1)).toBeCloseTo(28, 9);
    expect(syncRangeFor(28, 16)).toBe(100);
    expect(syncRangeFor(3.3, 6)).toBe(6);
  });

  it('moving a synced follower fader changes the master tempo and the follower tracks it', () => {
    const ctx = { master: 0 as const, trackBpm: [124, 120] as const };
    // follower already synced: 120 BPM track at +3.333 % = 124 BPM
    const decks = [deck(), deck({ sync: true, tempoPct: (4 / 120) * 100 })] as const;
    const [m, f] = applyTempoFader(decks, 1, 0.2, ctx);
    // +2 % on a 120 BPM track = +2.4 BPM → +1.935 % on the 124 BPM master
    expect(m.tempoPct).toBeCloseTo((2.4 / 124) * 100, 9);
    expect(m.tempoFader).toBe(0);
    expect(f.tempoFader).toBe(0.2);
    expect(bpm(ctx.trackBpm, f, 1)).toBeCloseTo(bpm(ctx.trackBpm, m, 0), 9);
  });

  it('a master fader move while synced updates the follower tempoPct', () => {
    const ctx = { master: 0 as const, trackBpm: [124, 120] as const };
    const decks = [deck(), deck({ sync: true, tempoPct: (4 / 120) * 100 })] as const;
    const [m, f] = applyTempoFader(decks, 0, 0.5, ctx);
    expect(m.tempoPct).toBe(5);
    expect(f.tempoPct).toBeCloseTo(((124 * 1.05) / 120 - 1) * 100, 9);
    expect(bpm(ctx.trackBpm, f, 1)).toBeCloseTo(bpm(ctx.trackBpm, m, 0), 9);
  });

  it('a master handover keeps the BPM continuous', () => {
    const bpms = [124, 120] as const;
    const synced = [deck(), deck({ sync: true, tempoPct: (4 / 120) * 100 })] as const;
    const [m, f] = applyTempoFader(synced, 0, -0.4, { master: 0, trackBpm: bpms });
    const before = bpm(bpms, f, 1);
    // deck 0 pauses → deck 1 becomes master; nothing is recomputed, the follower's tempoPct is already right
    expect(effectiveTempoPct(f)).toBeCloseTo(f.tempoPct, 1);
    expect(before).toBeCloseTo(bpm(bpms, m, 0), 9);
    // re-syncing under the new master changes nothing
    const [d0] = trackSyncedTempo([{ ...m, sync: true }, f], { master: 1, trackBpm: bpms });
    expect(bpm(bpms, d0, 0)).toBeCloseTo(before, 9);
    expect(d0.tempoPct).toBeCloseTo(m.tempoPct, 9);
  });

  it('promotes the follower range to WIDE and clamps the master to its own range', () => {
    const ctx = { master: 0 as const, trackBpm: [128, 100] as const };
    const [m, f] = applyTempoFader([deck({ range: 6 }), deck({ sync: true, range: 6 })], 0, 1, ctx);
    expect(m.tempoPct).toBe(6);
    expect(f.range).toBe(100);
    expect(f.tempoPct).toBeCloseTo(((128 * 1.06) / 100 - 1) * 100, 9);
  });

  it('clamps the master when a follower fader push exceeds its range', () => {
    const ctx = { master: 0 as const, trackBpm: [120, 120] as const };
    const [m, f] = applyTempoFader([deck({ tempoPct: 9, range: 10 }), deck({ sync: true, tempoPct: 9 })], 1, 1, ctx);
    expect(m.tempoPct).toBe(10);
    expect(bpm(ctx.trackBpm, f, 1)).toBeCloseTo(bpm(ctx.trackBpm, m, 0), 9);
  });
});
