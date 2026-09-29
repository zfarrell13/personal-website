import type { TrackEntry } from '@/shared/tracks';
import { HOT_CUE_COLORS, TEMPO_RANGES, type DeckId, type TempoRange } from './constants';
import type { AudioEngine } from './engine/AudioEngine';
import type { DeckEvent } from './engine/core/DeckCore';
import { useDjStore } from './store/djStore';
import { loadHotCues, saveHotCues } from './store/hotcueStorage';
import { trackSyncedTempo, type SyncContext } from './store/tempoLogic';
import { isOnAir, loadDecision } from './ui/browse/browseLogic';

export type LoadResult = 'loading' | 'confirm' | 'missing';

export interface DjActions {
  play(d: DeckId): void;
  cue(d: DeckId, down: boolean): void;
  hotCue(d: DeckId, index: number, down: boolean): void;
  call(d: DeckId, dir: -1 | 1): void;
  loopIn(d: DeckId): void;
  loopOut(d: DeckId): void;
  reloop(d: DeckId): void;
  autoLoop(d: DeckId, beats: number): void;
  loopScale(d: DeckId, factor: 0.5 | 2): void;
  beatJump(d: DeckId, dir: -1 | 1): void;
  seek(d: DeckId, sec: number): void;
  jog(d: DeckId, touch: boolean, revPerSec: number, ring: boolean): void;
  /** BEAT SYNC: on → match the master now (range → WIDE if needed); off → back to the user's range, fader at the current tempo. */
  toggleSync(d: DeckId): void;
  setMaster(d: DeckId): void;
  tempoFader(d: DeckId, fader: number): void;
  /** TEMPO RANGE: next range; an unsynced deck's tempo follows the fader under the new range. */
  cycleRange(d: DeckId): void;
  /** TEMPO RESET: on a synced follower it also turns SYNC off (CDJ behaviour). */
  toggleTempoReset(d: DeckId): void;
  /** Re-aligns synced followers with the current master (call when the engine reports a master change). */
  retrackSync(): void;
  requestLoad(d: DeckId, trackId: string): LoadResult;
  setHeadphoneDevice(sinkId: string | null): Promise<void>;
  /** Called by the engine for worklet events (hot cue stored/cleared, cue moved, end). */
  handleDeckEvent(d: DeckId, e: DeckEvent): void;
}

type Store = typeof useDjStore;

