import type { BeatFxType, FxChannel } from '../../constants';
import { PROCESSORS, type BeatFxMessage, type ClockPortMessage } from '../worklets/messages';

/** Runs `fn` after `ms` (setTimeout by default; an OfflineAudioContext passes a suspend()-based one). */
export type Scheduler = (ms: number, fn: () => void) => void;

/** in → bypass → out, and in → send → [FX] → ret → out while the FX is wired to this point. */
export interface InsertPoint {
  in: GainNode;
  bypass: GainNode;
  send: GainNode;
  ret: GainNode;
  out: GainNode;
}

/** Bypass/return crossfade time constant (s). */
const FADE_TC = 0.004;
/** Send fade-in time constant (s) and the lead it gets before the return opens. */
const SEND_TC = 0.001;
const SEND_LEAD_SEC = 0.01;
/** Time for a faded-out point to settle (≈ 7.5 time constants) before the FX is rewired. */
const SETTLE_MS = 30;

/**
 * The Beat FX unit can be inserted at CH1, CH2 (post fader), XF-A, XF-B (crossfader
 * buses) or MASTER. The single FX worklet is wired to exactly ONE point at any instant,
 * so the graph never contains a cycle (e.g. CH1 → Σ → MASTER → FX → CH1).
 *
 * Moving the insert: the old point crossfades return → bypass (bypass + return stay
 * complementary, so the level is constant; the FX output already contains the dry signal),
 * then the FX is unwired from it and wired to the new point with send/return at 0, the
 * send opens, and the new point crossfades bypass → return.
 */
export class BeatFxRouter {
  readonly node: AudioWorkletNode;
  readonly points: Record<FxChannel, InsertPoint>;
  /** The point the worklet is wired to. */
  private attached: FxChannel = 'MASTER';
  /** The point the user selected (differs from `attached` while a move is in progress). */
  private target: FxChannel = 'MASTER';
  private pending = false;
  private disposed = false;
  /** Context time of the latest fade-out of the attached point (the move waits SETTLE_MS after it). */
  private fadeOutAt = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly after: Scheduler = (ms, fn) => void setTimeout(fn, ms),
  ) {
    this.node = new AudioWorkletNode(ctx, PROCESSORS.beatFx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const make = (active: boolean): InsertPoint => {
      const on = active ? 1 : 0;
      const p = {
        in: new GainNode(ctx),
        bypass: new GainNode(ctx, { gain: 1 - on }),
        send: new GainNode(ctx, { gain: on }),
        ret: new GainNode(ctx, { gain: on }),
        out: new GainNode(ctx),
      };
      p.in.connect(p.bypass).connect(p.out);
      p.in.connect(p.send);
      p.ret.connect(p.out);
      return p;
    };
    this.points = { '1': make(false), '2': make(false), XF_A: make(false), XF_B: make(false), MASTER: make(true) };
    this.wire(this.attached);
  }

  private wire(ch: FxChannel): void {
    const p = this.points[ch];
    p.send.connect(this.node);
    this.node.connect(p.ret);
  }

  private unwire(ch: FxChannel): void {
    const p = this.points[ch];
    try {
      p.send.disconnect(this.node);
      this.node.disconnect(p.ret);
    } catch {
      // already disconnected
    }
  }

  private fade(param: AudioParam, value: number, at: number, tc: number): void {
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(value, at, tc);
  }

  /** Return → 0 while bypass → 1 (complementary: constant level). The send stays open. */
  private fadeOut(ch: FxChannel): void {
    const p = this.points[ch];
    const t = this.ctx.currentTime;
    this.fadeOutAt = t;
    this.fade(p.ret.gain, 0, t, FADE_TC);
    this.fade(p.bypass.gain, 1, t, FADE_TC);
  }

  /** Opens the send, then crossfades bypass → return once the FX input is fed. */
  private fadeIn(ch: FxChannel): void {
    const p = this.points[ch];
    const t = this.ctx.currentTime;
    this.fade(p.send.gain, 1, t, SEND_TC);
    const lead = p.send.gain.value > 0.99 ? 0 : SEND_LEAD_SEC;
    this.fade(p.ret.gain, 1, t + lead, FADE_TC);
    this.fade(p.bypass.gain, 0, t + lead, FADE_TC);
  }

  select(ch: FxChannel): void {
    if (this.disposed || ch === this.target) return;
    this.target = ch;
    if (ch === this.attached) {
      // Re-selected before the move completed: fade straight back in.
      this.fadeIn(ch);
      return;
    }
    this.fadeOut(this.attached);
    if (this.pending) return; // the scheduled move picks up the latest target
    this.pending = true;
    this.after(SETTLE_MS, () => this.completeMove());
  }

  private completeMove(): void {
    this.pending = false;
    if (this.disposed || this.target === this.attached) return;
    // A back-and-forth reselect may have faded the attached point out again after this timer was
    // armed: wait until that fade has settled too, or unwiring would cut its still-audible return.
    const waitMs = SETTLE_MS - (this.ctx.currentTime - this.fadeOutAt) * 1000;
    if (waitMs > 1e-6) {
      this.pending = true;
      this.after(waitMs, () => this.completeMove());
      return;
    }
    const old = this.points[this.attached];
    this.unwire(this.attached);
    old.send.gain.cancelScheduledValues(this.ctx.currentTime);
    old.send.gain.setValueAtTime(0, this.ctx.currentTime);
    this.attached = this.target;
    const p = this.points[this.attached];
    p.send.gain.cancelScheduledValues(this.ctx.currentTime);
    p.send.gain.setValueAtTime(0, this.ctx.currentTime);
    p.ret.gain.cancelScheduledValues(this.ctx.currentTime);
    p.ret.gain.setValueAtTime(0, this.ctx.currentTime);
    this.wire(this.attached);
    this.fadeIn(this.attached);
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
    this.disposed = true;
    this.node.port.close();
    this.node.disconnect();
    for (const p of Object.values(this.points)) {
      p.in.disconnect();
      p.bypass.disconnect();
      p.send.disconnect();
      p.ret.disconnect();
      p.out.disconnect();
    }
  }
}
