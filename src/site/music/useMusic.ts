'use client';
import { useSyncExternalStore } from 'react';
import { getMusicPlayer, INITIAL_MUSIC_STATE, type MusicState } from './MusicPlayer';

// Resolved lazily so the server render never creates a player (it only ever sees INITIAL_MUSIC_STATE).
const subscribe = (listener: (s: MusicState) => void) => getMusicPlayer().subscribe(listener);
const getState = () => getMusicPlayer().getState();
const getServerState = () => INITIAL_MUSIC_STATE;

/** The global player's state; re-renders on every change. */
export function useMusic(): MusicState {
  return useSyncExternalStore(subscribe, getState, getServerState);
}
