import { create } from 'zustand';
import type { WaveformData } from '@/shared/waveform';
import {
  DEFAULT_BEAT_FX_DIVISION_INDEX,
  DEFAULT_BEAT_JUMP,
  DEFAULT_MOTOR_SEC,
  type BeatFxType,
  type ColorFxType,
  type CurveKind,
  type DeckId,
  type FxChannel,
  type HeadphoneMode,
  type XfAssign,
} from '../constants';
import type { DeckSettings } from '../engine/core/DeckCore';
import { emptySlots, type HotCueSlots } from './hotcueStorage';
import { applyTempoFader, effectiveTempoPct, type SyncContext, type TempoControls } from './tempoLogic';

export interface DeckState extends TempoControls {
  trackId: string | null;
  loading: boolean;
  masterTempo: boolean;
  reverse: boolean;
  slip: boolean;
  quantize: boolean;
  quantizeBeats: number;
  beatJumpBeats: number;
  vinylMode: boolean;
  jogWeight: number;
  motorStartSec: number;
  motorStopSec: number;
  hotCues: HotCueSlots;
  /** Seconds of audio visible in the detail waveform. */
  zoomSec: number;
  browseOpen: boolean;
  /** Track waiting for a second tap because this deck is on air. */
  pendingLoad: string | null;
  waveform: WaveformData | null;
  overview: WaveformData | null;
}

export interface ChannelState {
  trim: number;
  hi: number;
  mid: number;
  low: number;
  /** Colour FX knob −1..1, 0 = off. */
  color: number;
  fader: number;
  xf: XfAssign;
  cue: boolean;
}

export interface BeatFxState {
  type: BeatFxType;
  divisionIndex: number;
  channel: FxChannel;
  depth: number;
  on: boolean;
}

export interface MixerState {
  ch: [ChannelState, ChannelState];
  crossfader: number;
  chCurve: CurveKind;
  xfCurve: CurveKind;
  colorFxType: ColorFxType;
  colorFxParam: number;
  beatFx: BeatFxState;
  masterLevel: number;
  masterCue: boolean;
  cueMix: number;
  hpLevel: number;
  hpMode: HeadphoneMode;
}

export interface UiState {
  view: 'closeup' | 'room';
  mobilePanel: 0 | 1 | 2;
  settingsOpen: boolean;
  sinkId: string | null;
  notice: string | null;
  mtAvailable: boolean;
  audioReady: boolean;
  shift: boolean;
}

export interface DjData {
  decks: [DeckState, DeckState];
  mixer: MixerState;
  ui: UiState;
}

export interface DjState extends DjData {
  setDeck(deck: DeckId, patch: Partial<DeckState>): void;
  setChannel(ch: DeckId, patch: Partial<ChannelState>): void;
  setMixer(patch: Partial<Omit<MixerState, 'ch' | 'beatFx'>>): void;
  setBeatFx(patch: Partial<BeatFxState>): void;
  setUi(patch: Partial<UiState>): void;
  setTempoFader(deck: DeckId, fader: number, ctx: SyncContext): void;
  reset(): void;
}

export const initialDeck = (): DeckState => ({
  trackId: null,
  loading: false,
  tempoFader: 0,
  tempoPct: 0,
  range: 10,
  tempoReset: false,
  sync: false,
  masterTempo: false,
  reverse: false,
  slip: false,
  quantize: true,
  quantizeBeats: 1,
  beatJumpBeats: DEFAULT_BEAT_JUMP,
  vinylMode: true,
  jogWeight: 0.5,
  motorStartSec: DEFAULT_MOTOR_SEC,
  motorStopSec: DEFAULT_MOTOR_SEC,
  hotCues: emptySlots(),
  zoomSec: 8,
  browseOpen: false,
  pendingLoad: null,
  waveform: null,
  overview: null,
});

export const initialChannel = (): ChannelState => ({ trim: 0.5, hi: 0.5, mid: 0.5, low: 0.5, color: 0, fader: 0, xf: 'THRU', cue: false });

export const initialDjData = (): DjData => ({
  decks: [initialDeck(), initialDeck()],
  mixer: {
    ch: [initialChannel(), initialChannel()],
    crossfader: 0.5,
    chCurve: 1,
    xfCurve: 0,
    colorFxType: 'FILTER',
    colorFxParam: 0.5,
    beatFx: { type: 'ECHO', divisionIndex: DEFAULT_BEAT_FX_DIVISION_INDEX, channel: 'MASTER', depth: 0.5, on: false },
    masterLevel: 0.84,
    masterCue: false,
    cueMix: 0,
    hpLevel: 0.6,
    hpMode: 'STEREO',
  },
  ui: { view: 'closeup', mobilePanel: 1, settingsOpen: false, sinkId: null, notice: null, mtAvailable: true, audioReady: false, shift: false },
});

const replace = <T>(arr: readonly [T, T], i: DeckId, v: T): [T, T] => (i === 0 ? [v, arr[1]] : [arr[0], v]);

/** The single source of truth for every control position and toggle. */
export const useDjStore = create<DjState>()((set) => ({
  ...initialDjData(),
  setDeck: (deck, patch) => set((s) => ({ decks: replace(s.decks, deck, { ...s.decks[deck], ...patch }) })),
  setChannel: (ch, patch) => set((s) => ({ mixer: { ...s.mixer, ch: replace(s.mixer.ch, ch, { ...s.mixer.ch[ch], ...patch }) } })),
  setMixer: (patch) => set((s) => ({ mixer: { ...s.mixer, ...patch } })),
  setBeatFx: (patch) => set((s) => ({ mixer: { ...s.mixer, beatFx: { ...s.mixer.beatFx, ...patch } } })),
  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  setTempoFader: (deck, fader, ctx) => set((s) => ({ decks: applyTempoFader(s.decks, deck, fader, ctx) })),
  reset: () => set(initialDjData()),
}));

/** Engine-facing deck settings derived from the store. */
export function deckSettingsFromState(d: DeckState): DeckSettings {
  return {
    tempoPct: effectiveTempoPct(d),
    reverse: d.reverse,
    slip: d.slip,
    quantize: d.quantize,
    quantizeBeats: d.quantizeBeats,
    beatJumpBeats: d.beatJumpBeats,
    vinylMode: d.vinylMode,
    jogWeight: d.jogWeight,
    motorStartSec: d.motorStartSec,
    motorStopSec: d.motorStopSec,
  };
}

/** Only the fields that differ (for minimal worklet messages). */
export function diffSettings(prev: DeckSettings | null, next: DeckSettings): Partial<DeckSettings> {
  if (!prev) return next;
  const out: Partial<DeckSettings> = {};
  for (const k of Object.keys(next) as Array<keyof DeckSettings>) {
    if (prev[k] !== next[k]) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}
