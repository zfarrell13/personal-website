import { BEAT_FX_DIVISIONS, type BeatFxType } from '../../constants';
import { Biquad } from '../dsp/biquad';
import { BeatClock } from './BeatClock';

const MAX_SEC = 16;
const TWO_PI = Math.PI * 2;
const COMB_TUNING = [1116, 1188, 1277, 1356];
const ALLPASS_TUNING = [556, 441];
const STEREO_SPREAD = 23;

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
    this.paramAlpha = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.onAlpha = 1 - Math.exp(-1 / (0.005 * sampleRate));
    this.spiralAlpha = 1 - Math.exp(-1 / (0.25 * sampleRate));
    this.transAlpha = 1 - Math.exp(-1 / (0.001 * sampleRate));
  }

  setType(t: BeatFxType): void {
    if (t === this.type) return;
    this.type = t;
    this.dL.fill(0);
    this.dR.fill(0);
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

  /** Anchor a roll at the latest grid point (grid = min(division, 1 beat)) as seen at `frame`. */
  private anchorRoll(frame: number): void {
    const g = Math.min(this.divisionBeats, 1);
    const beat = this.clock.beatAt(frame);
    const offsetBeats = beat - Math.floor(beat / g + 1e-9) * g;
    const offsetFrames = Math.round(offsetBeats * this.clock.framesPerBeat);
    this.rollLen = this.delayFrames();
    this.rollAnchor = this.cW - offsetFrames;
    this.rollPos = offsetFrames % this.rollLen;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, frame: number): void {
    const m = this.max;
    const T = this.delayFrames();
    const depthTarget = this.depth;
    const target = this.on ? 1 : 0;

    // edge + division handling (block rate)
    const rising = this.on && !this.wasOn;
    if (rising) {
      if (this.type === 'ROLL' || this.type === 'SLIP_ROLL') this.anchorRoll(frame);
      if (this.type === 'VINYL_BRAKE') {
        this.brakePos = this.cW;
        this.brakeElapsed = 0;
      }
      if (this.type === 'HELIX') {
        this.rollLen = T;
        this.rollAnchor = this.cW - T;
        this.helixPos = 0;
      }
    } else if (this.on && this.divisionBeats !== this.lastDivision) {
      if (this.type === 'SLIP_ROLL') this.anchorRoll(frame);
      else if (this.type === 'ROLL') this.rollLen = T;
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
    const fpb = this.clock.framesPerBeat;
    const cycleFrames = Math.max(1, this.divisionBeats * fpb);

    for (let i = 0; i < n; i++) {
      const xL = inL[i]!;
      const xR = inR[i]!;
      this.onGain += (target - this.onGain) * this.onAlpha;
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
          const dl = this.dL[r]!;
          const dr = this.dR[r]!;
          this.dL[this.dW] = xL * g;
          this.dR[this.dW] = xR * g;
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'ECHO': {
          const fb = 0.3 + 0.55 * depth;
          const r = (this.dW - T + m) % m;
          const dl = this.dL[r]!;
          const dr = this.dR[r]!;
          this.dL[this.dW] = xL * g + dl * fb;
          this.dR[this.dW] = xR * g + dr * fb;
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'PING_PONG': {
          const fb = 0.3 + 0.55 * depth;
          const r = (this.dW - T + m) % m;
          const dl = this.dL[r]!;
          const dr = this.dR[r]!;
          this.dL[this.dW] = (xL + xR) * 0.5 * g + dr * fb;
          this.dR[this.dW] = dl * fb;
          yL = xL + depth * dl;
          yR = xR + depth * dr;
          break;
        }
        case 'SPIRAL': {
          this.spiralT += (T - this.spiralT) * this.spiralAlpha;
          const fb = 0.75 + 0.2 * depth;
          const dl = this.readRing(this.dL, this.dW - this.spiralT);
          const dr = this.readRing(this.dR, this.dW - this.spiralT);
          this.dL[this.dW] = xL * g + dl * fb;
          this.dR[this.dW] = xR * g + dr * fb;
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
          const lfo = 0.5 - 0.5 * Math.cos((TWO_PI * (frame + i)) / cycleFrames);
          const d = (0.0005 + 0.0055 * lfo) * this.sampleRate;
          const dl = this.readRing(this.dL, this.dW - d);
          const dr = this.readRing(this.dR, this.dW - d);
          this.dL[this.dW] = xL + dl * 0.5;
          this.dR[this.dW] = xR + dr * 0.5;
          const w = g * depth;
          yL = xL + dl * 0.7 * w;
          yR = xR + dr * 0.7 * w;
          break;
        }
        case 'PHASER': {
          const lfo = 0.5 - 0.5 * Math.cos((TWO_PI * (frame + i)) / cycleFrames);
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
          this.pitchPhase += (1 - ratio) / win;
          this.pitchPhase -= Math.floor(this.pitchPhase);
          const p1 = this.pitchPhase;
          const p2 = (p1 + 0.5) % 1;
          const w1 = 1 - Math.abs(2 * p1 - 1);
          const w2 = 1 - Math.abs(2 * p2 - 1);
          const sl = this.readRing(this.dL, this.dW - 1 - p1 * win) * w1 + this.readRing(this.dL, this.dW - 1 - p2 * win) * w2;
          const sr = this.readRing(this.dR, this.dW - 1 - p1 * win) * w1 + this.readRing(this.dR, this.dW - 1 - p2 * win) * w2;
          yL = xL + (sl - xL) * g;
          yR = xR + (sr - xR) * g;
          break;
        }
        case 'ROLL':
        case 'SLIP_ROLL': {
          if (this.on || g > 1e-4) {
            const idx = this.rollAnchor + (this.rollPos % this.rollLen);
            const rl = this.readRing(this.cL, idx);
            const rr = this.readRing(this.cR, idx);
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
            const r = 2 ** ((depth - 0.5) * 2);
            this.helixPos = (this.helixPos + r) % this.rollLen;
            const hl = this.readRing(this.cL, this.rollAnchor + this.helixPos);
            const hr = this.readRing(this.cR, this.rollAnchor + this.helixPos);
            yL = xL + (hl - xL) * 0.7 * g;
            yR = xR + (hr - xR) * 0.7 * g;
          }
          break;
        }
      }
      outL[i] = yL;
      outR[i] = yR;
      if (++this.dW >= m) this.dW = 0;
      if (++this.cW >= m) this.cW = 0;
    }
  }
}
