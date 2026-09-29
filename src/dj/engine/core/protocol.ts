import type { DeckId } from '../../constants';
import type { DeckEvent, DeckSettings, TransportState } from './DeckCore';

/** Main thread → decks worklet. */
export type DeckCommand =
  | {
      t: 'load';
      deck: DeckId;
      left: Float32Array;
      right: Float32Array;
      bpm: number;
      firstBeatSec: number;
      memoryCuesSec: number[];
      hotCuesSec: (number | null)[];
    }
  | { t: 'unload'; deck: DeckId }
  | { t: 'play'; deck: DeckId }
  | { t: 'cue'; deck: DeckId; down: boolean }
  | { t: 'hotcue'; deck: DeckId; index: number; down: boolean; shift: boolean }
  | { t: 'call'; deck: DeckId; dir: -1 | 1 }
  | { t: 'loopIn' | 'loopOut' | 'reloop'; deck: DeckId }
  | { t: 'autoLoop'; deck: DeckId; beats: number }
  | { t: 'loopScale'; deck: DeckId; factor: 0.5 | 2 }
  | { t: 'beatJump'; deck: DeckId; dir: -1 | 1 }
  | { t: 'seek'; deck: DeckId; sec: number }
  | { t: 'jog'; deck: DeckId; touch: boolean; revPerSec: number; ring: boolean }
  | { t: 'set'; deck: DeckId; patch: Partial<DeckSettings> }
  | { t: 'sync'; deck: DeckId; on: boolean }
  | { t: 'master'; deck: DeckId };

/** Decks worklet → main thread. */
export type DeckReport =
  | { t: 'tel'; data: Float64Array }
  | { t: 'event'; deck: DeckId; e: DeckEvent }
  /** Beat clock for the FX worklet (sent over a dedicated MessagePort). */
  | { t: 'clock'; frame: number; beat: number; bpm: number };

/** Telemetry layout: one Float64Array, STRIDE values per deck, then globals. */
export const TEL = {
  loaded: 0,
  state: 1,
  posSec: 2,
  rate: 3,
  baseRate: 4,
  beat: 5,
  cueSec: 6,
  atCue: 7,
  loopInSec: 8,
  loopOutSec: 9,
  loopActive: 10,
  slipFlags: 11,
  shadowSec: 12,
  scratching: 13,
  ended: 14,
  lengthSec: 15,
  synced: 16,
  trim: 17,
  motor: 18,
  bpm: 19,
} as const;
export const TEL_STRIDE = 20;
export const TEL_MASTER = TEL_STRIDE * 2;
export const TEL_FRAME = TEL_MASTER + 1;
export const TEL_SIZE = TEL_FRAME + 1;

export const STATE_CODES: readonly TransportState[] = ['PAUSED', 'PLAYING', 'CUE_HOLD', 'HOTCUE_HOLD'];
