import { BEAT_FX_DIVISIONS, type BeatFxType } from '../../constants';
import { Biquad } from '../dsp/biquad';
import { BeatClock } from './BeatClock';

/** 16 beats at 60 BPM is exactly 16 s; the extra 0.5 s keeps that (and ROLL's seam margin) in range. */
const MAX_SEC = 16.5;
const FADE_EPS = 0.005;
/** Feedback soft clip: identity up to the knee, then a tanh shoulder that saturates at 1. */
const FB_KNEE = 0.8;
const TWO_PI = Math.PI * 2;
const COMB_TUNING = [1116, 1188, 1277, 1356];
const ALLPASS_TUNING = [556, 441];
const STEREO_SPREAD = 23;

function softClip(x: number): number {
  const a = x < 0 ? -x : x;
  if (a <= FB_KNEE) return x;
  const y = FB_KNEE + (1 - FB_KNEE) * Math.tanh((a - FB_KNEE) / (1 - FB_KNEE));
  return x < 0 ? -y : y;
}

/** Delay time in seconds for a beat division at a BPM (quantized to the beat grid). */
export function beatFxDelaySec(bpm: number, divisionBeats: number): number {
  return (divisionBeats * 60) / bpm;
}

class Comb {
  private idx = 0;
  private store = 0;
  constructor(private readonly buf: Float32Array) {}
  process(x: number, feedback: number, damp: number): number {
    const y = this.buf[this.idx]!;
    this.store = y * (1 - damp) + this.store * damp;
    this.buf[this.idx] = x + this.store * feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return y;
  }
  clear(): void {
    this.buf.fill(0);
    this.store = 0;
  }
}

class Allpass {
  private idx = 0;
  constructor(private readonly buf: Float32Array) {}
  process(x: number): number {
    const b = this.buf[this.idx]!;
    const y = -x + b;
    this.buf[this.idx] = x + b * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return y;
  }
  clear(): void {
    this.buf.fill(0);
  }
}

/**
 * All 14 Beat FX in one allocation-free processor, locked to the master beat clock.
 * Time-based effects use exact beat multiples; ROLL/SLIP ROLL/HELIX/VINYL BRAKE read
 * from an always-recording capture ring so they can start on the previous grid point.
 * Echo-type effects (DELAY, ECHO, PING PONG, SPIRAL, REVERB) keep their tails after OFF.
 */
export class BeatFxCore {
  type: BeatFxType = 'DELAY';
  divisionBeats = 1;
  depth = 0.5;
  on = false;
  readonly clock: BeatClock;

  private readonly max: number;
  private readonly dL: Float32Array;
  private readonly dR: Float32Array;
  private dW = 0;
  private readonly cL: Float32Array;
  private readonly cR: Float32Array;
  private cW = 0;

  /** Frames written into dL/dR since the last effect switch; taps older than this read as silence (a logical clear). */
  private dFill = 0;
  private pendingType: BeatFxType | null = null;
  /** Multiplies the whole wet contribution (tails included); ramps to 0 around an effect switch. */
  private swGain = 1;
  private readonly swAlpha: number;
  private touched = false;
  private onGain = 0;
  private readonly onAlpha: number;
  private spiralT = 0;
  private readonly spiralAlpha: number;
  private transGain = 1;
  /** One-pole smoothed depth / reverb room so knob moves and division changes don't zipper. */
  private depthS = -1;
  private roomS = -1;
  private readonly paramAlpha: number;
  private readonly transAlpha: number;

  private readonly combs: Comb[];
  private readonly combsL: Comb[];
  private readonly combsR: Comb[];
  private readonly allpasses: Allpass[];
  private readonly apL: Allpass[];
  private readonly apR: Allpass[];

  private readonly lpL = new Biquad();
  private readonly lpR = new Biquad();
  private readonly phL = new Float64Array(4);
  private readonly phR = new Float64Array(4);
  private phFbL = 0;
  private phFbR = 0;

  private pitchPhase = 0;

  private wasOn = false;
  private lastDivision = 1;
  private rollAnchor = 0;
  private rollLen = 1;
  private rollPos = 0;
  private brakePos = 0;
  private brakeElapsed = 0;
  private helixPos = 0;
  // ROLL / SLIP ROLL / HELIX loop from a private copy of their slice in dL/dR (stored index = rollPre + k, the
  // rollPre frames before the anchor sit in front for the seam cross-fade), so the 16 s capture ring can't overwrite it.
  private rollPre = 0;
  private rollXf = 0;
  private sliceFilled = 0;
  private sliceEnd = 0;
  private readonly xfFrames: number;
  private readonly rollCap: number;
  // click removal for roll re-anchors
  private declickArm = false;
  private declickL = 0;
  private declickR = 0;
  private declickF = 0;
  private readonly declickStep: number;
  private lastL = 0;
  private lastR = 0;

