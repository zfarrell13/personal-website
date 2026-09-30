'use client';
import { getMusicPlayer } from './MusicPlayer';
import { useMusic } from './useMusic';
import styles from './music.module.css';

// U+FE0E asks for the text (monochrome) glyph rather than the colour emoji.
const SPEAKER_ON = '\u{1F50A}︎';
const SPEAKER_OFF = '\u{1F507}︎';

/** Fixed retro tag: what's playing, SKIP and MUTE. Before the first gesture it invites one. */
export function NowPlaying() {
  const { track, muted, trackKey } = useMusic();

  if (!track && !muted) {
    return (
      <button type="button" className={`${styles.tag} ${styles.prompt}`} onClick={() => void getMusicPlayer().start()}>
        <span className={styles.label}>♪ PRESS ANY KEY FOR MUSIC</span>
      </button>
    );
  }

  return (
    <div className={styles.tag} data-testid="now-playing" role="group" aria-label="Music">
      <span key={trackKey} className={styles.track} data-testid="now-playing-track" aria-live="polite">
        {track ? (
          <>
            <span className={styles.label}>NOW PLAYING</span>
            {' · '}
            <span className={styles.title}>{`${track.artist} — ${track.title}`}</span>
          </>
        ) : (
          <span className={styles.label}>MUSIC OFF</span>
        )}
      </span>
      {track ? (
        <button type="button" className={styles.control} aria-label="Skip track" onClick={() => getMusicPlayer().skip()}>
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
