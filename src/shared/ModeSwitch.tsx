'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { browserStorage, MODE_ROUTES, otherMode, writeMode, type Mode } from './mode';
import { NoteIcon, WaveIcon } from './ModeIcons';
import styles from './modeSwitch.module.css';

/** Declares which mode the current page is, and jumps to the other experience. */
export default function ModeSwitch({ current }: { current: Mode }) {
  const router = useRouter();
  useEffect(() => {
    writeMode(browserStorage(), current);
  }, [current]);
  const next = otherMode(current);
  return (
    <button
      type="button"
      data-testid="mode-switch"
      className={styles.switch}
      aria-label={next === 'dark' ? 'Switch to dark mode (DJ booth)' : 'Switch to light mode (surf game)'}
      onClick={() => {
        writeMode(browserStorage(), next);
        router.push(MODE_ROUTES[next]);
      }}
    >
      {next === 'dark' ? <NoteIcon className={styles.note} /> : <WaveIcon className={styles.wave} />}
    </button>
  );
}
