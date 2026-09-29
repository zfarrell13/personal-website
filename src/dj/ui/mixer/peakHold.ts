import { ladderSegments } from '../../engine/mixer/MixerCore';

/** LED ladder peak hold: the highest segment stays lit for `holdSec`, then falls one segment per `fallSec`. */
export class PeakHold {
  private held = 0;
  private timer = 0;
  constructor(
    private readonly holdSec = 1,
    private readonly fallSec = 0.08,
  ) {}

  update(segments: number, dt: number): number {
    if (segments >= this.held) {
      this.held = segments;
      this.timer = this.holdSec;
    } else if ((this.timer -= dt) <= 0) {
      this.held = Math.max(segments, this.held - 1);
      this.timer = this.fallSec;
    }
    return this.held;
  }
}

/** Lit segments for a linear peak; a non-finite reading (NaN, ±Infinity) shows as silence. */
export const meterSegments = (peak: number): number => ladderSegments(Number.isFinite(peak) ? peak : 0);
