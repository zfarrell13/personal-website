import type { BeatFxType, FxChannel } from '../../constants';
import { PROCESSORS, type BeatFxMessage, type ClockPortMessage } from '../worklets/messages';

export interface InsertPoint {
  in: GainNode;
  bypass: GainNode;
  out: GainNode;
}

/**
 * The Beat FX unit can be inserted at CH1, CH2 (post fader), XF-A, XF-B (crossfader
 * buses) or MASTER. Every point is in → bypass → out; the selected point routes
 * in → FX → out instead (the FX output already contains the dry signal).
 */
export class BeatFxRouter {
  readonly node: AudioWorkletNode;
  readonly points: Record<FxChannel, InsertPoint>;
  private current: FxChannel = 'MASTER';
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly ctx: BaseAudioContext) {
    this.node = new AudioWorkletNode(ctx, PROCESSORS.beatFx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const make = (): InsertPoint => {
      const p = { in: new GainNode(ctx), bypass: new GainNode(ctx, { gain: 1 }), out: new GainNode(ctx) };
      p.in.connect(p.bypass).connect(p.out);
      return p;
    };
    this.points = { '1': make(), '2': make(), XF_A: make(), XF_B: make(), MASTER: make() };
    this.attach(this.current);
  }

  private attach(ch: FxChannel): void {
    const p = this.points[ch];
    p.in.connect(this.node);
    this.node.connect(p.out);
    p.bypass.gain.cancelScheduledValues(this.ctx.currentTime);
    p.bypass.gain.setTargetAtTime(0, this.ctx.currentTime, 0.004);
  }

  select(ch: FxChannel): void {
    if (ch === this.current) return;
    const old = this.current;
    this.current = ch;
    const op = this.points[old];
    op.bypass.gain.cancelScheduledValues(this.ctx.currentTime);
    op.bypass.gain.setTargetAtTime(1, this.ctx.currentTime, 0.004);
    this.attach(ch);
    // Detach the old point once its bypass has faded back in (unless re-selected meanwhile).
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.current === old) return;
      try {
        op.in.disconnect(this.node);
        this.node.disconnect(op.out);
      } catch {
        // already disconnected
      }
    }, 40);
    this.timers.add(timer);
  }

  set(type: BeatFxType, divisionBeats: number, depth: number, on: boolean): void {
    const msg: BeatFxMessage = { t: 'set', type, divisionBeats, depth, on };
    this.node.port.postMessage(msg);
  }

  /** Master Tempo latency in frames: the FX clock shifts beats back by this much. */
  setLatencyFrames(frames: number): void {
    const msg: BeatFxMessage = { t: 'latency', frames };
    this.node.port.postMessage(msg);
  }

  /** Hands the FX worklet its end of the beat-clock channel from the decks worklet. */
  connectClock(port: MessagePort): void {
    const msg: ClockPortMessage = { t: 'clockPort', port };
    this.node.port.postMessage(msg, [port]);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.node.port.close();
    this.node.disconnect();
    for (const p of Object.values(this.points)) {
      p.in.disconnect();
      p.bypass.disconnect();
      p.out.disconnect();
    }
  }
}
