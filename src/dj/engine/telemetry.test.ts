import { describe, expect, it } from 'vitest';
import { DeckEngineCore } from './core/DeckEngineCore';
import { TEL_SIZE } from './core/protocol';
import { applyTelemetry, audibleBeat, audiblePosSec, createTelemetry, deckBpm } from './telemetry';

const SR = 1000;
const pcm = new Float32Array(20_000);

describe('telemetry', () => {
  it('round-trips a worklet snapshot into the mutable object', () => {
    const e = new DeckEngineCore(SR);
    e.command({ t: 'load', deck: 0, left: pcm, right: pcm, bpm: 124, firstBeatSec: 0.25, memoryCuesSec: [], hotCuesSec: Array(8).fill(null) });
    e.command({ t: 'set', deck: 0, patch: { motorStartSec: 0, tempoPct: 2 } });
    e.command({ t: 'play', deck: 0 });
    const z = new Float32Array(128);
    e.process(z, z, z, z, 128);
    const data = new Float64Array(TEL_SIZE);
    e.writeTelemetry(data, 128);
    const t = createTelemetry(SR);
    applyTelemetry(t, data);
    expect(t.decks[0].loaded).toBe(true);
    expect(t.decks[0].state).toBe('PLAYING');
    expect(t.decks[0].posSec).toBeCloseTo(0.25 + 0.128 * 1.02, 9);
    expect(deckBpm(t.decks[0])).toBeCloseTo(124 * 1.02, 9);
    expect(t.master).toBe(0);
    expect(t.decks[1].loaded).toBe(false);
  });

  it('extrapolates to now and subtracts the output latency', () => {
    const t = createTelemetry(SR);
    Object.assign(t.decks[0], { loaded: true, posSec: 10, rate: 1, lengthSec: 100 });
    t.frame = 1000;
    t.latencySec = 0.1;
    expect(audiblePosSec(t, 0, 1500)).toBeCloseTo(10.4, 9);
  });

  it('extrapolates the beat the same way', () => {
    const t = createTelemetry(SR);
    Object.assign(t.decks[0], { loaded: true, beat: 8, rate: 1, bpm: 120, lengthSec: 100 });
    t.frame = 0;
    t.latencySec = 0.1;
    expect(audibleBeat(t, 0, 600)).toBeCloseTo(9, 9);
  });
});
