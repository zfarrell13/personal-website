import type { BeatFxType, ColorFxType } from '../../constants';

/** Processor names registered by the bundled worklets. */
export const PROCESSORS = { decks: 'zf-decks', colorFx: 'zf-color-fx', beatFx: 'zf-beat-fx' } as const;
/** Public URLs of the bundles produced by scripts/build-worklets.ts. */
export const WORKLET_URLS = ['/worklets/decks.worklet.js', '/worklets/colorfx.worklet.js', '/worklets/beatfx.worklet.js'] as const;

export type ClockPortMessage = { t: 'clockPort'; port: MessagePort };
export type ColorFxMessage = { t: 'set'; type: ColorFxType; knob: number; param: number };
export type BeatFxMessage =
  | { t: 'set'; type: BeatFxType; divisionBeats: number; depth: number; on: boolean }
  | { t: 'latency'; frames: number }
  | ClockPortMessage;
export type ClockMessage = { t: 'clock'; frame: number; beat: number; bpm: number };
