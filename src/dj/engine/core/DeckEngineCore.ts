import type { DeckId } from '../../constants';
import { DeckCore, type DeckEvent } from './DeckCore';
import { STATE_CODES, TEL, TEL_FRAME, TEL_MASTER, TEL_SIZE, TEL_STRIDE, type DeckCommand } from './protocol';
import { SyncCore } from './SyncCore';

const NO_ENGINE_EVENTS: ReadonlyArray<{ deck: DeckId; e: DeckEvent }> = Object.freeze([]);

/** Both decks + sync, driven block by block. The decks worklet is a thin wrapper around this. */
export class DeckEngineCore {
  readonly decks: readonly [DeckCore, DeckCore];
  readonly sync: SyncCore;

  constructor(readonly sampleRate: number) {
    this.decks = [new DeckCore(sampleRate), new DeckCore(sampleRate)];
    this.sync = new SyncCore(sampleRate);
  }

  command(c: DeckCommand): void {
    const d = this.decks[c.deck];
    switch (c.t) {
      case 'load':
        d.load(c);
        break;
      case 'unload':
        d.unload();
        break;
      case 'play':
        d.play();
        break;
      case 'cue':
        d.cue(c.down);
        break;
      case 'hotcue':
        d.hotCue(c.index, c.down, c.shift);
        break;
      case 'call':
        d.callMemoryCue(c.dir);
        break;
      case 'loopIn':
        d.loopInPress();
        break;
      case 'loopOut':
        d.loopOutPress();
        break;
      case 'reloop':
        d.reloopExit();
        break;
      case 'autoLoop':
        d.autoLoop(c.beats);
        break;
      case 'loopScale':
        d.scaleLoop(c.factor);
        break;
      case 'beatJump':
        d.beatJump(c.dir);
        break;
      case 'seek':
        d.seek(c.sec);
        break;
      case 'jog':
        d.jog(c.touch, c.revPerSec, c.ring);
        break;
      case 'set':
        d.set(c.patch);
        break;
      case 'sync':
        this.sync.setSync(this.decks, c.deck, c.on);
        break;
      case 'master':
        this.sync.setMaster(c.deck);
        break;
    }
  }

  /** Renders one block: outputs[0] = deck 1 [L, R], outputs[1] = deck 2 [L, R]. */
  process(out0L: Float32Array, out0R: Float32Array, out1L: Float32Array, out1R: Float32Array, frames: number): void {
    this.sync.update(this.decks, frames);
    this.decks[0].render(out0L, out0R, 0, frames);
    this.decks[1].render(out1L, out1R, 0, frames);
  }

  drainEvents(): ReadonlyArray<{ deck: DeckId; e: DeckEvent }> {
    const a = this.decks[0].drainEvents();
    const b = this.decks[1].drainEvents();
    if (a.length === 0 && b.length === 0) return NO_ENGINE_EVENTS; // no allocation in the common case
    const out: Array<{ deck: DeckId; e: DeckEvent }> = [];
    for (const e of a) out.push({ deck: 0, e });
    for (const e of b) out.push({ deck: 1, e });
    return out;
  }

  /** Writes telemetry into `out` (length TEL_SIZE). */
  writeTelemetry(out: Float64Array, frame: number): void {
    const sr = this.sampleRate;
    for (let id: DeckId = 0; id < 2; id = (id + 1) as DeckId) {
      const d = this.decks[id];
      const o = id * TEL_STRIDE;
      out[o + TEL.loaded] = d.loaded ? 1 : 0;
      out[o + TEL.state] = STATE_CODES.indexOf(d.state);
      out[o + TEL.posSec] = d.pos / sr;
      out[o + TEL.rate] = d.rate;
      // Display rate excludes the PLL trim ("invisible on the tempo display").
      out[o + TEL.baseRate] = d.externalRate !== null && this.sync.synced[id] ? this.sync.ratio[id] : d.baseRate;
      out[o + TEL.beat] = d.beat;
      out[o + TEL.cueSec] = d.cueFrame / sr;
      out[o + TEL.atCue] = d.atCue ? 1 : 0;
      out[o + TEL.loopInSec] = d.loopIn / sr;
      out[o + TEL.loopOutSec] = d.loopOut / sr;
      out[o + TEL.loopActive] = d.loopActive ? 1 : 0;
      out[o + TEL.slipFlags] = d.slipFlags;
      out[o + TEL.shadowSec] = d.shadowPos / sr;
      out[o + TEL.scratching] = d.scratching ? 1 : 0;
      out[o + TEL.ended] = d.ended ? 1 : 0;
      out[o + TEL.lengthSec] = d.length / sr;
      out[o + TEL.synced] = this.sync.synced[id] ? 1 : 0;
      out[o + TEL.trim] = this.sync.trim[id];
      out[o + TEL.motor] = d.motor;
      out[o + TEL.bpm] = d.loaded ? d.bpm : 0;
      out[o + TEL.releasing] = d.releasing ? 1 : 0;
    }
    out[TEL_MASTER] = this.sync.master;
    out[TEL_FRAME] = frame;
  }

  /** Reused by masterClock(): valid until the next call. */
  private readonly clock = { beat: 0, bpm: 0 };

  /** Master beat clock for the FX worklet: current beat position and effective BPM. */
  masterClock(): { beat: number; bpm: number } | null {
    const m = this.sync.master;
    if (m === -1) return null;
    const d = this.decks[m];
    this.clock.beat = d.beat;
    this.clock.bpm = d.bpm * d.tempoRate;
    return this.clock;
  }
}

export { TEL_SIZE };
