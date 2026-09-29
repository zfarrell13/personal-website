import { STRETCH_BLOCK_MS, STRETCH_INTERVAL_MS } from '../../constants';

/** The package file, copied verbatim by scripts/build-worklets.ts (never bundled). */
const STRETCH_URL = '/vendor/SignalsmithStretch.mjs';

/** The AudioWorkletNode returned by signalsmith-stretch, with its remote methods (all async). */
export interface StretchNode extends AudioWorkletNode {
  schedule(o: { active?: boolean; semitones?: number; output?: number; tonalityHz?: number }): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  /** Live-input latency in seconds. */
  latency(): Promise<number>;
  configure(o: { blockMs?: number; intervalMs?: number; splitComputation?: boolean; preset?: 'default' | 'cheaper' }): Promise<unknown>;
}

/**
 * Creates a Signalsmith Stretch node in live-input mode (key lock).
 * The package inlines its WASM (base64) and registers its AudioWorklet from a
 * blob: URL built from its own source. It is served untouched from /vendor and
 * imported at runtime (bundler-ignored: Turbopack breaks the stringified worklet).
 */
export async function createStretch(ctx: BaseAudioContext): Promise<{ node: StretchNode; latencySec: number }> {
  const { default: SignalsmithStretch } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ STRETCH_URL
  )) as typeof import('signalsmith-stretch');
  const node = (await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  })) as StretchNode;
  await node.configure({ blockMs: STRETCH_BLOCK_MS, intervalMs: STRETCH_INTERVAL_MS, splitComputation: true });
  await node.schedule({ active: true, semitones: 0 });
  const latencySec = await node.latency();
  return { node, latencySec };
}

/** How long AudioEngine.create waits for Master Tempo before giving up on it. */
export const STRETCH_TIMEOUT_MS = 4000;

/**
 * Creates `count` stretch nodes, or resolves null if that fails or takes longer than
 * `timeoutMs` (Master Tempo is then disabled; the engine never hangs on it).
 * Nodes that arrive after the timeout are disconnected and stopped.
 */
export async function createStretches(
  ctx: BaseAudioContext,
  count: number,
  timeoutMs = STRETCH_TIMEOUT_MS,
  create: typeof createStretch = createStretch,
): Promise<{ nodes: StretchNode[]; latencySec: number } | null> {
  const made: StretchNode[] = [];
  const work = (async () => {
    let latencySec = 0;
    for (let i = 0; i < count; i++) {
      const s = await create(ctx);
      made.push(s.node);
      latencySec = Math.max(latencySec, s.latencySec);
    }
    return { nodes: made, latencySec };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const release = () => {
    for (const n of made) {
      n.disconnect();
      void n.stop().catch(() => undefined);
    }
  };
  try {
    const r = await Promise.race([work, timeout]);
    if (r === null) {
      console.warn(`Master Tempo unavailable (Signalsmith Stretch did not load within ${timeoutMs} ms)`);
      void work.then(release, release);
    }
    return r;
  } catch (err) {
    console.warn('Master Tempo unavailable (Signalsmith Stretch failed to load):', err);
    release();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
