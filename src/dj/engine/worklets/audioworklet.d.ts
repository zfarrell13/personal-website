/**
 * Minimal AudioWorkletGlobalScope declarations (TypeScript's DOM lib has none).
 * Only the *.worklet.ts files use these; they run inside the audio rendering thread.
 * Checked by ./tsconfig.json (excluded from the root project so main-thread code cannot see them).
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;
