import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeatFxRouter } from './BeatFxRouter';

/** Minimal Web Audio stand-ins: the router only needs gains, connect/disconnect and a clock. */
class FakeParam {
  constructor(public value: number) {}
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
}
class FakeNode {
  readonly connected = new Set<FakeNode>();
  connect(n: FakeNode) {
    this.connected.add(n);
    return n;
  }
  disconnect(n?: FakeNode) {
    if (n) this.connected.delete(n);
    else this.connected.clear();
  }
}
class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(_ctx: unknown, opts?: { gain?: number }) {
    super();
    this.gain = new FakeParam(opts?.gain ?? 1);
  }
}
class FakeWorklet extends FakeNode {
  readonly port = { postMessage() {}, close() {} };
}

beforeEach(() => {
  vi.stubGlobal('GainNode', FakeGain);
  vi.stubGlobal('AudioWorkletNode', FakeWorklet);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const ctx = { currentTime: 0 };
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const router = new BeatFxRouter(ctx as unknown as BaseAudioContext, (ms, fn) => void timers.push({ ms, fn }));
  const fx = router.node as unknown as FakeWorklet;
  const wiredTo = () => (Object.keys(router.points) as Array<keyof typeof router.points>).find((k) => fx.connected.has(router.points[k].ret as unknown as FakeNode));
  const runNext = (atSec: number) => {
    ctx.currentTime = atSec;
    timers.shift()!.fn();
  };
  return { ctx, timers, router, wiredTo, runNext };
}

describe('BeatFxRouter insert moves', () => {
  it('moves the FX to the selected point after the settle time', () => {
    const s = setup();
    expect(s.wiredTo()).toBe('MASTER');
    s.router.select('1');
    expect(s.timers).toHaveLength(1);
    s.runNext(0.03);
    expect(s.wiredTo()).toBe('1');
  });

  it('re-arms the settle timer when the old point faded out again late (rapid back-and-forth selection)', () => {
    const s = setup();
    s.router.select('1'); // MASTER fades out at t = 0, move scheduled for +30 ms
    s.ctx.currentTime = 0.025;
    s.router.select('MASTER'); // back before the move: MASTER fades straight back in
    s.ctx.currentTime = 0.028;
    s.router.select('2'); // MASTER fades out again — only 2 ms before the scheduled move
    s.runNext(0.03);
    // MASTER has not settled yet: unwiring it now would cut its still-audible return
    expect(s.wiredTo()).toBe('MASTER');
    expect(s.timers).toHaveLength(1);
    expect(s.timers[0]!.ms).toBeCloseTo(28, 6);
    s.runNext(0.058);
    expect(s.wiredTo()).toBe('2');
    expect(s.timers).toHaveLength(0);
  });
});
