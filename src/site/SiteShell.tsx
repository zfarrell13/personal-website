'use client';
import { useEffect } from 'react';
import { getMusicPlayer } from './music/MusicPlayer';
import { NowPlaying } from './music/NowPlaying';

// pointerup as well as pointerdown: a touch pointerdown is not a user activation, so play() would be refused.
const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const;

/** Client wrapper around every page: the global NOW PLAYING tag and the first-gesture music start. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const player = getMusicPlayer();
    if (process.env.NODE_ENV !== 'production') (window as Window & { __music?: unknown }).__music = player;
    const onGesture = () => void player.start();
    const stop = () => {
      GESTURES.forEach((t) => window.removeEventListener(t, onGesture, true));
      unsubscribe();
    };
    // start() is idempotent and retries a blocked play(), so keep listening until music actually plays.
    const unsubscribe = player.subscribe((s) => {
      if (s.playing) stop();
    });
    if (player.getState().playing) stop();
    else GESTURES.forEach((t) => window.addEventListener(t, onGesture, { capture: true, passive: true }));
    return stop;
  }, []);

  return (
    <>
      {children}
      <NowPlaying />
    </>
  );
}
