/**
 * The step-by-step DJ guide, as pure logic: which step the player is on, what to tell them and which
 * controls to light up. Everything is derived from the DJ store (+ the engine telemetry for play
 * state and beat phase); nothing here touches the DOM or the engine.
 */
import type { CurveKind, DeckId, XfAssign } from '../constants';
import { crossfaderGains } from '../engine/mixer/MixerCore';
import { audibleBeat, type EngineTelemetry } from '../engine/telemetry';
import type { DjData } from '../store/djStore';
import { effectiveTempoPct } from '../store/tempoLogic';

/** 1–6 = the steps, 7 = the "Mix complete!" card. */
export type GuideStepNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const STEP_COUNT = 6;

export const BPM_TOLERANCE = 0.1;
/** Half a 16th at 174 BPM is ~43 ms; 20 ms is a tight, audible-lock beatmatch. */
export const OFFSET_TOLERANCE_MS = 20;
export const HOLD_SEC = 2;
export const FADER_UP = 0.7;
/** A channel counts as out below this fader position or crossfader gain. */
const OUT_LEVEL = 0.05;

export interface GuideDeckInput {
  loaded: boolean;
  loading: boolean;
  browseOpen: boolean;
  playing: boolean;
  /** Effective BPM (track BPM × tempo). */
  bpm: number;
  sync: boolean;
}

export interface GuideChannelInput {
  fader: number;
  xf: XfAssign;
  cue: boolean;
}

export interface GuideInput {
  decks: [GuideDeckInput, GuideDeckInput];
  ch: [GuideChannelInput, GuideChannelInput];
  crossfader: number;
  xfCurve: CurveKind;
  /** Deck 2's beat phase relative to deck 1 in ms (+ = deck 2 ahead); null unless both decks play. */
  offsetMs: number | null;
  /** How long the decks have been held beat-matched (filled in by GuideTracker). */
  alignedSec: number;
  /** Step 5 achieved (latched by GuideTracker). */
  beatmatched: boolean;
}

export interface GuideView {
  step: GuideStepNo;
  done: boolean;
  title: string;
  hint: string;
  /** data-testids of the controls to highlight. */
  targets: string[];
  /** Phone layout panel that holds the control to use now (0 = deck 1, 1 = mixer, 2 = deck 2). */
  panel: 0 | 1 | 2;
  /** Step 4: both BPMs (one decimal) and which way to move deck 2's tempo fader. */
  bpm?: { deck1: string; deck2: string; dir: 'up' | 'down' | null };
  /** Step 5: live beat offset and which way to nudge deck 2. */
  offset?: { ms: number; dir: 'forward' | 'back' | null };
  /** Step 5: progress of the 2 s hold, 0..1. */
  hold?: number;
}

export const STEP_TITLES: Record<GuideStepNo, string> = {
  1: 'LOAD A SONG ON DECK 1',
  2: 'PLAY DECK 1',
  3: 'LOAD A SONG ON DECK 2',
  4: 'MATCH THE BPM',
  5: 'BEATMATCH',
  6: 'FADE IN DECK 2',
  7: 'MIX COMPLETE!',
};

const tempoMatched = (i: GuideInput) => i.decks[0].loaded && i.decks[1].loaded && Math.abs(i.decks[1].bpm - i.decks[0].bpm) <= BPM_TOLERANCE + 1e-9;

/** Gain a channel gets from the crossfader, honouring its XF assign (THRU bypasses the crossfader). */
function xfGain(i: GuideInput, ch: DeckId): number {
  const assign = i.ch[ch].xf;
  if (assign === 'THRU') return 1;
  const [a, b] = crossfaderGains(i.crossfader, i.xfCurve);
  return assign === 'A' ? a : b;
}

const ch2Audible = (i: GuideInput) => i.decks[1].playing && i.ch[1].fader >= FADER_UP && xfGain(i, 1) >= 0.5;
const ch1Out = (i: GuideInput) => i.ch[0].fader <= OUT_LEVEL || xfGain(i, 0) <= OUT_LEVEL;

/** Both decks playing at the same tempo with the kicks on top of each other (or held together by SYNC). */
export function isAligned(i: GuideInput): boolean {
  if (!i.decks[0].playing || !i.decks[1].playing || !tempoMatched(i)) return false;
  return i.decks[1].sync || (i.offsetMs !== null && Math.abs(i.offsetMs) <= OFFSET_TOLERANCE_MS);
}

/** Completion of steps 1–6 (index 0 = step 1). */
export function stepsComplete(i: GuideInput): boolean[] {
  const [d1, d2] = i.decks;
  return [d1.loaded, d1.loaded && d1.playing, d2.loaded, tempoMatched(i), i.beatmatched, ch2Audible(i) && ch1Out(i)];
}

/** The first step not yet done (7 when all are). */
export function firstIncomplete(complete: readonly boolean[]): GuideStepNo {
  const k = complete.findIndex((c) => !c);
  return (k === -1 ? 7 : k + 1) as GuideStepNo;
}

