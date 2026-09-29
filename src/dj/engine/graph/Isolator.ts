import { eqGain, ISOLATOR_BANDS, toNativeQ } from '../mixer/MixerCore';
import { smooth } from './params';

export type Band = 'low' | 'mid' | 'high';

/**
 * Native LR4 3-band isolator: exactly the sections of MixerCore.ISOLATOR_BANDS
 * (the tested IsolatorCore reference), with Q converted for Web Audio by toNativeQ.
 * Band gain 0 = true kill.
 */
export class Isolator {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly bandGains: Record<Band, GainNode>;
  private readonly filters: BiquadFilterNode[] = [];

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    const make = (band: Band) => {
      let node: AudioNode = this.input;
      for (const s of ISOLATOR_BANDS[band]) {
        const f = new BiquadFilterNode(ctx, { type: s.type, frequency: s.freq, Q: toNativeQ(s.type, s.q) });
        this.filters.push(f);
        node = node.connect(f);
      }
      const g = new GainNode(ctx, { gain: 1 });
      node.connect(g).connect(this.output);
      return g;
    };
    this.bandGains = { low: make('low'), mid: make('mid'), high: make('high') };
  }

  /** Knob 0..1 (0.5 = 0 dB, 0 = kill). */
  set(band: Band, knob: number): void {
    smooth(this.bandGains[band].gain, eqGain(knob), this.ctx);
  }

  dispose(): void {
    this.input.disconnect();
    for (const f of this.filters) f.disconnect();
    for (const g of Object.values(this.bandGains)) g.disconnect();
    this.output.disconnect();
  }
}
