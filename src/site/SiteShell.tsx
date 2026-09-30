'use client';
import { useEffect } from 'react';
import { getMusicPlayer, type MusicState } from './music/MusicPlayer';
import { NowPlaying } from './music/NowPlaying';
import styles from './site.module.css';
import { Stage } from './Stage';

// pointerup as well as pointerdown: a touch pointerdown is not a user activation, so play() would be refused.
const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const;
const RESUME_GESTURES = ['pointerdown', 'pointerup'] as const;

/** Music is waiting on a gesture: not playing, not muted by choice, and there is something to play. */
const wantsGesture = (s: MusicState) => !s.playing && !s.muted && !s.unavailable;

/** Client wrapper around every page: the surf stage behind it, the global NOW PLAYING tag and the first-gesture music start. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const player = getMusicPlayer();
    void player.prefetch(); // so the first gesture can call play() synchronously (WebKit)

    // start() is idempotent (later calls retry a blocked play()), so listen while music is waiting on a gesture.
    const onGesture = () => void player.start();
    let armed = false;
    const arm = (on: boolean) => {
      if (on === armed) return;
      armed = on;
      for (const t of GESTURES) {
        if (on) window.addEventListener(t, onGesture, { capture: true, passive: true });
        else window.removeEventListener(t, onGesture, true);
      }
    };

    // Cheap re-arm after an interruption (iOS call, backgrounding) even while the state still says playing.
    const onResume = () => player.resume();
    const onVisible = () => {
      if (document.visibilityState === 'visible') player.resume();
    };
    for (const t of RESUME_GESTURES) window.addEventListener(t, onResume, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisible);

    const unsubscribe = player.subscribe((s) => arm(wantsGesture(s)));
    arm(wantsGesture(player.getState()));
    return () => {
      unsubscribe();
      arm(false);
      for (const t of RESUME_GESTURES) window.removeEventListener(t, onResume, true);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <>
      <Stage />
      <div className={styles.page}>{children}</div>
      <NowPlaying />
    </>
  );
}
