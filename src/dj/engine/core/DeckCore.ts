import { DEFAULT_BEAT_JUMP, DEFAULT_MOTOR_SEC, HOT_CUE_COUNT } from '../../constants';
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

/** Transport states of the CUE/PLAY state machine (see the table in the plan / DeckCore.cue.test.ts). */
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

/**
 * One CDJ deck — transport layer: variable-speed playhead with Hermite
 * interpolation, motor ramps, tempo, reverse, needle search, end-of-track,
 * the CUE state machine, hot cues and memory cues. Pure TypeScript: no Web
 * Audio types, no allocation in render(). (Loops, slip and jog: Task 4.)
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
  ended = false;

  /** Output declick gain: instant on when the platter moves, 5 ms release when it stops (no DC hold). */
  private outGain = 0;
  private readonly declickAlpha: number;
  private events: DeckEvent[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.grid = new FrameGrid({ bpm: 120, firstBeatSec: 0 }, sampleRate);
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
  /** True when the deck plays forward at its motor speed (used by sync and Master Tempo). */
  get runningNormally(): boolean {
    return this.state !== 'PAUSED' && this.motor >= 1 && !this.settings.reverse;
  }

  drainEvents(): readonly DeckEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const e = this.events;
    this.events = [];
    return e;
  }

  // ───────────────────────── settings ─────────────────────────

  set(patch: Partial<DeckSettings>): void {
    this.settings = { ...this.settings, ...patch };
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

  // ───────────────────────── transport ─────────────────────────

  play(): void {
    if (!this.loaded) return;
    switch (this.state) {
      case 'PAUSED':
        if (this.ended) return;
        this.state = 'PLAYING';
        break;
      case 'PLAYING':
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
          this.stopAt(this.cueFrame);
          break;
        case 'PAUSED':
          if (this.ended) {
            this.stopAt(this.cueFrame);
          } else if (this.atCue) {
            this.state = 'CUE_HOLD'; // cue preview
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
    this.pos = frame;
    this.state = 'PAUSED';
    this.motor = 0;
    this.rate = 0;
    this.ended = false;
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
      this.pos = stored;
      this.ended = false;
      this.state = 'HOTCUE_HOLD';
      this.motor = 1;
      this.heldHotCue = index;
    } else {
      this.heldHotCue = index;
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
      this.pos = target;
      this.ended = false;
    }
  }

  /** Needle search / seek to seconds. */
  seek(sec: number): void {
    if (!this.loaded) return;
    this.pos = this.clampPos(sec * this.sampleRate);
    this.ended = this.pos >= this.lengthFrames;
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
    const base = this.baseRate;
    const dir = s.reverse ? -1 : 1;

    for (let k = offset; k < end; k++) {
      // motor
      const motorTarget = this.state === 'PAUSED' ? 0 : 1;
      if (this.motor < motorTarget) this.motor = Math.min(1, this.motor + startStep);
      else if (this.motor > motorTarget) this.motor = Math.max(0, this.motor - stopStep);
      this.rate = dir * base * this.motor;
      if (this.rate < 0 && this.pos <= 0) this.rate = 0; // reverse at frame 0: silence, not held DC

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
      if (next >= n) {
        next = n;
        if (this.state === 'PLAYING') {
          this.state = 'PAUSED';
          this.motor = 0;
          this.rate = 0;
        }
        // CUE_HOLD / HOTCUE_HOLD stay parked at the end so the release returns to the cue / pad.
        if (!this.ended) {
          this.ended = true;
          this.events.push({ kind: 'ended' });
        }
      } else if (next < 0) {
        next = 0;
      }
      this.pos = next;
    }
  }
}
