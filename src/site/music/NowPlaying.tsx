'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { getMusicPlayer } from './MusicPlayer';
import { useMusic } from './useMusic';
import styles from './music.module.css';

// U+FE0E asks for the text (monochrome) glyph rather than the colour emoji.
const SPEAKER_ON = '\u{1F50A}︎';
const SPEAKER_OFF = '\u{1F507}︎';

/** Fixed retro tag: what's playing, SKIP and MUTE. Before the first gesture it invites one. */
export function NowPlaying() {
  const { track, muted, trackKey, unavailable } = useMusic();
  const skipRef = useRef<HTMLButtonElement>(null);
  // The prompt unmounts when a track starts (its own Enter, or the window keydown listener); if it had keyboard
  // focus, hand it to SKIP rather than dropping it on <body>. A tap leaves focus alone (no stray ring on SKIP).
  const focusSkip = useRef(false);

  useEffect(() => {
    if (track && focusSkip.current) {
      focusSkip.current = false;
      skipRef.current?.focus();
    }
  }, [track]);

  if (unavailable && !muted) return null;

  if (!track && !muted) {
    return (
      <Prompt
        onUnmountFocused={() => {
          focusSkip.current = true;
        }}
      />
    );
  }

  return (
    <div className={styles.tag} data-testid="now-playing" role="group" aria-label="Music">
      <span className={styles.live} aria-live="polite">
        <span key={trackKey} className={styles.track} data-testid="now-playing-track">
          {track ? (
            <>
              {/* Phones show ♪ instead of the label (room for the name); screen readers always get the label. */}
              <span className={styles.note} aria-hidden="true">
                {'♪ '}
              </span>
              <span className={`${styles.label} ${styles.playing}`}>NOW PLAYING</span>
              <span className={styles.sep}>{' · '}</span>
              <span className={styles.title}>{`${track.artist} — ${track.title}`}</span>
            </>
          ) : (
            <span className={styles.label}>MUSIC OFF</span>
          )}
        </span>
      </span>
      {track ? (
        <button ref={skipRef} type="button" className={styles.control} aria-label="Skip track" onClick={() => getMusicPlayer().skip()}>
          ▶▶
        </button>
      ) : null}
      <button
        type="button"
        className={styles.control}
        aria-label="Mute music"
        aria-pressed={muted}
        onClick={() => getMusicPlayer().setMuted(!muted)}
      >
        {muted ? SPEAKER_OFF : SPEAKER_ON}
      </button>
    </div>
  );
}

/** Focus that shows a ring (keyboard); a tap or click focuses without one. Unknown selector: assume keyboard. */
function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

function Prompt({ onUnmountFocused }: { onUnmountFocused: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const onUnmount = useRef(onUnmountFocused);
  onUnmount.current = onUnmountFocused;
  // Layout cleanup runs before React removes the node, while it still holds focus.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el && document.activeElement === el && keyboardFocused(el)) onUnmount.current();
    };
  }, []);
  return (
    <button ref={ref} type="button" className={`${styles.tag} ${styles.prompt}`} onClick={() => void getMusicPlayer().start()}>
      <span className={styles.label}>
        {'♪ '}
        <span className={styles.fine}>PRESS ANY KEY</span>
        <span className={styles.coarse}>TAP</span>
        {' FOR MUSIC'}
      </span>
    </button>
  );
}
