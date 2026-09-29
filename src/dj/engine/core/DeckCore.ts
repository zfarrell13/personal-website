import {
  BEND_MAX,
  BEND_PER_REV,
  DEFAULT_BEAT_JUMP,
  DEFAULT_MOTOR_SEC,
  HOT_CUE_COUNT,
  LOOP_MAX_BEATS,
  LOOP_MIN_BEATS,
  SCRATCH_SEC_PER_REV,
} from '../../constants';
import { hermite4 } from '../dsp/hermite';
import { FrameGrid } from './grid';

export interface DeckTrackData {
  left: Float32Array;
  right: Float32Array;
  bpm: number;
  firstBeatSec: number;
  /** Memory cue positions in seconds, ascending. */
  memoryCuesSec: number[];
  /** Stored hot cues in seconds (null = empty), length HOT_CUE_COUNT. */
  hotCuesSec: (number | null)[];
}

/** Transport states of the CUE/PLAY state machine (see the table in the plan / DeckCore.test.ts). */
export type TransportState = 'PAUSED' | 'PLAYING' | 'CUE_HOLD' | 'HOTCUE_HOLD';

export type DeckEvent =
  | { kind: 'hotcue'; index: number; sec: number | null }
  | { kind: 'cue'; sec: number }
  | { kind: 'ended' };

export interface DeckSettings {
  tempoPct: number;
  reverse: boolean;
  slip: boolean;
  quantize: boolean;
  quantizeBeats: number;
  beatJumpBeats: number;
  vinylMode: boolean;
  /** JOG ADJUST 0 (light) .. 1 (heavy): how slowly the platter hands back to the motor after a scratch. */
  jogWeight: number;
  /** VINYL SPEED ADJ: motor start (release) and stop (touch) times in seconds. */
  motorStartSec: number;
  motorStopSec: number;
}

const NO_EVENTS: readonly DeckEvent[] = Object.freeze([]);

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  tempoPct: 0,
  reverse: false,
  slip: false,
  quantize: true,
  quantizeBeats: 1,
  beatJumpBeats: DEFAULT_BEAT_JUMP,
  vinylMode: true,
  jogWeight: 0.5,
  motorStartSec: DEFAULT_MOTOR_SEC,
  motorStopSec: DEFAULT_MOTOR_SEC,
};

export const SLIP_SCRATCH = 1;
export const SLIP_LOOP = 2;
export const SLIP_REVERSE = 4;
export const SLIP_HOTCUE = 8;
export const SLIP_PAUSE = 16;

const SCRATCH_SMOOTH_SEC = 0.008;
const BEND_SMOOTH_SEC = 0.03;

/**
 * One CDJ deck: variable-speed playhead with Hermite interpolation, motor,
 * jog (scratch / bend / search), CUE state machine, hot + memory cues, loops,
 * beat jump, reverse, slip and quantize. Pure TypeScript: no Web Audio types,
 * no allocation in render().
 */
export class DeckCore {
  readonly sampleRate: number;
  settings: DeckSettings = { ...DEFAULT_DECK_SETTINGS };

  private left: Float32Array = new Float32Array(0);
  private right: Float32Array = new Float32Array(0);
  private lengthFrames = 0;
  private grid: FrameGrid;
  loaded = false;

  /** Playhead in frames (fractional). */
  pos = 0;
  state: TransportState = 'PAUSED';
  /** Motor speed 0..1. */
  motor = 0;
  /** The rate actually applied to the playhead during the last sample (signed). */
  rate = 0;
  /** Sync override of the tempo rate (null = use tempoPct). Set by SyncCore. */
  externalRate: number | null = null;

  cueFrame = 0;
  readonly hotCues = new Float64Array(HOT_CUE_COUNT).fill(NaN);
  private memoryCues: number[] = [];
  private heldHotCue = -1;

  loopIn = NaN;
  loopOut = NaN;
  loopActive = false;

  slipFlags = 0;
  shadowPos = 0;

  scratching = false;
  /** True while the platter glides back to motor speed after a scratch (Master Tempo stays dry). */
  releasing = false;
  private jogVel = 0;
  private bend = 0;
  private bendTarget = 0;
  ended = false;

  /** Output declick gain: instant on when the platter moves, 5 ms release when it stops (no DC hold). */
  private outGain = 0;
  private readonly scratchAlpha: number;
  private readonly bendAlpha: number;
  private readonly declickAlpha: number;
  private events: DeckEvent[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.grid = new FrameGrid({ bpm: 120, firstBeatSec: 0 }, sampleRate);
    this.scratchAlpha = 1 - Math.exp(-1 / (SCRATCH_SMOOTH_SEC * sampleRate));
    this.bendAlpha = 1 - Math.exp(-1 / (BEND_SMOOTH_SEC * sampleRate));
    this.declickAlpha = 1 - Math.exp(-1 / (0.005 * sampleRate));
  }