  constructor(readonly sampleRate: number) {
    this.clock = new BeatClock(sampleRate);
    this.max = Math.ceil(MAX_SEC * sampleRate);
    this.dL = new Float32Array(this.max);
    this.dR = new Float32Array(this.max);
    this.cL = new Float32Array(this.max);
    this.cR = new Float32Array(this.max);
    const k = sampleRate / 44100;
    this.combsL = COMB_TUNING.map((t) => new Comb(new Float32Array(Math.round(t * k))));
    this.combsR = COMB_TUNING.map((t) => new Comb(new Float32Array(Math.round((t + STEREO_SPREAD) * k))));
    this.apL = ALLPASS_TUNING.map((t) => new Allpass(new Float32Array(Math.round(t * k))));
    this.apR = ALLPASS_TUNING.map((t) => new Allpass(new Float32Array(Math.round((t + STEREO_SPREAD) * k))));
    this.combs = this.combsL.concat(this.combsR);
    this.allpasses = this.apL.concat(this.apR);
    this.xfFrames = Math.ceil(0.003 * sampleRate);
    this.rollCap = this.max - this.xfFrames - 8;
    this.declickStep = 1 / this.xfFrames;
    this.swAlpha = 1 - Math.exp(-1 / (0.003 * sampleRate));
    this.paramAlpha = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.onAlpha = 1 - Math.exp(-1 / (0.005 * sampleRate));
    this.spiralAlpha = 1 - Math.exp(-1 / (0.25 * sampleRate));
    this.transAlpha = 1 - Math.exp(-1 / (0.001 * sampleRate));
  }

  /**
   * Switches effect. Once audio has run, the switch is deferred until the wet output (tails included) has faded
   * out (applied in `process`), then it fades back in, so it never cuts in or out. Nothing large is cleared: the delay buffers are
   * logically emptied by resetting `dFill`.
   */
  setType(t: BeatFxType): void {
    if (t === this.type) {
      this.pendingType = null;
      return;
    }
    if (this.touched) this.pendingType = t;
    else this.applyType(t);
  }

  private applyType(t: BeatFxType): void {
    this.type = t;
    this.pendingType = null;
    this.touched = false;
    this.dFill = 0;
    for (let i = 0; i < this.combs.length; i++) this.combs[i]!.clear();
    for (let i = 0; i < this.allpasses.length; i++) this.allpasses[i]!.clear();
    this.phL.fill(0);
    this.phR.fill(0);
    this.phFbL = 0;
    this.phFbR = 0;
    this.transGain = 1;
    this.pitchPhase = 0;
    this.spiralT = 0; // re-snap to the current delay time instead of gliding from the old effect
    this.lpL.reset();
    this.lpR.reset();
    this.wasOn = false;
  }

  setDivision(beats: number): void {
    this.divisionBeats = beats;
  }

  private delayFrames(): number {
    return Math.min(this.max - 1, Math.max(1, Math.round(this.divisionBeats * this.clock.framesPerBeat)));
  }

  private readRing(buf: Float32Array, pos: number): number {
    const m = this.max;
    let p = pos % m;
    if (p < 0) p += m;
    const i = Math.floor(p);
    const f = p - i;
    const a = buf[i]!;
    const b = buf[i + 1 === m ? 0 : i + 1]!;
    return a + (b - a) * f;
  }

  /** Delay-line tap `dist` frames back; older than what was written since the last switch reads as silence. */
  private tap(buf: Float32Array, dist: number): number {
    return dist + 1 > this.dFill ? 0 : this.readRing(buf, this.dW - dist);
  }

  /** Copy capture-ring frames into the slice store up to stored index `target` (just in time, allocation-free). */
  private fillSlice(target: number): void {
    const lim = target < this.sliceEnd ? target : this.sliceEnd;
    const m = this.max;
    while (this.sliceFilled < lim) {
      let s = (this.rollAnchor - this.rollPre + this.sliceFilled) % m;
      if (s < 0) s += m;
      this.dL[this.sliceFilled] = this.cL[s]!;
      this.dR[this.sliceFilled] = this.cR[s]!;
      this.sliceFilled++;
    }
  }

