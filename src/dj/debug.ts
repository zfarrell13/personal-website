import type { DeckId } from './constants';
import type { AudioEngine } from './engine/AudioEngine';
import { audiblePosSec, deckBpm } from './engine/telemetry';
import type { FrameLoop } from './frameLoop';
import { useDjStore, type DjData } from './store/djStore';

export interface DjDebugDeck {
  loaded: boolean;
  trackId: string | null;
  state: string;
  posSec: number;
  bpm: number;
  synced: boolean;
}

/** `window.__dj` — read-only hooks for Playwright and manual debugging. */
export interface DjDebug {
  ready: boolean;
  mtAvailable: boolean;
  deck(d: DeckId): DjDebugDeck;
  master(): number;
  latencySec(): number;
  frames(): number;
  clubFrames: number;
  /** Fires a club drop now (set by ClubView once the club renders; visual checks only). */
  clubDrop?: () => void;
  state(): DjData;
}

declare global {
  interface Window {
    __dj?: DjDebug;
  }
}

export function installDebugHook(engine: AudioEngine, loop: FrameLoop): () => void {
  const t = engine.telemetry;
  const hook: DjDebug = {
    ready: true,
    mtAvailable: engine.mtAvailable,
    deck: (d) => ({
      loaded: t.decks[d].loaded,
      trackId: useDjStore.getState().decks[d].trackId,
      state: t.decks[d].state,
      posSec: audiblePosSec(t, d, engine.nowFrame()),
      // display BPM (base rate, never the PLL-trimmed rate)
      bpm: deckBpm(t.decks[d]),
      synced: t.decks[d].synced,
    }),
    master: () => t.master,
    latencySec: () => t.latencySec,
    frames: () => loop.frames,
    clubFrames: 0,
    state: () => useDjStore.getState(),
  };
  window.__dj = hook;
  return () => {
    if (window.__dj === hook) delete window.__dj;
  };
}
