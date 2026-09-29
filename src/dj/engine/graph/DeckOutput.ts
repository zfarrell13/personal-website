import { mtFadeCurves, mtSemitones, semitonesChanged } from '../masterTempo';
import { rampCurve } from './params';
import type { StretchNode } from './stretch';

/**
 * Deck worklet output → (dry: DelayNode = stretch latency) + (wet: Signalsmith Stretch)
 * → equal-power 20 ms crossfade. Both paths have the same latency, so switching
 * Master Tempo on/off is time-aligned.
 */
export class DeckOutput {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: DelayNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private wet = false;
  private semitones = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly stretch: StretchNode | null,
    readonly latencySec: number,
  ) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.dry = new DelayNode(ctx, { maxDelayTime: 1, delayTime: latencySec });
    this.dryGain = new GainNode(ctx, { gain: 1 });
    this.wetGain = new GainNode(ctx, { gain: 0 });
    this.input.connect(this.dry).connect(this.dryGain).connect(this.output);
    if (stretch) this.input.connect(stretch).connect(this.wetGain).connect(this.output);
  }

  /** True while the key-locked (stretched) path is selected. */
  get isWet(): boolean {
    return this.wet;
  }

  get hasMasterTempo(): boolean {
    return this.stretch !== null;
  }

  setWet(wet: boolean): void {
    if (!this.stretch || wet === this.wet) return;
    this.wet = wet;
    const t = this.ctx.currentTime;
    // Continue from where the gains are now (the gate can flip mid-fade).
    const f = mtFadeCurves(this.wetGain.gain.value, wet);
    if (f.durationSec <= 0) return;
    rampCurve(this.wetGain.gain, f.wet, t, f.durationSec);
    rampCurve(this.dryGain.gain, f.dry, t, f.durationSec);
  }

  /** Keeps the key constant: shifts by −12·log2(rate) semitones (only when it moves ≥ 0.01 st). */
  setRate(rate: number): void {
    if (!this.stretch) return;
    const st = mtSemitones(rate);
    if (!semitonesChanged(st, this.semitones)) return;
    this.semitones = st;
    void this.stretch.schedule({ semitones: st });
  }

  dispose(): void {
    this.input.disconnect();
    this.dry.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.output.disconnect();
    if (this.stretch) {
      this.stretch.disconnect();
      void this.stretch.stop().catch(() => undefined);
    }
  }
}
