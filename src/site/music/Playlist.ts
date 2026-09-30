import type { TrackEntry } from '@/shared/tracks';
import { shuffle } from '@/surf/audio/synth';

/** Shuffled surf soundtrack: plays every `surf: true` track once per cycle, no immediate repeats. */
export class Playlist {
  private order: TrackEntry[] = [];
  private i = 0;
  private last: TrackEntry | null = null;
  readonly tracks: TrackEntry[];

  constructor(
    all: readonly TrackEntry[],
    private readonly rand: () => number = Math.random,
  ) {
    this.tracks = all.filter((t) => t.surf);
  }

  get empty(): boolean {
    return this.tracks.length === 0;
  }

  next(): TrackEntry | null {
    if (this.empty) return null;
    if (this.i >= this.order.length) {
      this.order = shuffle(this.tracks, this.rand);
      if (this.order.length > 1 && this.order[0] === this.last) this.order.push(this.order.shift()!);
      this.i = 0;
    }
    this.last = this.order[this.i++]!;
    return this.last;
  }
}
