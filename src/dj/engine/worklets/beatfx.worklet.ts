import { BeatFxCore } from '../fx/BeatFxCore';
import { PROCESSORS, type BeatFxMessage, type ClockMessage } from './messages';

/** The Beat FX unit: 1 stereo in, 1 stereo out, beat clock from the decks worklet over a MessagePort. */
class BeatFxProcessor extends AudioWorkletProcessor {
  private readonly core = new BeatFxCore(sampleRate);
  private readonly silence = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<BeatFxMessage>) => {
      const m = e.data;
      switch (m.t) {
        case 'set':
          this.core.setType(m.type);
          this.core.setDivision(m.divisionBeats);
          this.core.depth = m.depth;
          this.core.on = m.on;
          break;
        case 'latency':
          this.core.clock.latencyFrames = m.frames;
          break;
        case 'clockPort':
          m.port.onmessage = (ev: MessageEvent<ClockMessage>) => this.core.clock.update(ev.data.frame, ev.data.beat, ev.data.bpm);
          break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const n = out[0]!.length;
    const inp = inputs[0];
    const inL = inp?.[0] ?? this.silence;
    const inR = inp?.[1] ?? inL;
    this.core.process(inL, inR, out[0]!, out[1]!, n, currentFrame);
    return true;
  }
}

registerProcessor(PROCESSORS.beatFx, BeatFxProcessor);
