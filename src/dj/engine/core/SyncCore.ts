import { MAX_SYNC_TRIM, type DeckId } from '../../constants';
import type { DeckCore } from './DeckCore';
import { wrapHalf } from './grid';

/** PLL time constant (s) and integral gain. Tuned in SyncCore.test.ts. */
const PLL_TAU = 0.25;
const PLL_KI = 2;
/** Phase errors beyond this (beats, ≈ 10 ms at 120 BPM) are realigned by a seek; smaller ones are left to the PLL. */
const REALIGN_BEATS = 0.02;

const irregularLoop = (d: DeckCore): boolean => {
  if (!d.loopActive) return false;
  const beats = d.loopBeats;
  return beats < 1 || Math.abs(beats - Math.round(beats)) > 1e-3;
};

/**
 * BEAT SYNC: master selection, tempo match and a phase-locked loop that trims
 * each follower's rate by at most ±0.5 % to keep beat phase error below 1 ms.
 * Runs once per render quantum inside the decks worklet, so positions are exact.
 */
export class SyncCore {
  master: DeckId | -1 = -1;
  readonly synced: [boolean, boolean] = [false, false];
  readonly trim: [number, number] = [0, 0];
  /** Tempo-match ratio (master BPM / follower BPM) last applied to each follower, before the PLL trim. */
  readonly ratio: [number, number] = [1, 1];
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
    const shadowLead = follower.shadowPos - follower.pos;
    const slipping = follower.slipFlags !== 0;
    follower.seek((follower.pos + err * follower.frameGrid.framesPerBeat) / follower.sampleRate);
    if (slipping) follower.shadowPos = follower.pos + shadowLead; // the slip shadow keeps its lead over the playhead
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
    for (let id: DeckId = 0; id < 2; id = (id + 1) as DeckId) {
      const f = decks[id];
      const isFollower = this.synced[id] && m !== null && id !== this.master && f.loaded;
      if (!isFollower) {
        f.externalRate = null;
        this.trim[id] = 0;
        this.integ[id] = 0;
        this.wasLocked[id] = false;
        continue;
      }
      // A pitch-bent deck (either one) is not locked: no realign, no PLL; one realign when the bend ends.
      const locked = m.runningNormally && f.runningNormally && !m.bending && !f.bending;
      // (Re)align once both decks run normally: after play + motor spin-up, a scratch, reverse, or a jump.
      const masterBpm = m.bpm * m.tempoRate;
      const ratio = masterBpm / f.bpm;
      // Loops that aren't whole-beat multiples shift the beat phase every cycle: leave them alone.
      const subBeatLoop = irregularLoop(m) || irregularLoop(f);
      // Also realign after any jump or loop exit: an error the PLL would take tens of seconds to trim out.
      const jumped = locked && !subBeatLoop && Math.abs(wrapHalf(m.beat - f.beat)) > REALIGN_BEATS;
      if (locked && (!this.wasLocked[id] || jumped)) {
        this.alignPhase(m, f);
        this.integ[id] = 0;
      }
      this.wasLocked[id] = locked;
      if (locked && !subBeatLoop) {
        const errSec = (wrapHalf(m.beat - f.beat) * 60) / masterBpm;
        const iMax = MAX_SYNC_TRIM / PLL_KI;
        this.integ[id] = Math.max(-iMax, Math.min(iMax, this.integ[id] + errSec * dt));
        const t = errSec / PLL_TAU + PLL_KI * this.integ[id];
        this.trim[id] = Math.max(-MAX_SYNC_TRIM, Math.min(MAX_SYNC_TRIM, t));
      } else {
        this.trim[id] = 0;
      }
      this.ratio[id] = ratio;
      f.externalRate = ratio * (1 + this.trim[id]);
    }
  }

  private pickMaster(decks: readonly [DeckCore, DeckCore]): void {
    if (this.master !== -1 && !decks[this.master].loaded) this.master = -1;
    const first: DeckId | -1 = decks[0].loaded && decks[0].playing ? 0 : decks[1].loaded && decks[1].playing ? 1 : -1;
    if (first === -1) return;
    if (this.master === -1 || !decks[this.master].playing) this.master = first; // first player, or hand over from a stopped master
  }
}