/** Deck 2's beat phase relative to deck 1, wrapped to the nearest beat, in ms at `bpm` (+ = deck 2 ahead). */
export function phaseOffsetMs(beat1: number, beat2: number, bpm: number): number {
  const d = beat2 - beat1;
  const frac = d - Math.round(d);
  return bpm > 0 ? (frac * 60000) / bpm : 0;
}

const loadHint = (d: GuideDeckInput, n: 1 | 2, where: string) =>
  d.loading ? `Loading the song onto deck ${n}…` : d.browseOpen ? `Tap a song in the list to load it onto deck ${n}.` : `Press BROWSE on deck ${n} (${where}), then tap a song.`;

type Detail = Omit<GuideView, 'step' | 'done' | 'title'>;

function stepDetail(i: GuideInput, step: GuideStepNo): Detail {
  const [d1, d2] = i.decks;
  switch (step) {
    case 1:
      return { hint: loadHint(d1, 1, 'top left of the left player'), targets: d1.browseOpen || d1.loading ? [] : ['browse-0'], panel: 0 };
    case 2: {
      if (!d1.loaded) return { hint: 'Load a song on deck 1 first (step 1).', targets: ['browse-0'], panel: 0 };
      const faderDown = i.ch[0].fader < 0.5;
      return {
        hint: `Press PLAY (▶︎/❚❚) on deck 1.${faderDown ? ' Raise CH 1’s fader on the mixer to hear it.' : ''}`,
        targets: faderDown ? ['play-0', 'fader-ch-0'] : ['play-0'],
        panel: 0,
      };
    }
    case 3:
      return { hint: `${loadHint(d2, 2, 'top left of the right player')} Try a different BPM.`, targets: d2.browseOpen || d2.loading ? [] : ['browse-1'], panel: 2 };
    case 4: {
      if (!d1.loaded || !d2.loaded) return { hint: 'Load a song on both decks first.', targets: [], panel: d1.loaded ? 2 : 0 };
      const diff = d2.bpm - d1.bpm;
      const dir = Math.abs(diff) <= BPM_TOLERANCE + 1e-9 ? null : diff < 0 ? 'down' : 'up';
      const hint =
        dir === null
          ? 'BPMs match!'
          : `Slide deck 2’s TEMPO fader ${dir === 'down' ? 'DOWN (towards +)' : 'UP (towards −)'} until both read the same. Arrow keys + Shift = fine steps.`;
      return { hint, targets: ['tempo-fader-1'], panel: 2, bpm: { deck1: d1.bpm.toFixed(1), deck2: d2.bpm.toFixed(1), dir } };
    }
    case 5: {
      if (!d1.playing) return { hint: 'Deck 1 has to be playing: press PLAY on deck 1.', targets: ['play-0'], panel: 0 };
      if (!d2.playing) {
        const cue = i.ch[1].cue;
        return {
          hint: `${cue ? '' : 'Press CUE on CH 2 to hear deck 2 in your headphones. '}Press PLAY on deck 2 right on a kick of deck 1.`,
          targets: cue ? ['play-1'] : ['chcue-1', 'play-1'],
          panel: cue ? 2 : 1,
        };
      }
      if (!tempoMatched(i) && !d2.sync) return { hint: 'The tempos drifted apart: match the BPM again with deck 2’s TEMPO fader.', targets: ['tempo-fader-1'], panel: 2 };
      const ms = i.offsetMs ?? 0;
      const hold = Math.min(1, i.alignedSec / HOLD_SEC);
      if (isAligned(i)) {
        const how = d2.sync ? 'SYNC is holding the beats together' : 'Kicks lined up';
        return { hint: `${how}: hold it… ${i.alignedSec.toFixed(1)} / ${HOLD_SEC.toFixed(1)} s`, targets: ['jog-1'], panel: 2, offset: { ms, dir: null }, hold };
      }
      const dir = ms > 0 ? 'back' : 'forward';
      const hint =
        dir === 'back'
          ? 'Deck 2 is ahead: nudge BACK (turn jog 2’s outer ring anticlockwise). Shortcut: SYNC.'
          : 'Deck 2 is behind: nudge FORWARD (turn jog 2’s outer ring clockwise). Shortcut: SYNC.';
      return { hint, targets: ['jog-1'], panel: 2, offset: { ms, dir }, hold };
    }
    case 6: {
      if (!d2.playing) return { hint: 'Press PLAY on deck 2.', targets: ['play-1'], panel: 2 };
      if (i.ch[1].fader < FADER_UP) return { hint: 'Raise CH 2’s channel fader, smoothly, all the way up.', targets: ['fader-ch-1'], panel: 1 };
      if (i.ch[1].xf === 'A' && xfGain(i, 1) < 0.5) {
        return { hint: 'CH 2 is assigned to A on the crossfader: set its assign to B (or slide the crossfader towards A).', targets: ['xf-assign-1', 'crossfader'], panel: 1 };
      }
      if (!ch1Out(i) || xfGain(i, 1) < 0.5) {
        if (i.ch[0].xf === 'A') return { hint: 'Now sweep the CROSSFADER from A (left) to B (right) to fade deck 1 out.', targets: ['crossfader'], panel: 1 };
        const targets = ['xf-assign-0', ...(i.ch[1].xf !== 'B' ? ['xf-assign-1'] : []), 'fader-ch-0'];
        return { hint: 'Set the assign buttons under the faders to CH 1 → A and CH 2 → B, then sweep the CROSSFADER to B. (Or just pull CH 1’s fader down.)', targets, panel: 1 };
      }
      return { hint: 'Deck 2 is on the air!', targets: [], panel: 1 };
    }
    case 7:
      return { hint: 'Deck 2 is on the air: that’s a mix. Load the next song on deck 1 and do it again!', targets: [], panel: 1 };
  }
}