  private beginSlice(anchor: number, len: number): void {
    this.rollLen = len;
    this.rollPre = Math.min(this.xfFrames, len >> 2);
    this.rollXf = this.rollPre;
    this.rollAnchor = anchor;
    this.sliceFilled = 0;
    this.sliceEnd = this.rollPre + len + 2;
  }

  /** Anchor a roll at the latest grid point (grid = min(division, 1 beat)) as seen at `frame`. */
  private anchorRoll(frame: number): void {
    const g = Math.min(this.divisionBeats, 1);
    const beat = this.clock.beatAt(frame);
    const offsetBeats = beat - Math.floor(beat / g + 1e-9) * g;
    const len = Math.min(this.rollCap, this.delayFrames());
    const offset = Math.max(0, Math.min(Math.round(offsetBeats * this.clock.framesPerBeat), len - 1));
    this.beginSlice(this.cW - offset, len);
    this.rollPos = offset;
    this.fillSlice(this.rollPre + offset); // the part of the slice already recorded (at most one beat)
  }

  /** ROLL division change: shorten the loop on the same anchor when enough is captured, else re-anchor. */
  private retimeRoll(frame: number, T: number): void {
    const newLen = Math.min(this.rollCap, T);
    if (newLen <= this.sliceFilled - this.rollPre - 1) {
      this.rollLen = newLen;
      this.rollXf = Math.min(this.rollPre, newLen >> 2);
      this.rollPos %= newLen;
    } else {
      this.anchorRoll(frame);
    }
    this.declickArm = true;
  }

