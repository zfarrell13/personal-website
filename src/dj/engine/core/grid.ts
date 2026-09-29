import { beatAtTime, beatTimeSec, type TrackEntry } from '@/shared/tracks';

export type Grid = Pick<TrackEntry, 'bpm' | 'firstBeatSec'>;

/** Frame-domain beatgrid helpers built on the shared beat math. */
export class FrameGrid {
  constructor(
    readonly grid: Grid,
    readonly sampleRate: number,
  ) {}

  get framesPerBeat(): number {
    return (60 / this.grid.bpm) * this.sampleRate;
  }

  beatAt(frame: number): number {
    return beatAtTime(this.grid, frame / this.sampleRate);
  }

  frameAt(beat: number): number {
    return beatTimeSec(this.grid, beat) * this.sampleRate;
  }

  /** Nearest grid point in steps of `res` beats. */
  snap(frame: number, res: number): number {
    return this.frameAt(Math.round(this.beatAt(frame) / res) * res);
  }

  /** Previous (or current) grid point in steps of `res` beats. */
  floor(frame: number, res: number): number {
    return this.frameAt(Math.floor(this.beatAt(frame) / res + 1e-9) * res);
  }

  /** Offset of `frame` from its nearest grid point (frames, can be negative). */
  phaseOffset(frame: number, res: number): number {
    return frame - this.snap(frame, res);
  }
}

/** Wraps x into [-0.5, 0.5). */
export const wrapHalf = (x: number): number => x - Math.floor(x + 0.5);
