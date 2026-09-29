import type { ColorFxType } from '../../constants';
import { toNativeQ } from '../mixer/MixerCore';
import { PROCESSORS, type ColorFxMessage } from '../worklets/messages';
import { smooth } from './params';

const spaceIRs = new WeakMap<BaseAudioContext, AudioBuffer>();

/** The 2.4 s decaying-noise impulse response for SPACE: deterministic, generated once per context. */
function spaceIR(ctx: BaseAudioContext): AudioBuffer {
  let ir = spaceIRs.get(ctx);
  if (!ir) {
    ir = makeSpaceIR(ctx);
    spaceIRs.set(ctx, ir);
  }
  return ir;
}

function makeSpaceIR(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(ctx.sampleRate * 2.4);
  const ir = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: ctx.sampleRate });
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.exp((-4.5 * i) / len);
  }
  return ir;
}

/**
 * Per-channel Colour FX. Knob −1..1 (0 = off), PARAMETER 0..1.
 *  - SPACE: reverb send (ConvolverNode) → LPF (left) / HPF (right) on the return.  [native]
 *  - DUB ECHO: ¾-beat feedback delay with LPF/HPF in the loop.                     [native]
 *  - FILTER: resonant LPF (left) / HPF (right).                                   [native]
 *  - SWEEP, NOISE, CRUSH: sample-level DSP in the colorfx worklet.                [worklet]
 * Tails of SPACE / DUB ECHO ring out after the knob returns to centre.
 */
export class ColorFxUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly worklet: AudioWorkletNode;
  private readonly filter: BiquadFilterNode;
  private readonly filterWet: GainNode;
  private readonly filterDry: GainNode;
  private readonly spaceSend: GainNode;
  private readonly spaceTone: BiquadFilterNode;
  private readonly spaceReturn: GainNode;
  private readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoTone: BiquadFilterNode;
  private readonly echoFeedback: GainNode;
  private readonly nodes: AudioNode[];

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.worklet = new AudioWorkletNode(ctx, PROCESSORS.colorFx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const mid = new GainNode(ctx);
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000 });
    this.filterWet = new GainNode(ctx, { gain: 0 });
    this.filterDry = new GainNode(ctx, { gain: 1 });
    this.input.connect(this.worklet);
    this.worklet.connect(this.filterDry).connect(mid);
    this.worklet.connect(this.filter).connect(this.filterWet).connect(mid);
    mid.connect(this.output);

    this.spaceSend = new GainNode(ctx, { gain: 0 });
    const conv = new ConvolverNode(ctx, { buffer: spaceIR(ctx), disableNormalization: false });
    this.spaceTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000 });
    this.spaceReturn = new GainNode(ctx, { gain: 0.8 });
    mid.connect(this.spaceSend).connect(conv).connect(this.spaceTone).connect(this.spaceReturn).connect(this.output);

    this.echoSend = new GainNode(ctx, { gain: 0 });
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 4, delayTime: 0.375 });
    this.echoTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000 });
    this.echoFeedback = new GainNode(ctx, { gain: 0.6 });
    mid.connect(this.echoSend).connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone).connect(this.echoFeedback).connect(this.echoDelay);
    this.echoTone.connect(this.output);

    this.nodes = [
      this.input,
      this.worklet,
      mid,
      this.filter,
      this.filterWet,
      this.filterDry,
      this.spaceSend,
      conv,
      this.spaceTone,
      this.spaceReturn,
      this.echoSend,
      this.echoDelay,
      this.echoTone,
      this.echoFeedback,
      this.output,
    ];
  }

  /** Applies the selected type, this channel's knob, PARAMETER and the master BPM (DUB ECHO time). */
  set(type: ColorFxType, knob: number, param: number, bpm: number): void {
    const ctx = this.ctx;
    const a = Math.abs(knob) < 0.02 ? 0 : Math.abs(knob);
    const left = knob < 0;
    const msg: ColorFxMessage = { t: 'set', type, knob: a === 0 ? 0 : knob, param };
    this.worklet.port.postMessage(msg);

    // FILTER
    if (type === 'FILTER' && a > 0) {
      this.filter.type = left ? 'lowpass' : 'highpass';
      const f = left ? 20000 * 2 ** (-a * 7.5) : 20 * 2 ** (a * 9);
      smooth(this.filter.frequency, f, ctx);
      smooth(this.filter.Q, toNativeQ('lowpass', 0.7 + param * 11), ctx);
      smooth(this.filterWet.gain, 1, ctx, 0.005);
      smooth(this.filterDry.gain, 0, ctx, 0.005);
    } else {
      smooth(this.filterWet.gain, 0, ctx, 0.005);
      smooth(this.filterDry.gain, 1, ctx, 0.005);
    }

    // SPACE
    const spaceOn = type === 'SPACE' ? a : 0;
    smooth(this.spaceSend.gain, spaceOn * 0.9, ctx);
    if (type === 'SPACE' && a > 0) {
      this.spaceTone.type = left ? 'lowpass' : 'highpass';
      smooth(this.spaceTone.frequency, left ? 12000 * 2 ** (-a * 5) : 60 * 2 ** (a * 5), ctx);
      smooth(this.spaceReturn.gain, 0.5 + param, ctx);
    }

    // DUB ECHO
    const echoOn = type === 'DUB_ECHO' ? a : 0;
    smooth(this.echoSend.gain, echoOn, ctx);
    smooth(this.echoDelay.delayTime, Math.min(3.9, (0.75 * 60) / Math.max(40, bpm)), ctx, 0.05);
    if (type === 'DUB_ECHO' && a > 0) {
      this.echoTone.type = left ? 'lowpass' : 'highpass';
      smooth(this.echoTone.frequency, left ? 8000 * 2 ** (-a * 4) : 100 * 2 ** (a * 4), ctx);
      smooth(this.echoFeedback.gain, 0.4 + param * 0.45, ctx);
    }
  }

  dispose(): void {
    this.worklet.port.close();
    for (const n of this.nodes) n.disconnect();
  }
}
