import { describe, expect, it } from 'vitest';
import { DeckEngineCore } from './DeckEngineCore';
import { TEL, TEL_FRAME, TEL_MASTER, TEL_SIZE, TEL_STRIDE, type DeckCommand } from './protocol';

const SR = 1000;
const pcm = new Float32Array(20_000).map((_, i) => i);
const load = (deck: 0 | 1, bpm: number): DeckCommand => ({
  t: 'load',
  deck,
  left: pcm,
  right: pcm,
  bpm,
  firstBeatSec: 0.25,
  memoryCuesSec: [],
  hotCuesSec: Array(8).fill(null),
});

describe('DeckEngineCore', () => {
  it('routes commands, renders both decks to their own outputs and writes telemetry', () => {
    const e = new DeckEngineCore(SR);
    e.command(load(0, 120));
    e.command(load(1, 124));
    e.command({ t: 'set', deck: 0, patch: { motorStartSec: 0 } });
    e.command({ t: 'play', deck: 0 });
    const [a, b, c, d] = [0, 0, 0, 0].map(() => new Float32Array(128));
    e.process(a!, b!, c!, d!, 128);
    expect(a![0]).toBe(250);
    expect(c![0]).toBe(0); // deck 2 is paused → silence, not a held sample
    const tel = new Float64Array(TEL_SIZE);
    e.writeTelemetry(tel, 4096);
    expect(tel[TEL.state]).toBe(1);
    expect(tel[TEL.posSec]).toBeCloseTo(0.378, 9);
    expect(tel[TEL_STRIDE + TEL.bpm]).toBe(124);
    expect(tel[TEL_MASTER]).toBe(0);
    expect(tel[TEL_FRAME]).toBe(4096);
  });

  it('collects deck events with their deck id', () => {
    const e = new DeckEngineCore(SR);
    e.command(load(1, 120));
    e.command({ t: 'hotcue', deck: 1, index: 2, down: true, shift: false });
    expect(e.drainEvents()).toEqual([{ deck: 1, e: { kind: 'hotcue', index: 2, sec: 0.25 } }]);
  });
});
