/**
 * Inputs sampled once per animation frame from telemetry + the store.
 * `beat` must already be the AUDIBLE beat (telemetry `audibleBeat`, which
 * subtracts the output latency) so lights land on the beat the listener hears.
 */
export interface DirectorInput {
  dt: number;
  /** Master low-band RMS (0..~0.5). */
  lowRms: number;
  /** Any deck audible on the master. */
  playing: boolean;
  /** Audible master beat position (float beats). */
  beat: number;
  /** 0..1: how far the Colour FX FILTER knob of an on-air channel is from centre. */
  filterSweep: number;
  /** 0..1: how much the LOW EQ of the loudest on-air channel is cut (1 = kill). */
  lowCut: number;
  /** 0..1: Beat FX depth while Beat FX is on, else 0. */
  beatFxDepth: number;
}

export interface DirectorState {
  energy: number;
  tension: number;
  /** 1 at the moment of a drop, decaying to 0 over ~1.5 s. */
  drop: number;
  dropCount: number;
  idle: boolean;
  /** 0..1 strobe intensity this frame. */
  strobe: number;
  /** 0..1 laser intensity. */
  laser: number;
  /** Beat fraction 0..1 and bar fraction 0..1 for the shaders. */
  beatPhase: number;
  barPhase: number;
}

const approach = (cur: number, target: number, dt: number, tauUp: number, tauDown: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? tauUp : tauDown)));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Non-finite (NaN, ±Infinity) → 0, so silence/garbage never poisons the smoothed state. */
const fin = (v: number) => (Number.isFinite(v) ? v : 0);

/**
 * Crowd/light energy model: energy = smoothed bass; tension rises with filter
 * sweeps, low cuts and Beat FX depth; a DROP fires when built-up tension is
 * released and the bass comes back within 2 s.
 */
export class ClubDirector {
  readonly state: DirectorState = {
    energy: 0,
    tension: 0,
    drop: 0,
    dropCount: 0,
    idle: true,
    strobe: 0,
    laser: 0,
    beatPhase: 0,
    barPhase: 0,
  };
  private peakTension = 0;
  /** After a drop, tension must fall below 0.2 before a new build-up counts. */
  private rearmed = true;
  private releaseWindow = 0;
  private prevFxDepth = 0;
  private fxRise = 0;

  update(i: DirectorInput): DirectorState {
    const s = this.state;
    const dt = Math.max(0, Math.min(0.1, fin(i.dt)));
    s.idle = !i.playing;
    const bass = i.playing ? clamp01(fin(i.lowRms) / 0.25) : 0;
    s.energy = approach(s.energy, bass, dt, 0.3, 1.5);

    // Beat FX depth counts while it is rising or held high.
    const fxDepth = clamp01(fin(i.beatFxDepth));
    this.fxRise = approach(this.fxRise, fxDepth > this.prevFxDepth + 1e-3 ? 1 : fxDepth, dt, 0.2, 0.5);
    this.prevFxDepth = fxDepth;
    const target = i.playing
      ? clamp01(0.7 * clamp01(fin(i.filterSweep)) + 0.7 * clamp01(fin(i.lowCut)) + 0.5 * this.fxRise * fxDepth)
      : 0;
    s.tension = approach(s.tension, target, dt, 1.0, 0.25);
    if (s.tension < 0.2) this.rearmed = true;
    if (this.rearmed) this.peakTension = Math.max(this.peakTension, s.tension);

    if (this.peakTension >= 0.5 && target < 0.2 && this.releaseWindow <= 0) this.releaseWindow = 2;
    if (this.releaseWindow > 0) {
      this.releaseWindow -= dt;
      if (bass > 0.6) {
        s.drop = 1;
        s.dropCount++;
        this.peakTension = 0;
        this.rearmed = false;
        this.releaseWindow = 0;
      } else if (this.releaseWindow <= 0) {
        this.peakTension = 0;
      }
    }
    s.drop = Math.max(0, s.drop - dt / 1.5);

    const beat = fin(i.beat);
    s.beatPhase = i.playing ? beat - Math.floor(beat) : 0;
    s.barPhase = i.playing ? beat / 4 - Math.floor(beat / 4) : 0;
    const onBeat = s.beatPhase < 0.12 ? 1 : 0;
    s.strobe = s.idle ? 0 : Math.max(s.drop > 0.6 ? 1 : 0, s.energy > 0.7 ? onBeat * s.energy : 0);
    s.laser = s.idle ? 0 : clamp01((s.tension - 0.3) / 0.5);
    return s;
  }
}
