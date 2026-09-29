/**
 * signalsmith-stretch 1.3.2 ships no types. Shape verified against SignalsmithStretch.mjs.
 * Used only as a type: at runtime the untouched copy served from /vendor is imported
 * (see src/dj/engine/graph/stretch.ts and scripts/build-worklets.ts).
 */
declare module 'signalsmith-stretch' {
  const SignalsmithStretch: (context: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioWorkletNode>;
  export default SignalsmithStretch;
}
