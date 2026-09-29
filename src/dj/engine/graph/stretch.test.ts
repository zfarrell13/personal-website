import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStretches, type StretchNode } from './stretch';

const ctx = {} as BaseAudioContext;
const fakeNode = () => ({ disconnect: vi.fn(), stop: vi.fn(async () => undefined) }) as unknown as StretchNode;

afterEach(() => vi.restoreAllMocks());

describe('createStretches', () => {
  it('returns every node and the largest latency', async () => {
    const lat = [0.06, 0.07];
    let i = 0;
    const r = await createStretches(ctx, 2, 1000, async () => ({ node: fakeNode(), latencySec: lat[i++]! }));
    expect(r?.nodes).toHaveLength(2);
    expect(r?.latencySec).toBe(0.07);
  });

  it('gives up after the timeout and stops nodes that arrive late (never hangs create)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const late = fakeNode();
    let arrive!: () => void;
    const r = await createStretches(ctx, 1, 10, () => new Promise((res) => (arrive = () => res({ node: late, latencySec: 0.07 }))));
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    arrive();
    await new Promise((res) => setTimeout(res, 0));
    expect(late.disconnect).toHaveBeenCalled();
    expect(late.stop).toHaveBeenCalled();
  });

  it('returns null when loading fails, releasing what was already made', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = fakeNode();
    let calls = 0;
    const r = await createStretches(ctx, 2, 1000, async () => {
      if (calls++ === 0) return { node: first, latencySec: 0.07 };
      throw new Error('no wasm');
    });
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalled();
  });
});
