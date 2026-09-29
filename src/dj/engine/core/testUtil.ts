import { DeckCore, type DeckSettings, type DeckTrackData } from './DeckCore';

/** Test-only helpers. SR 1000 + 120 BPM → 500 frames per beat, first beat at frame 250. */
export const SR = 1000;
export const FPB = 500;
export const FIRST = 250;

/** A ramp track: sample i has value i (exact in float32 up to 2^24), so output == read position. */
export function rampTrack(frames = 60_000, extra: Partial<DeckTrackData> = {}): DeckTrackData {
  const data = new Float32Array(frames).map((_, i) => i);
  return { left: data, right: data, bpm: 120, firstBeatSec: 0.25, memoryCuesSec: [], hotCuesSec: Array(8).fill(null), ...extra };
}

export function makeDeck(settings: Partial<DeckSettings> = {}, track = rampTrack()): DeckCore {
  const d = new DeckCore(SR);
  d.set({ motorStartSec: 0, motorStopSec: 0, ...settings });
  d.load(track);
  return d;
}

const scratchL = new Float32Array(1 << 16);
const scratchR = new Float32Array(1 << 16);

/** Renders `frames` frames and returns the left channel (a copy). */
export function run(d: DeckCore, frames: number): Float32Array {
  let done = 0;
  const out = new Float32Array(frames);
  while (done < frames) {
    const n = Math.min(128, frames - done);
    d.render(scratchL, scratchR, 0, n);
    out.set(scratchL.subarray(0, n), done);
    done += n;
  }
  return out;
}
