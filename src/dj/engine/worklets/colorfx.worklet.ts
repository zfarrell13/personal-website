import { ColorFxCore } from '../fx/ColorFxCore';
import { PROCESSORS, type ColorFxMessage } from './messages';

/** One per mixer channel: SWEEP / NOISE / CRUSH (other Colour FX are native nodes). 1 stereo in, 1 stereo out. */
class ColorFxProcessor extends AudioWorkletProcessor {
  private readonly core = new ColorFxCore(sampleRate);
  private readonly silence = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ColorFxMessage>) => {
      const m = e.data;
      if (m.t === 'set') this.core.set(m.type, m.knob, m.param);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const n = out[0]!.length;
    const inp = inputs[0];
    const inL = inp?.[0] ?? this.silence;
    const inR = inp?.[1] ?? inL;
    this.core.process(inL, inR, out[0]!, out[1]!, n);
    return true;
  }
}

registerProcessor(PROCESSORS.colorFx, ColorFxProcessor);
