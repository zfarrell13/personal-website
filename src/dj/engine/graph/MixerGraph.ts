import type { CurveKind, DeckId, FxChannel, HeadphoneMode, XfAssign } from '../../constants';
import { crossfaderGains, levelGain, peakOf, rmsOf, softClipCurve } from '../mixer/MixerCore';
import type { MixerLevels } from '../telemetry';
import { BeatFxRouter } from './BeatFxRouter';
import { ChannelStrip } from './ChannelStrip';
import { HeadphoneOutput, headphoneRouting } from './HeadphoneOutput';
import { smooth } from './params';

/** Master limiter: −3 dB threshold, 20:1, hard knee, 1 ms attack. */
export const LIMITER_OPTIONS: DynamicsCompressorOptions = { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.12 };

/**
 * CH1/CH2 strips → Beat FX insert (CH) → XF assign (A / THRU / B) → crossfader buses
 * (with XF-A / XF-B inserts) → Σ → MASTER insert → MASTER LEVEL → limiter → soft clip → out.
 */
export class MixerGraph {
  readonly channels: readonly [ChannelStrip, ChannelStrip];
  readonly beatFx: BeatFxRouter;
  readonly hp: HeadphoneOutput;
  readonly masterOut: GainNode;
  readonly fftAnalyser: AnalyserNode;
  private readonly assign: Array<Record<XfAssign, GainNode>>;
  private readonly xfA: GainNode;
  private readonly xfB: GainNode;
  private readonly masterLevel: GainNode;
  private readonly masterCue: GainNode;
  private readonly toMain: GainNode;
  private readonly splitToMain: GainNode;
  private readonly analysers: [AnalyserNode, AnalyserNode];
  private readonly lowAnalyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;
  private readonly lowBuf: Float32Array<ArrayBuffer>;
  private readonly nodes: AudioNode[] = [];
  private deviceActive = false;
  private hpMode: HeadphoneMode = 'STEREO';

  constructor(private readonly ctx: BaseAudioContext) {
    const g = (gain = 1) => {
      const n = new GainNode(ctx, { gain });
      this.nodes.push(n);
      return n;
    };
    this.channels = [new ChannelStrip(ctx), new ChannelStrip(ctx)];
    this.beatFx = new BeatFxRouter(ctx);
    this.hp = new HeadphoneOutput(ctx);
    const thru = g();
    this.xfA = g();
    this.xfB = g();
    const sum = g();
    this.beatFx.points.XF_A.out.connect(this.xfA).connect(sum);
    this.beatFx.points.XF_B.out.connect(this.xfB).connect(sum);
    thru.connect(sum);
    this.assign = ([0, 1] as const).map((i) => {
      const a = { A: g(0), THRU: g(1), B: g(0) };
      const point = this.beatFx.points[i === 0 ? '1' : '2'];
      this.channels[i].output.connect(point.in);
      point.out.connect(a.A).connect(this.beatFx.points.XF_A.in);
      point.out.connect(a.B).connect(this.beatFx.points.XF_B.in);
      point.out.connect(a.THRU).connect(thru);
      this.channels[i].cueTap.connect(this.hp.cueIn);
      return a;
    });
    sum.connect(this.beatFx.points.MASTER.in);
    this.masterLevel = g(levelGain(0.84));
    const limiter = new DynamicsCompressorNode(ctx, LIMITER_OPTIONS);
    const clip = new WaveShaperNode(ctx, { curve: softClipCurve(), oversample: '2x' });
    this.masterOut = g();
    this.beatFx.points.MASTER.out.connect(this.masterLevel).connect(limiter).connect(clip).connect(this.masterOut);
    this.nodes.push(limiter, clip);

    this.masterOut.connect(this.hp.masterIn);
    this.masterCue = g(0);
    this.masterOut.connect(this.masterCue).connect(this.hp.cueIn);

    this.toMain = g(1);
    this.splitToMain = g(0);
    this.masterOut.connect(this.toMain).connect(ctx.destination);
    this.hp.splitOut.connect(this.splitToMain).connect(ctx.destination);

    const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.analysers = [new AnalyserNode(ctx, { fftSize: 1024 }), new AnalyserNode(ctx, { fftSize: 1024 })];
    this.masterOut.connect(splitter);
    splitter.connect(this.analysers[0], 0);
    splitter.connect(this.analysers[1], 1);
    const low = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150 });
    this.lowAnalyser = new AnalyserNode(ctx, { fftSize: 2048 });
    this.masterOut.connect(low).connect(this.lowAnalyser);
    this.fftAnalyser = new AnalyserNode(ctx, { fftSize: 256, smoothingTimeConstant: 0.6 });
    this.masterOut.connect(this.fftAnalyser);
    this.nodes.push(splitter, low, ...this.analysers, this.lowAnalyser, this.fftAnalyser);
    this.buf = new Float32Array(1024);
    this.lowBuf = new Float32Array(2048);
  }

  input(deck: DeckId): AudioNode {
    return this.channels[deck].input;
  }

  setXfAssign(ch: DeckId, a: XfAssign): void {
    for (const k of ['A', 'THRU', 'B'] as const) smooth(this.assign[ch]![k].gain, k === a ? 1 : 0, this.ctx, 0.005);
  }

  setCrossfader(pos: number, curve: CurveKind): void {
    const [a, b] = crossfaderGains(pos, curve);
    smooth(this.xfA.gain, a, this.ctx, 0.004);
    smooth(this.xfB.gain, b, this.ctx, 0.004);
  }

  setMasterLevel(knob: number): void {
    smooth(this.masterLevel.gain, levelGain(knob), this.ctx);
  }

  setMasterCue(on: boolean): void {
    smooth(this.masterCue.gain, on ? 1 : 0, this.ctx, 0.005);
  }

  setBeatFxChannel(ch: FxChannel): void {
    this.beatFx.select(ch);
  }

  setHeadphones(cueMix: number, level: number, mode: HeadphoneMode): void {
    this.hpMode = mode;
    this.hp.setMix(cueMix, level, mode);
    this.applyRouting();
  }

  async setHeadphoneDevice(sinkId: string | null): Promise<boolean> {
    const ok = await this.hp.setDevice(sinkId);
    this.deviceActive = this.hp.deviceActive;
    this.applyRouting();
    return ok;
  }

  private applyRouting(): void {
    const r = headphoneRouting(this.hpMode, this.deviceActive);
    smooth(this.toMain.gain, r.main === 'master' ? 1 : 0, this.ctx, 0.005);
    smooth(this.splitToMain.gain, r.main === 'split' ? 1 : 0, this.ctx, 0.005);
  }

  /** Reads meters into `out` (allocation-free). Call once per animation frame. */
  readLevels(out: MixerLevels): void {
    for (const i of [0, 1] as const) {
      this.channels[i].meter.getFloatTimeDomainData(this.buf);
      out.ch[i] = peakOf(this.buf);
    }
    this.analysers[0].getFloatTimeDomainData(this.buf);
    out.master[0] = peakOf(this.buf);
    this.analysers[1].getFloatTimeDomainData(this.buf);
    out.master[1] = peakOf(this.buf);
    this.lowAnalyser.getFloatTimeDomainData(this.lowBuf);
    out.lowRms = rmsOf(this.lowBuf);
  }

  dispose(): void {
    for (const c of this.channels) c.dispose();
    this.beatFx.dispose();
    this.hp.dispose();
    for (const n of this.nodes) n.disconnect();
  }
}