  // ───────────────────────── loading ─────────────────────────

  load(t: DeckTrackData): void {
    this.left = t.left;
    this.right = t.right;
    this.lengthFrames = t.left.length;
    this.grid = new FrameGrid({ bpm: t.bpm, firstBeatSec: t.firstBeatSec }, this.sampleRate);
    this.memoryCues = t.memoryCuesSec.map((s) => s * this.sampleRate).sort((a, b) => a - b);
    this.hotCues.fill(NaN);
    t.hotCuesSec.forEach((s, i) => {
      if (s !== null && i < HOT_CUE_COUNT) this.hotCues[i] = s * this.sampleRate;
    });
    this.loaded = true;
    this.state = 'PAUSED';
    this.motor = 0;
    this.rate = 0;
    this.loopIn = this.loopOut = NaN;
    this.loopActive = false;
    this.slipFlags = 0;
    this.scratching = false;
    this.releasing = false;
    this.bend = this.bendTarget = 0;
    this.ended = false;
    this.heldHotCue = -1;
    this.events = [];
    // Auto cue: first downbeat.
    this.cueFrame = Math.max(0, this.grid.frameAt(0));
    this.pos = this.cueFrame;
  }

  unload(): void {
    this.left = new Float32Array(0);
    this.right = new Float32Array(0);
    this.lengthFrames = 0;
    this.loaded = false;
    this.state = 'PAUSED';
    this.motor = 0;
    this.rate = 0;
    this.pos = 0;
  }

  get length(): number {
    return this.lengthFrames;
  }
  get frameGrid(): FrameGrid {
    return this.grid;
  }
  get bpm(): number {
    return this.grid.grid.bpm;
  }
  get playing(): boolean {
    return this.state !== 'PAUSED';
  }
  /** Tempo multiplier before bend/motor/direction (sync override included). */
  get baseRate(): number {
    return this.externalRate ?? 1 + this.settings.tempoPct / 100;
  }
  /** Own tempo multiplier, ignoring sync. */
  get tempoRate(): number {
    return 1 + this.settings.tempoPct / 100;
  }
  get beat(): number {
    return this.grid.beatAt(this.pos);
  }
  get atCue(): boolean {
    return this.state === 'PAUSED' && Math.abs(this.pos - this.cueFrame) < 1;
  }
  /** True while the outer ring is pitch-bending (or the bend has not yet settled). */
  get bending(): boolean {
    return this.bendTarget !== 0 || Math.abs(this.bend) > 1e-5;
  }
  /** True while the platter follows the hand (scratch or paused search). */
  get handControl(): boolean {
    return this.scratching || (this.state === 'PAUSED' && this.motor === 0);
  }
  /** True when the deck plays forward at its motor speed (used by sync and Master Tempo). */
  get runningNormally(): boolean {
    return this.state !== 'PAUSED' && this.motor >= 1 && !this.scratching && !this.releasing && !this.settings.reverse;
  }

