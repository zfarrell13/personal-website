import { describe, expect, it } from 'vitest';
import { checkSupport } from './support';

const fakeWindow = (webgl2: boolean, worklet: boolean) =>
  ({
    document: { createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' && webgl2 ? {} : null) }) },
    AudioWorkletNode: worklet ? function AudioWorkletNode() {} : undefined,
  }) as unknown as Window;

describe('checkSupport', () => {
  it('detects both features', () => {
    expect(checkSupport(fakeWindow(true, true))).toEqual({ webgl2: true, audioWorklet: true });
  });
  it('detects missing features', () => {
    expect(checkSupport(fakeWindow(false, false))).toEqual({ webgl2: false, audioWorklet: false });
  });
  it('treats a throwing getContext as unsupported', () => {
    const w = { document: { createElement: () => ({ getContext: () => { throw new Error('x'); } }) } } as unknown as Window;
    expect(checkSupport(w).webgl2).toBe(false);
  });
});
