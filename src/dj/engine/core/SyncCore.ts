import { MAX_SYNC_TRIM, type DeckId } from '../../constants';
import type { DeckCore } from './DeckCore';
import { wrapHalf } from './grid';

/** PLL time constant (s) and integral gain. Tuned in SyncCore.test.ts. */
const PLL_TAU = 0.25;
const PLL_KI = 2;

/**
 * BEAT SYNC: master selection, tempo match and a phase-locked loop that trims
 * each follower's rate by at most ±0.5 % to keep beat phase error below 1 ms.
 * Runs once per render quantum inside the decks worklet, so positions are exact.
 */
export class SyncCore {
  master: DeckId | -1 = -1;
  readonly synced: [boolean, boolean] = [false, false];
  readonly trim: [number, number] = [0, 0];
  private readonly integ: [number, number] = [0, 0];
  /** Whether master and follower were both running normally on the previous block. */
  private readonly wasLocked: [boolean, boolean] = [false, false];

  constructor(private readonly sampleRate: number) {}

  setMaster(deck: DeckId): void {
    this.master = deck;
  }

  setSync(decks: readonly [DeckCore, DeckCore], deck: DeckId, on: boolean): void {
    this.synced[deck] = on;
    this.trim[deck] = 0;
    this.integ[deck] = 0;
    if (!on) {
      decks[deck].externalRate = null;
      return;
    }
    if (this.master === -1 && decks[deck].loaded) {
      this.master = deck;
      return;
    }
    const m = this.masterDeck(decks);
    if (m && deck !== this.master && m.runningNormally && decks[deck].runningNormally) this.alignPhase(m, decks[deck]);
    this.wasLocked[deck] = false;
  }

  private masterDeck(decks: readonly [DeckCore, DeckCore]): DeckCore | null {
    return this.master === -1 ? null : decks[this.master];
  }

  /** Moves the follower by less than half a beat so its beat phase equals the master's. */
  alignPhase(master: DeckCore, follower: DeckCore): void {
    const err = wrapHalf(master.beat - follower.beat);
    follower.seek((follower.pos + err * follower.frameGrid.framesPerBeat) / follower.sampleRate);
  }

  /** Phase error of `follower` against the master in beats, in [-0.5, 0.5). */
  phaseErrorBeats(decks: readonly [DeckCore, DeckCore], follower: DeckId): number {
    const m = this.masterDeck(decks);
    return m ? wrapHalf(m.beat - decks[follower].beat) : 0;
  }

  update(decks: readonly [DeckCore, DeckCore], frames: number): void {
    this.pickMaster(decks);
    const m = this.masterDeck(decks);
    const dt = frames / this.sampleRate;
    for (const id of [0, 1] as const) {
      const f = decks[id];
      const isFollower = this.synced[id] && m !== null && id !== this.master && f.loaded;
      if (!isFollower) {
        f.externalRate = null;
        this.trim[id] = 0;
        this.integ[id] = 0;
        this.wasLocked[id] = false;
        continue;
      }
      const locked = m.runningNormally && f.runningNormally;
      // (Re)align once both decks run normally: after play + motor spin-up, a scratch, reverse, or a jump.
      if (locked && !this.wasLocked[id]) {
        this.alignPhase(m, f);
        this.integ[id] = 0;
      }
      this.wasLocked[id] = locked;

      const masterBpm = m.bpm * m.tempoRate;
      const ratio = masterBpm / f.bpm;
      const subBeatLoop = m.loopActive && m.loopBeats < 1;
      if (locked && !subBeatLoop) {
        const errSec = (wrapHalf(m.beat - f.beat) * 60) / masterBpm;
        const iMax = MAX_SYNC_TRIM / PLL_KI;
        this.integ[id] = Math.max(-iMax, Math.min(iMax, this.integ[id] + errSec * dt));
        const t = errSec / PLL_TAU + PLL_KI * this.integ[id];
        this.trim[id] = Math.max(-MAX_SYNC_TRIM, Math.min(MAX_SYNC_TRIM, t));
      } else {
        this.trim[id] = 0;
      }
      f.externalRate = ratio * (1 + this.trim[id]);
    }
  }

  private pickMaster(decks: readonly [DeckCore, DeckCore]): void {
    if (this.master !== -1 && !decks[this.master].loaded) this.master = -1;
    const playing = ([0, 1] as const).filter((i) => decks[i].loaded && decks[i].playing);
    if (this.master === -1) {
      if (playing.length > 0) this.master = playing[0]!;
    } else if (!decks[this.master].playing && playing.length > 0) {
      this.master = playing[0]!; // hand over from a stopped master
    }
  }
}