export interface ActionDeps {
  engine: AudioEngine;
  tracks: TrackEntry[];
  store?: Store;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Composite + momentary actions. Control positions live in the store; momentary presses go straight to the engine. */
export function createDjActions({ engine, tracks, store = useDjStore, storage = null }: ActionDeps): DjActions {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const loadTokens: [number, number] = [0, 0];
  /** The range each deck had when SYNC went on (restored when SYNC goes off, undoing a WIDE promotion). */
  const userRange: [TempoRange | null, TempoRange | null] = [null, null];
  const tel = engine.telemetry;

  const syncCtx = (master: DeckId | -1 = tel.master): SyncContext => {
    const s = store.getState();
    const bpm = (d: DeckId) => byId.get(s.decks[d].trackId ?? '')?.bpm ?? 0;
    return { master, trackBpm: [bpm(0), bpm(1)] };
  };

  /** Puts every synced follower on the master's tempo (telemetry lags a MASTER press, so it can be passed in). */
  const retrack = (master: DeckId | -1 = tel.master) => {
    const decks = store.getState().decks;
    const next = trackSyncedTempo(decks, syncCtx(master));
    if (next[0] !== decks[0] || next[1] !== decks[1]) store.setState({ decks: next });
  };

  const isFollower = (d: DeckId) => store.getState().decks[d].sync && tel.master !== -1 && tel.master !== d;

  const syncOff = (d: DeckId) => {
    const deck = store.getState().decks[d];
    const saved = userRange[d];
    userRange[d] = null;
    // Undo a WIDE promotion only when the current tempo fits the user's range (no audible jump).
    const range = saved !== null && deck.range === 100 && Math.abs(deck.tempoPct) <= saved ? saved : deck.range;
    // Keep the exact synced tempo (re-quantizing could jump up to half a grid step and drift);
    // the fader sits at that tempo and the next fader touch returns to the range's grid.
    const tempoPct = Math.max(-range, Math.min(range, deck.tempoPct));
    store.getState().setDeck(d, { sync: false, range, tempoPct, tempoFader: tempoPct / range, tempoHeld: true });
  };

  const actions: DjActions = {
    play: (d) => engine.command({ t: 'play', deck: d }),
    cue: (d, down) => engine.command({ t: 'cue', deck: d, down }),
    hotCue: (d, index, down) => engine.command({ t: 'hotcue', deck: d, index, down, shift: store.getState().ui.shift }),
    call: (d, dir) => engine.command({ t: 'call', deck: d, dir }),
    loopIn: (d) => engine.command({ t: 'loopIn', deck: d }),
    loopOut: (d) => engine.command({ t: 'loopOut', deck: d }),
    reloop: (d) => engine.command({ t: 'reloop', deck: d }),
    autoLoop: (d, beats) => engine.command({ t: 'autoLoop', deck: d, beats }),
    loopScale: (d, factor) => engine.command({ t: 'loopScale', deck: d, factor }),
    beatJump: (d, dir) => engine.command({ t: 'beatJump', deck: d, dir }),
    seek: (d, sec) => engine.command({ t: 'seek', deck: d, sec }),
    jog: (d, touch, revPerSec, ring) => engine.command({ t: 'jog', deck: d, touch, revPerSec, ring }),

    toggleSync(d) {
      const deck = store.getState().decks[d];
      if (deck.sync) {
        syncOff(d);
        return;
      }
      userRange[d] = deck.range;
      store.getState().setDeck(d, { sync: true });
      retrack();
    },

    setMaster(d) {
      engine.command({ t: 'master', deck: d });
      retrack(d);
    },

    tempoFader: (d, fader) => store.getState().setTempoFader(d, fader, syncCtx()),

    cycleRange(d) {
      const deck = store.getState().decks[d];
      const next = (r: TempoRange) => TEMPO_RANGES[(TEMPO_RANGES.indexOf(r) + 1) % TEMPO_RANGES.length]!;
      if (isFollower(d)) {
        // Cycle the user's own range, not a WIDE promotion (100 → 6 → promoted back to 100 would look dead);
        // SYNC promotes it again only when the master's tempo doesn't fit.
        const range = next(userRange[d] ?? deck.range);
        userRange[d] = range;
        store.getState().setDeck(d, { range });
      } else {
        const range = next(deck.range);
        store.getState().setDeck(d, { range, tempoPct: deck.tempoFader * range, tempoHeld: false });
      }
      retrack();
    },

    toggleTempoReset(d) {
      const on = !store.getState().decks[d].tempoReset;
      if (on && isFollower(d)) syncOff(d);
      store.getState().setDeck(d, { tempoReset: on });
      retrack();
    },

    retrackSync: () => retrack(),

    requestLoad(d, trackId) {
      const t = byId.get(trackId);
      if (!t) return 'missing';
      const s = store.getState();
      const onAir = isOnAir(d, tel.decks[d], s.mixer);
      if (loadDecision(onAir, s.decks[d].pendingLoad, trackId) === 'confirm') {
        store.getState().setDeck(d, { pendingLoad: trackId });
        return 'confirm';
      }
      const token = ++loadTokens[d];
      const hotCues = loadHotCues(storage, trackId);
      store.getState().setDeck(d, { trackId, loading: true, pendingLoad: null, browseOpen: false, hotCues, waveform: null, overview: null });
      retrack(); // a new track BPM changes what a synced follower needs
      engine.loader
        .waveforms(t)
        .then((w) => {
          if (loadTokens[d] === token) store.getState().setDeck(d, { waveform: w.detail, overview: w.overview });
        })
        .catch((err: unknown) => console.warn('waveform load failed', err));
      engine.loader
        .decode(t)
        .then((buffer) => {
          if (loadTokens[d] !== token) return;
          engine.loadTrack(d, t, buffer, hotCues.map((h) => (h ? h.sec : null)));
          store.getState().setDeck(d, { loading: false });
        })
        .catch((err: unknown) => {
          if (loadTokens[d] !== token) return;
          store.getState().setDeck(d, { loading: false, trackId: null });
          store.getState().setUi({ notice: `Could not load "${t.title}": ${String(err)}` });
        });
      return 'loading';
    },

    async setHeadphoneDevice(sinkId) {
      const ok = await engine.mixer.setHeadphoneDevice(sinkId);
      store.getState().setUi({
        sinkId: ok ? sinkId : null,
        notice: ok ? null : 'That output device could not be used. Headphones fall back to SPLIT mode.',
      });
    },

    handleDeckEvent(d, e) {
      const s = store.getState();
      const trackId = s.decks[d].trackId;
      if (e.kind === 'hotcue' && trackId) {
        const hotCues = [...s.decks[d].hotCues];
        hotCues[e.index] = e.sec === null ? null : { sec: e.sec, color: HOT_CUE_COLORS[e.index] ?? '#28e214' };
        store.getState().setDeck(d, { hotCues });
        saveHotCues(storage, trackId, hotCues);
      }
    },
  };
  return actions;
}
