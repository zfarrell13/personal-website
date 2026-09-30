'use client';
import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MODE_ROUTES, otherMode, type Mode } from '@/shared/mode';
import { useMode } from '@/shared/useMode';
import styles from './portal.module.css';

const SHAPES = Array.from({ length: 10 }, (_, i) => i);

export default function Portal() {
  const router = useRouter();
  const { mode, setMode } = useMode();

  const start = useCallback(() => {
    if (mode) router.push(MODE_ROUTES[mode]);
  }, [mode, router]);

  const toggle = useCallback(() => {
    if (mode) setMode(otherMode(mode));
  }, [mode, setMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        start();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, toggle]);

  const current: Mode = mode ?? 'light';

  return (
    <main className={styles.portal} data-mode={current} data-ready={mode !== null ? 'true' : 'false'}>
      <div className={styles.day} aria-hidden />
      <div className={styles.night} aria-hidden />
      <div className={styles.shapes} aria-hidden>
        {SHAPES.map((i) => (
          <span key={i} className={styles.shape} style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>
      <section className={styles.center}>
        <h1 className={styles.title}>ZACH FARRELL</h1>
        <button
          type="button"
          role="switch"
          aria-checked={current === 'dark'}
          aria-label="Dark mode"
          className={styles.toggle}
          onClick={toggle}
        >
          <span className={styles.knob} aria-hidden />
          <svg className={styles.wave} viewBox="0 0 32 32" aria-hidden>
            <path d="M3 22c3 0 4-3 7-3s4 3 7 3 4-3 7-3 4 3 5 3" />
            <path d="M5 17c0-7 6-12 13-11-4 2-5 6-3 9 1.5 2.2 4.5 2.4 6 1" />
          </svg>
          <svg className={styles.note} viewBox="0 0 32 32" aria-hidden>
            <path d="M12 23V7l14-3v16" />
            <circle cx="8.5" cy="23.5" r="3.5" />
            <circle cx="22.5" cy="20.5" r="3.5" />
          </svg>
        </button>
        <p className={styles.caption} data-testid="mode-caption">
          {current === 'light' ? 'LIGHT MODE — SURF' : 'DARK MODE — DJ'}
        </p>
        <button type="button" className={styles.start} onClick={start}>
          PRESS START
        </button>
        <p className={styles.hint}>← → switch · ENTER start</p>
      </section>
    </main>
  );
}
