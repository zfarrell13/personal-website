import type { SurfEvent } from '../physics/events';
import type { SurferState } from '../physics/Surfer';
import { barrelDepth, fillImpulse, fillNoise, hootVoices, rumbleParams, sprayParams, tubeCutoffHz, type HootVoice } from './synth';

/** What the crashing rumble follows each frame. */
export interface RumbleInput {
  /** Distance (m) from the rider to the impact zone. */
  distance: number;
  /** Fast-section level, 0–1. */
  fast: number;
}

const TAU = 0.08; // smoothing time constant for parameter changes (s)

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  fillNoise(buf.getChannelData(0), seed);
  return buf;
}

function renderVoice(ctx: OfflineAudioContext, v: HootVoice, noise: AudioBuffer): void {
  const t0 = v.delay;
  const t1 = t0 + v.duration;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(v.f0, t0);
  osc.frequency.exponentialRampToValueAtTime(v.f0 * v.glide, t0 + v.duration * 0.35);
  osc.frequency.exponentialRampToValueAtTime(v.f0 * 0.9, t1);
  const vib = ctx.createOscillator();
  vib.frequency.value = v.vibratoHz;
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = v.f0 * 0.03;
  vib.connect(vibDepth).connect(osc.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(v.gain, t0 + 0.05);
  env.gain.setValueAtTime(v.gain, t1 - 0.2);
  env.gain.linearRampToValueAtTime(0, t1);
  const pan = ctx.createStereoPanner();
  pan.pan.value = v.pan;
  for (const [a, b] of [v.f1, v.f2]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(a, t0);
    bp.frequency.linearRampToValueAtTime(b, t1);
    osc.connect(bp).connect(env);
  }
  // breath
  const br = ctx.createBufferSource();
  br.buffer = noise;
  const brF = ctx.createBiquadFilter();
  brF.type = 'bandpass';
  brF.frequency.value = 1800;
  const brG = ctx.createGain();
  brG.gain.value = 0.25;
  br.connect(brF).connect(brG).connect(env);
  env.connect(pan).connect(ctx.destination);
  for (const n of [osc, vib, br]) {
    n.start(t0);
    n.stop(t1 + 0.05);
  }
}

/** Synthesize crowd "whooo!" hoots offline (no samples to license). */
export async function renderHoots(sampleRate = 44100, variants = 3): Promise<AudioBuffer[]> {
  if (typeof OfflineAudioContext === 'undefined') return [];
  const out: AudioBuffer[] = [];
  for (let k = 0; k < variants; k++) {
    const ctx = new OfflineAudioContext(2, Math.round(sampleRate * 1.6), sampleRate);
    const noise = noiseBuffer(ctx, 1.6, 100 + k);
    hootVoices(k + 1).forEach((v) => renderVoice(ctx, v, noise));
    out.push(await ctx.startRendering());
  }
  return out;
}

/**
 * Surf audio graph (the music is the site player's: see getMusicPlayer, which SurfGame muffles and ducks):
 *   spray ──► tubeLP ─► dry ─────────► master ► compressor ► out
 *                    └► reverb ► wet ─┘
 *   ocean (filtered noise with slow swells) ► master
 *   rumble (low-passed noise: the crashing lip, by distance / fast section) ► master
 *   hoots / stingers / spit whoosh ► master
 */
export class SurfAudio {
  readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly comp = this.ctx.createDynamicsCompressor();
  private readonly tubeLP = this.ctx.createBiquadFilter();
  private readonly dry = this.ctx.createGain();
  private readonly wet = this.ctx.createGain();
  private readonly reverb = this.ctx.createConvolver();
  private readonly sprayBP = this.ctx.createBiquadFilter();
  private readonly sprayGain = this.ctx.createGain();
  private readonly rumbleLP = this.ctx.createBiquadFilter();
  private readonly rumbleGain = this.ctx.createGain();
  private readonly noise: AudioBuffer;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private hoots: AudioBuffer[] = [];
  private disposed = false;
  /** Set by pause(), cleared by resume(): a pause during start() keeps the context suspended. */
  private paused = false;

  constructor() {
    const c = this.ctx;
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.gain.value = 0.9;
    this.master.connect(this.comp).connect(c.destination);

    this.tubeLP.type = 'lowpass';
    this.tubeLP.frequency.value = 20000;
    const ir = c.createBuffer(2, Math.round(c.sampleRate * 0.6), c.sampleRate);
    fillImpulse(ir.getChannelData(0), ir.getChannelData(1), c.sampleRate, 0.6);
    this.reverb.buffer = ir;
    this.wet.gain.value = 0;
    this.tubeLP.connect(this.dry).connect(this.master);
    this.tubeLP.connect(this.reverb).connect(this.wet).connect(this.master);

    this.noise = noiseBuffer(c, 4, 7);
    this.sprayBP.type = 'bandpass';
    this.sprayBP.Q.value = 1.2;
    this.sprayGain.gain.value = 0;
    this.loopNoise().connect(this.sprayBP).connect(this.sprayGain).connect(this.tubeLP);

    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 200;
    this.rumbleGain.gain.value = 0;
    this.loopNoise().connect(this.rumbleLP).connect(this.rumbleGain).connect(this.master);

    this.ocean(500, 'lowpass', 0.22, 0.07, 0.12);
    this.ocean(2500, 'highpass', 0.035, 0.11, 0.02);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 3;
    src.start();
    this.sources.push(src);
    return src;
  }

  /** Ocean layer: filtered looping noise whose gain swells with a slow LFO. */
  private ocean(freq: number, type: BiquadFilterType, base: number, lfoHz: number, depth: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = base;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    this.sources.push(lfo);
    this.loopNoise().connect(f).connect(g).connect(this.master);
  }

  private started: Promise<void> | null = null;

  /** Call from a user gesture (DROP IN). Idempotent: later calls just resume. */
  start(): Promise<void> {
    if (this.started) {
      this.resume();
      return this.started;
    }
    this.started = this.init();
    return this.started;
  }

  private async init(): Promise<void> {
    await this.ctx.resume();
    if (this.disposed) return;
    // pause() may have run while resume() was pending; its suspend() lost that race.
    if (this.paused) void this.ctx.suspend().catch(() => undefined);
    renderHoots(this.ctx.sampleRate)
      .then((h) => {
        if (!this.disposed) this.hoots = h;
      })
      .catch((e: unknown) => console.warn('Hoot synthesis failed', e));
  }

  pause(): void {
    this.paused = true;
    if (!this.disposed) void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    void this.ctx.resume().catch(() => undefined);
  }

  update(s: SurferState, speed: number, rumble: RumbleInput): void {
    const now = this.ctx.currentTime;
    const r = rumbleParams(rumble.distance, rumble.fast);
    this.rumbleLP.frequency.setTargetAtTime(r.cutoff, now, TAU);
    this.rumbleGain.gain.setTargetAtTime(r.gain, now, TAU);
    const riding = s.mode === 'riding';
    const sp = sprayParams(speed, Math.min(1, Math.abs(s.turnRate) / 2.5) + (s.stalling ? 0.5 : 0));
    this.sprayBP.frequency.setTargetAtTime(sp.freq, now, TAU);
    this.sprayGain.gain.setTargetAtTime(riding ? sp.gain : 0, now, TAU);
    this.setTubeDepth(barrelDepth(s));
  }

  private setTubeDepth(depth: number): void {
    const now = this.ctx.currentTime;
    this.tubeLP.frequency.setTargetAtTime(tubeCutoffHz(depth), now, TAU);
    this.wet.gain.setTargetAtTime(0.6 * depth, now, TAU);
    this.dry.gain.setTargetAtTime(1 - 0.3 * depth, now, TAU);
  }

  onEvent(e: SurfEvent): void {
    if (e.type === 'tubeExit') {
      this.whoosh();
      if (e.duration > 2) this.hoot();
    } else if (e.type === 'wipeout' || e.type === 'kickedOut') {
      this.setTubeDepth(0);
      if (e.type === 'wipeout' && e.reason === 'pierd') this.thunk();
    }
  }

  /** PIER'D: a dull wooden thunk — a low sine dropping 110 → 45 Hz, gone in a quarter second. */
  thunk(): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Big combo banked. */
  onBank(points: number, multiplier: number): void {
    if (multiplier >= 3 || points >= 3000) {
      this.hoot();
      this.stinger();
    }
  }

  hoot(): void {
    if (this.disposed || this.hoots.length === 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.hoots[Math.floor(Math.random() * this.hoots.length)]!;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = this.ctx.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Rising square-wave arpeggio (C5 E5 G5 C6). */
  stinger(): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.06, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.18);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.2);
    });
  }

  /** Tube exit: band-passed noise sweeping 400 → 3200 Hz. */
  whoosh(): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.65);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    });
    void this.ctx.close().catch(() => undefined);
  }
}