  private sliceInterp(buf: Float32Array, pos: number): number {
    const i = Math.floor(pos);
    const f = pos - i;
    return buf[i]! + (buf[i + 1]! - buf[i]!) * f;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, frame: number): void {
    const m = this.max;
    const T = this.delayFrames();
    const depthTarget = this.depth;
    if (this.pendingType !== null && this.swGain < FADE_EPS) this.applyType(this.pendingType);
    this.touched = true;
    const swTarget = this.pendingType === null ? 1 : 0;
    const target = this.on && this.pendingType === null ? 1 : 0;

    // edge + division handling (block rate)
    const rising = this.on && !this.wasOn;
    if (rising) {
      if (this.type === 'ROLL' || this.type === 'SLIP_ROLL') this.anchorRoll(frame);
      if (this.type === 'VINYL_BRAKE') {
        this.brakePos = this.cW;
        this.brakeElapsed = 0;
      }
      if (this.type === 'HELIX') {
        const len = Math.min(this.rollCap, T);
        this.beginSlice(this.cW - len, len);
        this.helixPos = 0;
      }
    } else if (this.on && this.divisionBeats !== this.lastDivision) {
      if (this.type === 'SLIP_ROLL') {
        this.anchorRoll(frame);
        this.declickArm = true;
      } else if (this.type === 'ROLL') this.retimeRoll(frame, T);
    }
    this.wasOn = this.on;
    this.lastDivision = this.divisionBeats;
    if (this.spiralT === 0) this.spiralT = T;

    const divIdx = Math.max(0, BEAT_FX_DIVISIONS.indexOf(this.divisionBeats as (typeof BEAT_FX_DIVISIONS)[number]));
    const roomTarget = 0.7 + (0.28 * divIdx) / (BEAT_FX_DIVISIONS.length - 1);
    if (this.depthS < 0) {
      this.depthS = depthTarget;
      this.roomS = roomTarget;
    }

    for (let i = 0; i < n; i++) {
      const xL = inL[i]!;
      const xR = inR[i]!;
      this.onGain += (target - this.onGain) * this.onAlpha;
      this.swGain += (swTarget - this.swGain) * this.swAlpha;
      this.depthS += (depthTarget - this.depthS) * this.paramAlpha;
      this.roomS += (roomTarget - this.roomS) * this.paramAlpha;
      const depth = this.depthS;
      const room = this.roomS;
      const g = this.onGain;
      // always record the capture ring
      this.cL[this.cW] = xL;
      this.cR[this.cW] = xR;

      let yL = xL;
      let yR = xR;
      switch (this.type) {
        case 'DELAY': {
          const r = (this.dW - T + m) % m;
          const ok = T <= this.dFill;
          const dl = ok ? this.dL[r]! : 0;
          const dr = ok ? this.dR[r]! : 0;
          this.dL[this.dW] = xL * g;
          this.dR[this.dW] = xR * g;
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'ECHO': {
          const fb = 0.3 + 0.55 * depth;
          const r = (this.dW - T + m) % m;
          const ok = T <= this.dFill;
          const dl = ok ? this.dL[r]! : 0;
          const dr = ok ? this.dR[r]! : 0;
          this.dL[this.dW] = xL * g + softClip(dl * fb);
          this.dR[this.dW] = xR * g + softClip(dr * fb);
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'PING_PONG': {
          const fb = 0.3 + 0.55 * depth;
          const r = (this.dW - T + m) % m;
          const ok = T <= this.dFill;
          const dl = ok ? this.dL[r]! : 0;
          const dr = ok ? this.dR[r]! : 0;
          this.dL[this.dW] = (xL + xR) * 0.5 * g + softClip(dr * fb);
          this.dR[this.dW] = softClip(dl * fb);
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'SPIRAL': {
          this.spiralT += (T - this.spiralT) * this.spiralAlpha;
          const fb = 0.75 + 0.2 * depth;
          const dl = this.tap(this.dL, this.spiralT);
          const dr = this.tap(this.dR, this.spiralT);
          this.dL[this.dW] = xL * g + softClip(dl * fb);
          this.dR[this.dW] = xR * g + softClip(dr * fb);
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'REVERB': {
          const input = (xL + xR) * 0.015 * g;
          let wl = 0;
          let wr = 0;
          for (let c = 0; c < 4; c++) {
            wl += this.combsL[c]!.process(input, room, 0.3);
            wr += this.combsR[c]!.process(input, room, 0.3);
          }
          for (let a = 0; a < 2; a++) {
            wl = this.apL[a]!.process(wl);
            wr = this.apR[a]!.process(wr);
          }
          yL = xL + depth * wl * 3;
          yR = xR + depth * wr * 3;
          break;
        }
        case 'TRANS': {
          const beat = this.clock.beatAt(frame + i);
          const phase = beat / this.divisionBeats - Math.floor(beat / this.divisionBeats);
          const tg = phase < 0.5 ? 1 : 1 - depth;
          this.transGain += (tg - this.transGain) * this.transAlpha;
          const k = 1 + (this.transGain - 1) * g;
          yL = xL * k;
          yR = xR * k;
          break;
        }
        case 'FILTER': {
          if ((i & 31) === 0) {
            const beat = this.clock.beatAt(frame + i);
            const lfo = 0.5 - 0.5 * Math.cos(TWO_PI * (beat / this.divisionBeats));
            const f = 200 * 2 ** (6 * lfo);
            this.lpL.design('lowpass', f, this.sampleRate, 2);
            this.lpR.design('lowpass', f, this.sampleRate, 2);
          }
          const w = g * depth;
          yL = xL + (this.lpL.process(xL) - xL) * w;
          yR = xR + (this.lpR.process(xR) - xR) * w;
          break;
        }
        case 'FLANGER': {
          const lfo = 0.5 - 0.5 * Math.cos(TWO_PI * (this.clock.beatAt(frame + i) / this.divisionBeats));
          const d = (0.0005 + 0.0055 * lfo) * this.sampleRate;
          const dl = this.tap(this.dL, d);
          const dr = this.tap(this.dR, d);
          this.dL[this.dW] = xL + dl * 0.5;
          this.dR[this.dW] = xR + dr * 0.5;
          const w = g * depth;
          yL = xL + dl * 0.7 * w;
          yR = xR + dr * 0.7 * w;
          break;
        }
        case 'PHASER': {
          const lfo = 0.5 - 0.5 * Math.cos(TWO_PI * (this.clock.beatAt(frame + i) / this.divisionBeats));
          const f = 300 * 10 ** lfo;
          const t = Math.tan((Math.PI * f) / this.sampleRate);
          const a = (t - 1) / (t + 1);
          let vl = xL + this.phFbL * 0.5;
          let vr = xR + this.phFbR * 0.5;
          for (let s = 0; s < 4; s++) {
            const ol = a * vl + this.phL[s]!;
            this.phL[s] = vl - a * ol;
            vl = ol;
            const or = a * vr + this.phR[s]!;
            this.phR[s] = vr - a * or;
            vr = or;
          }
          this.phFbL = vl;
          this.phFbR = vr;
          const w = g * depth;
          yL = xL * (1 - 0.5 * w) + vl * 0.5 * w;
          yR = xR * (1 - 0.5 * w) + vr * 0.5 * w;
          break;
        }
        case 'PITCH': {
          // two-tap granular shifter over a 60 ms window
          const win = 0.06 * this.sampleRate;
          const ratio = 2 ** (((depth - 0.5) * 24) / 12);
          this.dL[this.dW] = xL;
          this.dR[this.dW] = xR;
          if (Math.abs(ratio - 1) < 0.002) {
            // no shift: settle onto the nearest single-tap phase (0, 0.5 or 1) instead of leaving two taps combing
            const d = Math.round(this.pitchPhase * 2) / 2 - this.pitchPhase;
            const step = 0.5 / win;
            this.pitchPhase += d > step ? step : d < -step ? -step : d;
          } else {
            this.pitchPhase += (1 - ratio) / win;
          }
          this.pitchPhase -= Math.floor(this.pitchPhase);
          const p1 = this.pitchPhase;
          const p2 = (p1 + 0.5) % 1;
          const w1 = 1 - Math.abs(2 * p1 - 1);
          const w2 = 1 - Math.abs(2 * p2 - 1);
          const sl = this.tap(this.dL, 1 + p1 * win) * w1 + this.tap(this.dL, 1 + p2 * win) * w2;
          const sr = this.tap(this.dR, 1 + p1 * win) * w1 + this.tap(this.dR, 1 + p2 * win) * w2;
          yL = xL + (sl - xL) * g;
          yR = xR + (sr - xR) * g;
          break;
        }
        case 'ROLL':
        case 'SLIP_ROLL': {
          if (this.on || g > 1e-4) {
            const len = this.rollLen;
            this.fillSlice(this.rollPre + this.rollPos + 1);
            const k = this.rollPos % len;
            const base = this.rollPre + k;
            let rl = this.dL[base]!;
            let rr = this.dR[base]!;
            const tail = len - this.rollXf;
            if (this.rollXf > 0 && k >= tail) {
              // seam: fade toward the audio just before the anchor, which is what follows the last frame when looping
              const a = (k - tail) / this.rollXf;
              rl = rl * (1 - a) + this.dL[base - len]! * a;
              rr = rr * (1 - a) + this.dR[base - len]! * a;
            }
            this.rollPos++;
            const w = g * (0.5 + 0.5 * depth);
            yL = xL + (rl - xL) * w;
            yR = xR + (rr - xR) * w;
          }
          break;
        }
        case 'VINYL_BRAKE': {
          if (this.on || g > 1e-4) {
            const len = Math.max(1, T);
            const rate = Math.max(0, 1 - this.brakeElapsed / len);
            this.brakeElapsed++;
            const bl = rate > 0 ? this.readRing(this.cL, this.brakePos) : 0;
            const br = rate > 0 ? this.readRing(this.cR, this.brakePos) : 0;
            this.brakePos += rate;
            const w = g * (0.5 + 0.5 * depth);
            yL = xL + (bl - xL) * w;
            yR = xR + (br - xR) * w;
          }
          break;
        }
        case 'HELIX': {
          if (this.on || g > 1e-4) {
            const len = this.rollLen;
            const r = 2 ** ((depth - 0.5) * 2);
            let p = this.helixPos + r;
            if (p >= len) p -= len;
            this.helixPos = p;
            // copy at least a frame per output frame so the copy outpaces the ring writer even at ratio < 1
            this.fillSlice(Math.max(this.rollPre + Math.ceil(p) + 3, this.sliceFilled + 1));
            let hl = this.sliceInterp(this.dL, this.rollPre + p);
            let hr = this.sliceInterp(this.dR, this.rollPre + p);
            const tail = len - this.rollXf;
            if (this.rollXf > 0 && p >= tail) {
              const a = (p - tail) / this.rollXf;
              hl = hl * (1 - a) + this.sliceInterp(this.dL, this.rollPre + p - len) * a;
              hr = hr * (1 - a) + this.sliceInterp(this.dR, this.rollPre + p - len) * a;
            }
            yL = xL + (hl - xL) * 0.7 * g;
            yR = xR + (hr - xR) * 0.7 * g;
          }
          break;
        }
      }
      yL = xL + (yL - xL) * this.swGain;
      yR = xR + (yR - xR) * this.swGain;
      if (this.declickArm) {
        this.declickL = this.lastL - yL;
        this.declickR = this.lastR - yR;
        this.declickF = 1;
        this.declickArm = false;
      }
      if (this.declickF > 0) {
        yL += this.declickL * this.declickF;
        yR += this.declickR * this.declickF;
        this.declickF = Math.max(0, this.declickF - this.declickStep);
      }
      this.lastL = yL;
      this.lastR = yR;
      outL[i] = yL;
      outR[i] = yR;
      if (this.dFill < m) this.dFill++;
      if (++this.dW >= m) this.dW = 0;
      if (++this.cW >= m) this.cW = 0;
    }
  }
}
