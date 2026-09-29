import type { ColorFxType, CurveKind } from '../../constants';
import { channelFaderGain, trimGain } from '../mixer/MixerCore';
import { ColorFxUnit } from './ColorFxUnit';
import { Isolator, type Band } from './Isolator';
import { smooth } from './params';

/**
 * TRIM → ISOLATOR → COLOUR FX → (CUE tap, meter tap) → CHANNEL FADER → output.
 */
export class ChannelStrip {
  readonly input: GainNode;
  readonly cueTap: GainNode;
  readonly output: GainNode;
  readonly meter: AnalyserNode;
  readonly isolator: Isolator;
  readonly colorFx: ColorFxUnit;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx, { gain: 1 });
    this.isolator = new Isolator(ctx);
    this.colorFx = new ColorFxUnit(ctx);
    this.cueTap = new GainNode(ctx, { gain: 0 });
    this.output = new GainNode(ctx, { gain: 0 });
    this.meter = new AnalyserNode(ctx, { fftSize: 1024 });
    this.input.connect(this.isolator.input);
    this.isolator.output.connect(this.colorFx.input);
    this.colorFx.output.connect(this.output);
    this.colorFx.output.connect(this.cueTap);
    this.colorFx.output.connect(this.meter);
  }

  setTrim(knob: number): void {
    smooth(this.input.gain, trimGain(knob), this.ctx);
  }
  setEq(band: Band, knob: number): void {
    this.isolator.set(band, knob);
  }
  setFader(pos: number, curve: CurveKind): void {
    smooth(this.output.gain, channelFaderGain(pos, curve), this.ctx, 0.005);
  }
  setCue(on: boolean): void {
    smooth(this.cueTap.gain, on ? 1 : 0, this.ctx, 0.005);
  }
  setColorFx(type: ColorFxType, knob: number, param: number, bpm: number): void {
    this.colorFx.set(type, knob, param, bpm);
  }

  dispose(): void {
    this.input.disconnect();
    this.isolator.dispose();
    this.colorFx.dispose();
    this.cueTap.disconnect();
    this.output.disconnect();
    this.meter.disconnect();
  }
}