  drainEvents(): readonly DeckEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const e = this.events;
    this.events = [];
    return e;
  }

  // ───────────────────────── settings ─────────────────────────

  set(patch: Partial<DeckSettings>): void {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    if (patch.reverse !== undefined && patch.reverse !== before.reverse) {
      if (patch.reverse) this.startSlip(SLIP_REVERSE);
      else this.endSlip(SLIP_REVERSE);
    }
    if (patch.slip === false && before.slip) this.slipFlags = 0;
  }

  // ───────────────────────── quantize helpers ─────────────────────────

  private q(frame: number): number {
    return this.settings.quantize ? this.grid.snap(frame, this.settings.quantizeBeats) : frame;
  }

  /** Jump that keeps the beat phase when quantize is on and the deck is playing. */
  private jumpTo(target: number): void {
    if (this.settings.quantize && this.state !== 'PAUSED') {
      target += this.grid.phaseOffset(this.pos, this.settings.quantizeBeats);
    }
    this.pos = this.clampPos(target);
    this.ended = false;
  }

  private clampPos(p: number): number {
    return Math.min(Math.max(0, p), this.lengthFrames);
  }

  // ───────────────────────── slip ─────────────────────────

  private startSlip(flag: number): void {
    if (!this.settings.slip || this.state === 'PAUSED') return;
    if (this.slipFlags === 0) this.shadowPos = this.pos;
    this.slipFlags |= flag;
  }

  private endSlip(flag: number): void {
    if ((this.slipFlags & flag) === 0) return;
    this.slipFlags &= ~flag;
    if (this.slipFlags === 0) this.pos = this.clampPos(this.shadowPos);
  }

  // ───────────────────────── transport ─────────────────────────

  play(): void {
    if (!this.loaded) return;
    switch (this.state) {
      case 'PAUSED':
        if (this.ended) return;
        this.state = 'PLAYING';
        this.endSlip(SLIP_PAUSE);
        break;
      case 'PLAYING':
        this.startSlip(SLIP_PAUSE);
        this.state = 'PAUSED';
        break;
      case 'CUE_HOLD':
      case 'HOTCUE_HOLD':
        this.state = 'PLAYING'; // CUE + PLAY / hot cue + PLAY: keep playing after release
        this.heldHotCue = -1;
        break;
    }
  }

  cue(down: boolean): void {
    if (!this.loaded) return;
    if (down) {
      switch (this.state) {
        case 'PLAYING': // back cue
          this.slipFlags = 0;
          this.stopAt(this.cueFrame);
          break;
        case 'PAUSED':
          if (this.ended) {
            this.stopAt(this.cueFrame);
          } else if (this.atCue) {
            this.state = 'CUE_HOLD'; // cue preview
            this.slipFlags = 0;
            this.motor = 1;
          } else {
            this.cueFrame = this.clampPos(this.q(this.pos));
            this.stopAt(this.cueFrame); // also kills a motor that is still braking
            this.events.push({ kind: 'cue', sec: this.cueFrame / this.sampleRate });
          }
          break;
        default:
          break;
      }
    } else if (this.state === 'CUE_HOLD') {
      this.stopAt(this.cueFrame);
    }
  }

  /** Instant stop at a position (back cue, end of a cue/hot-cue preview). */
  private stopAt(frame: number): void {
    this.leaveLoopIfOutside(frame);
    this.pos = frame;
    this.state = 'PAUSED';
    this.motor = 0;
    this.rate = 0;
    this.ended = false;
    this.slipFlags = 0; // an explicit cue action ends any slip event (incl. slip pause)
  }

  hotCue(index: number, down: boolean, shift: boolean): void {
    if (!this.loaded || index < 0 || index >= HOT_CUE_COUNT) return;
    const stored = this.hotCues[index]!;
    if (!down) {
      if (this.state === 'HOTCUE_HOLD' && this.heldHotCue === index) {
        this.stopAt(stored);
        this.heldHotCue = -1;
      } else if (this.heldHotCue === index) {
        this.heldHotCue = -1;
        this.endSlip(SLIP_HOTCUE);
      }
      return;
    }
    if (shift) {
      if (!Number.isNaN(stored)) {
        this.hotCues[index] = NaN;
        this.events.push({ kind: 'hotcue', index, sec: null });
      }
      return;
    }
    if (Number.isNaN(stored)) {
      const at = this.clampPos(this.q(this.pos));
      this.hotCues[index] = at;
      this.events.push({ kind: 'hotcue', index, sec: at / this.sampleRate });
      return;
    }
    if (this.state === 'PAUSED') {
      this.leaveLoopIfOutside(stored);
      this.pos = stored;
      this.ended = false;
      this.state = 'HOTCUE_HOLD';
      this.slipFlags = 0;
      this.motor = 1;
      this.heldHotCue = index;
    } else {
      this.startSlip(SLIP_HOTCUE);
      this.heldHotCue = index;
      if (this.loopActive) this.exitLoopSilently();
      this.jumpTo(stored);
    }
  }

  /** CALL ◄ (-1) / ► (+1): moves the cue point to the previous/next memory cue; when paused, the playhead goes there too. */
  callMemoryCue(dir: -1 | 1): void {
    if (!this.loaded || this.memoryCues.length === 0) return;
    const ref = this.cueFrame;
    const target =
      dir > 0 ? this.memoryCues.find((c) => c > ref + 1) : [...this.memoryCues].reverse().find((c) => c < ref - 1);
    if (target === undefined) return;
    this.cueFrame = target;
    this.events.push({ kind: 'cue', sec: target / this.sampleRate });
    if (this.state === 'PAUSED') {
      this.leaveLoopIfOutside(target);
      this.pos = target;
      this.ended = false;
      this.slipFlags = 0;
    }
  }

  /** Needle search / seek to seconds. */
  seek(sec: number): void {
    if (!this.loaded) return;
    this.pos = this.clampPos(sec * this.sampleRate);
    this.leaveLoopIfOutside(this.pos);
    this.ended = this.pos >= this.lengthFrames;
    if (this.slipFlags) this.shadowPos = this.pos;
  }

  // ───────────────────────── loops ─────────────────────────

  loopInPress(): void {
    if (!this.loaded || this.loopActive) return;
    this.loopIn = this.clampPos(this.q(this.pos));
    this.loopOut = NaN;
  }

  loopOutPress(): void {
    if (!this.loaded || this.loopActive || Number.isNaN(this.loopIn)) return;
    const fpb = this.grid.framesPerBeat;
    let out = this.pos;
    if (this.settings.quantize) {
      const res = this.settings.quantizeBeats;
      const beats = Math.max(res, Math.round((this.pos - this.loopIn) / (fpb * res)) * res);
      out = this.loopIn + beats * fpb;
    }
    if (out <= this.loopIn + 1) return;
    this.loopOut = Math.min(out, this.lengthFrames);
    this.activateLoop();
  }

  reloopExit(): void {
    if (!this.loaded) return;
    if (this.loopActive) {
      this.loopActive = false;
      this.endSlip(SLIP_LOOP);
      return;
    }
    if (Number.isNaN(this.loopIn) || Number.isNaN(this.loopOut)) return;
    this.startSlip(SLIP_LOOP);
    this.loopActive = true;
    this.pos = this.loopIn;
    this.ended = false;
  }

  autoLoop(beats: number): void {
    if (!this.loaded) return;
    if (this.loopActive) this.exitLoopSilently();
    const start = this.settings.quantize ? this.grid.floor(this.pos, this.settings.quantizeBeats) : this.pos;
    this.loopIn = this.clampPos(start);
    this.loopOut = Math.min(this.loopIn + beats * this.grid.framesPerBeat, this.lengthFrames);
    this.activateLoop();
  }

  scaleLoop(factor: 0.5 | 2): void {
    if (!this.loaded) return;
    if (Number.isNaN(this.loopIn) || Number.isNaN(this.loopOut)) return;
    const fpb = this.grid.framesPerBeat;
    const beats = Math.min(LOOP_MAX_BEATS, Math.max(LOOP_MIN_BEATS, ((this.loopOut - this.loopIn) / fpb) * factor));
    const len = beats * fpb;
    this.loopOut = Math.min(this.loopIn + len, this.lengthFrames);
    if (this.loopActive && this.pos >= this.loopOut) {
      this.pos = this.loopIn + ((this.pos - this.loopIn) % (this.loopOut - this.loopIn));
    }
  }

  get loopBeats(): number {
    if (Number.isNaN(this.loopIn) || Number.isNaN(this.loopOut)) return 0;
    return (this.loopOut - this.loopIn) / this.grid.framesPerBeat;
  }

  private activateLoop(): void {
    this.startSlip(SLIP_LOOP);
    this.loopActive = true;
    const len = this.loopOut - this.loopIn;
    if (this.pos >= this.loopOut) this.pos = this.loopIn + ((this.pos - this.loopIn) % len);
  }

  private exitLoopSilently(): void {
    this.loopActive = false;
    this.slipFlags &= ~SLIP_LOOP;
  }

  /** A jump to a frame outside the active loop (seek, cue, hot cue, CALL) leaves the loop. */
  private leaveLoopIfOutside(frame: number): void {
    if (this.loopActive && (frame < this.loopIn || frame >= this.loopOut)) this.exitLoopSilently();
  }

  beatJump(dir: -1 | 1): void {
    if (!this.loaded) return;
    let delta = dir * this.settings.beatJumpBeats * this.grid.framesPerBeat;
    if (this.loopActive) {
      // keep the whole loop on the track
      delta = Math.min(Math.max(delta, -this.loopIn), this.lengthFrames - this.loopOut);
      this.loopIn += delta;
      this.loopOut += delta;
    }
    this.pos = this.clampPos(this.pos + delta);
    this.ended = this.pos >= this.lengthFrames;
  }

  // ───────────────────────── jog ─────────────────────────

  /**
   * Jog input, sent every UI frame while the jog is touched or moving.
   * @param touch  top plate is held
   * @param revPerSec  signed angular velocity in revolutions per second
   * @param ring  input comes from the outer ring (always pitch bend)
   */
  jog(touch: boolean, revPerSec: number, ring: boolean): void {
    if (!this.loaded) return;
    this.jogVel = revPerSec;
    const wantScratch = touch && !ring && this.settings.vinylMode;
    if (wantScratch && !this.scratching) {
      this.scratching = true;
      this.releasing = false;
      this.startSlip(SLIP_SCRATCH);
    } else if (!wantScratch && this.scratching) {
      this.scratching = false;
      this.releasing = this.state !== 'PAUSED';
      this.endSlip(SLIP_SCRATCH);
    }
    this.bendTarget = this.scratching ? 0 : Math.max(-BEND_MAX, Math.min(BEND_MAX, revPerSec * BEND_PER_REV));
  }

  // ───────────────────────── render ─────────────────────────

  /** Renders `count` frames into outL/outR starting at `offset`. Allocation-free. */
  render(outL: Float32Array, outR: Float32Array, offset: number, count: number): void {
    const end = offset + count;
    if (!this.loaded) {
      outL.fill(0, offset, end);
      outR.fill(0, offset, end);
      return;
    }
    const s = this.settings;
    const sr = this.sampleRate;
    const L = this.left;
    const R = this.right;
    const n = this.lengthFrames;
    const startStep = s.motorStartSec > 0 ? 1 / (s.motorStartSec * sr) : 1;
    const stopStep = s.motorStopSec > 0 ? 1 / (s.motorStopSec * sr) : 1;
    const releaseAlpha = 1 - Math.exp(-1 / ((0.02 + 0.3 * s.jogWeight) * sr));
    const base = this.baseRate;
    const dir = s.reverse ? -1 : 1;
    const shadowRate = base;
    const hasLoop = this.loopActive;
    const loopLen = this.loopOut - this.loopIn;

    for (let k = offset; k < end; k++) {
      // motor
      const motorTarget = this.state === 'PAUSED' ? 0 : 1;
      if (this.motor < motorTarget) this.motor = Math.min(1, this.motor + startStep);
      else if (this.motor > motorTarget) this.motor = Math.max(0, this.motor - stopStep);
      this.bend += (this.bendTarget - this.bend) * this.bendAlpha;

      // rate
      if (this.handControl) {
        const target = this.jogVel * SCRATCH_SEC_PER_REV;
        // A still, untouched platter is exactly still; a hand-held one eases (no zipper noise).
        this.rate = !this.scratching && target === 0 ? 0 : this.rate + (target - this.rate) * this.scratchAlpha;
        if (this.rate < 0 && this.pos <= 0) this.rate = 0; // backward at frame 0: silence, not held DC
      } else {
        const target = dir * base * (1 + this.bend) * this.motor;
        if (this.releasing) {
          this.rate += (target - this.rate) * releaseAlpha;
          if (Math.abs(target - this.rate) < 1e-4 * Math.max(1, Math.abs(target))) {
            this.rate = target;
            this.releasing = false;
          }
        } else {
          this.rate = target;
        }
        if (this.rate < 0 && this.pos <= 0) this.rate = 0; // reverse at frame 0: silence, not held DC
      }

      // read (Hermite), declicked
      if (this.rate !== 0) this.outGain = 1;
      else this.outGain -= this.outGain * this.declickAlpha;
      const g = this.outGain;
      const p = this.pos;
      const i = Math.floor(p);
      const t = p - i;
      if (g < 1e-4) {
        outL[k] = 0;
        outR[k] = 0;
      } else if (i >= 1 && i + 2 < n) {
        outL[k] = g * hermite4(L[i - 1]!, L[i]!, L[i + 1]!, L[i + 2]!, t);
        outR[k] = g * hermite4(R[i - 1]!, R[i]!, R[i + 1]!, R[i + 2]!, t);
      } else {
        outL[k] = i >= 0 && i < n ? g * L[i]! : 0;
        outR[k] = i >= 0 && i < n ? g * R[i]! : 0;
      }

      // advance
      let next = p + this.rate;
      // wrap only when crossing a loop boundary from inside the loop
      if (hasLoop && this.loopActive) {
        if (this.rate >= 0 && p < this.loopOut && next >= this.loopOut) next -= loopLen;
        else if (this.rate < 0 && p >= this.loopIn && next < this.loopIn) next += loopLen;
      }
      if (next >= n) {
        next = n;
        if (!this.handControl) {
          if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            this.motor = 0;
            this.rate = 0;
            this.slipFlags = 0;
          }
          // CUE_HOLD / HOTCUE_HOLD stay parked at the end so the release returns to the cue / pad.
          if (!this.ended) {
            this.ended = true;
            this.events.push({ kind: 'ended' });
          }
        }
      } else if (next < 0) {
        next = 0;
      }
      this.pos = next;
      if (this.slipFlags !== 0) this.shadowPos = Math.min(n, this.shadowPos + shadowRate);
    }
  }
}