/** The view for `shown` (default: the first incomplete step). */
export function guideStep(i: GuideInput, shown: GuideStepNo = firstIncomplete(stepsComplete(i))): GuideView {
  return { step: shown, done: shown === 7, title: STEP_TITLES[shown], ...stepDetail(i, shown) };
}

/** Builds the guide input from the store (+ telemetry for play state and the audible beat phase). */
export function readGuideInput(s: DjData, tel: EngineTelemetry, nowFrame: number, trackBpm: (id: string | null) => number): GuideInput {
  const deck = (d: DeckId): GuideDeckInput => {
    const st = s.decks[d];
    return {
      loaded: st.trackId !== null && !st.loading,
      loading: st.loading,
      browseOpen: st.browseOpen,
      playing: tel.decks[d].loaded && tel.decks[d].state === 'PLAYING',
      bpm: trackBpm(st.trackId) * (1 + effectiveTempoPct(st) / 100),
      sync: st.sync,
    };
  };
  const decks: [GuideDeckInput, GuideDeckInput] = [deck(0), deck(1)];
  const both = decks[0].playing && decks[1].playing;
  const ch = (c: DeckId): GuideChannelInput => ({ fader: s.mixer.ch[c].fader, xf: s.mixer.ch[c].xf, cue: s.mixer.ch[c].cue });
  return {
    decks,
    ch: [ch(0), ch(1)],
    crossfader: s.mixer.crossfader,
    xfCurve: s.mixer.xfCurve,
    offsetMs: both ? phaseOffsetMs(audibleBeat(tel, 0, nowFrame), audibleBeat(tel, 1, nowFrame), decks[0].bpm) : null,
    alignedSec: 0,
    beatmatched: false,
  };
}

/**
 * The guide's memory between frames: the 2 s beatmatch hold, the beatmatch latch and Back/Skip.
 * A step picked with Back/Skip stays shown until the player presses Back/Skip again, or until it
 * gets done while shown (then the guide moves to the next step still to do).
 */
export class GuideTracker {
  private alignedSince: number | null = null;
  private beatmatched = false;
  private override: GuideStepNo | null = null;
  private prev: boolean[] = new Array<boolean>(STEP_COUNT).fill(false);
  private shown: GuideStepNo = 1;

  update(raw: GuideInput, nowSec: number): GuideView {
    if (!raw.decks[0].loaded || !raw.decks[1].loaded) this.beatmatched = false;
    if (isAligned(raw)) this.alignedSince ??= nowSec;
    else this.alignedSince = null;
    const alignedSec = this.alignedSince === null ? 0 : nowSec - this.alignedSince;
    if (alignedSec >= HOLD_SEC) this.beatmatched = true;
    const i: GuideInput = { ...raw, alignedSec, beatmatched: this.beatmatched };
    const complete = stepsComplete(i);
    const auto = firstIncomplete(complete);
    const o = this.override;
    if (o !== null && o !== 7 && complete[o - 1] && !this.prev[o - 1]) {
      const next = complete.findIndex((c, k) => k >= o && !c);
      this.override = (next === -1 ? 7 : next + 1) as GuideStepNo;
    }
    if (this.override !== null && this.override !== 7 && this.override === auto) this.override = null;
    this.prev = complete;
    // Finishing sticks: the card stays even when the player stops deck 1 afterwards.
    if (this.override === null && auto === 7) this.override = 7;
    this.shown = this.override ?? auto;
    return guideStep(i, this.shown);
  }

  skip(): void {
    if (this.shown < STEP_COUNT) this.shown = this.override = (this.shown + 1) as GuideStepNo;
  }

  back(): void {
    if (this.shown > 1) this.shown = this.override = (this.shown - 1) as GuideStepNo;
  }

  /** Back to automatic navigation (reopening the guide). */
  restart(): void {
    this.override = null;
  }
}
