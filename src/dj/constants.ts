/** Shared DJ constants. Imported by the engine, the worklets, the store and the UI. No DOM or React here. */

export type DeckId = 0 | 1;
export const DECK_IDS: readonly DeckId[] = [0, 1];

/** Tempo fader range in ± percent. 100 = WIDE. */
export type TempoRange = 6 | 10 | 16 | 100;
export const TEMPO_RANGES: readonly TempoRange[] = [6, 10, 16, 100];
/** Display/engine resolution of the tempo value, in percent, per range. */
export const TEMPO_RESOLUTION: Record<TempoRange, number> = { 6: 0.01, 10: 0.05, 16: 0.05, 100: 0.5 };

export const HOT_CUE_COUNT = 8;
export const HOT_CUE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** Default pad colours (CDJ-style palette, not Pioneer assets). */
export const HOT_CUE_COLORS = ['#28e214', '#ff127b', '#1f8cff', '#ffa800', '#b432ff', '#00e0ff', '#ff4a1c', '#e5e5e5'] as const;

export const LOOP_MIN_BEATS = 1 / 16;
export const LOOP_MAX_BEATS = 32;
export const BEAT_JUMP_SIZES = [1, 2, 4, 8, 16, 32] as const;
export const DEFAULT_BEAT_JUMP = 4;
export const QUANTIZE_RESOLUTIONS = [1 / 8, 1 / 4, 1 / 2, 1] as const;

/** One full jog revolution scrubs this many seconds of audio (33⅓ rpm feel). */
export const SCRATCH_SEC_PER_REV = 1.8;
/** Pitch bend per jog revolution/second (outer ring or CDJ mode). */
export const BEND_PER_REV = 0.08;
export const BEND_MAX = 0.5;
export const DEFAULT_MOTOR_SEC = 0.15;
export const END_WARNING_SEC = 30;

/** Worklet posts telemetry every N render quanta (128 frames): 6 → 62.5 Hz at 48 kHz. */
export const TELEMETRY_EVERY_BLOCKS = 6;

export const MAX_SYNC_TRIM = 0.005;
export const MT_CROSSFADE_SEC = 0.02;
/** Signalsmith Stretch block size used for Master Tempo (lower = less latency, more CPU). */
export const STRETCH_BLOCK_MS = 60;
export const STRETCH_INTERVAL_MS = 15;

export const COLOR_FX_TYPES = ['SPACE', 'DUB_ECHO', 'SWEEP', 'NOISE', 'CRUSH', 'FILTER'] as const;
export type ColorFxType = (typeof COLOR_FX_TYPES)[number];

export const BEAT_FX_TYPES = [
  'DELAY',
  'ECHO',
  'PING_PONG',
  'SPIRAL',
  'REVERB',
  'TRANS',
  'FILTER',
  'FLANGER',
  'PHASER',
  'PITCH',
  'SLIP_ROLL',
  'ROLL',
  'VINYL_BRAKE',
  'HELIX',
] as const;
export type BeatFxType = (typeof BEAT_FX_TYPES)[number];
export const BEAT_FX_DIVISIONS = [1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16] as const;
export const DEFAULT_BEAT_FX_DIVISION_INDEX = 4; // 1 beat
export const FX_CHANNELS = ['1', '2', 'XF_A', 'XF_B', 'MASTER'] as const;
export type FxChannel = (typeof FX_CHANNELS)[number];

export type XfAssign = 'A' | 'THRU' | 'B';
export type CurveKind = 0 | 1 | 2;
export type HeadphoneMode = 'STEREO' | 'SPLIT';

export const TRACK_CACHE_SIZE = 4;
