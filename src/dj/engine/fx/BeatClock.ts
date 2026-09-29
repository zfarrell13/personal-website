/**
 * Master beat clock inside the FX worklet. The decks worklet posts
 * (frame, beat, bpm) every few blocks over a MessagePort; between updates the
 * clock extrapolates by frame count. Audio reaching the mixer is delayed by the
 * Master Tempo latency, so beats are shifted back by `latencyFrames`.
 */
export class BeatClock {
  private frame0 = 0;
  private beat0 = 0;
  bpm = 120;
  latencyFrames = 0;
  running = false;

  constructor(readonly sampleRate: number) {}

  update(frame: number, beat: number, bpm: number): void {
    if (!Number.isFinite(frame) || !Number.isFinite(beat) || !Number.isFinite(bpm)) return;
    this.frame0 = frame;
    this.beat0 = beat;
    this.bpm = bpm > 0 ? bpm : 120;
    this.running = true;
  }

  /** Beat position heard at `frame` (float, may be negative). */
  beatAt(frame: number): number {
    if (!this.running) return ((frame - this.latencyFrames) * this.bpm) / 60 / this.sampleRate;
    return this.beat0 + ((frame - this.frame0 - this.latencyFrames) * this.bpm) / 60 / this.sampleRate;
  }

  get framesPerBeat(): number {
    return (60 / this.bpm) * this.sampleRate;
  }
}
