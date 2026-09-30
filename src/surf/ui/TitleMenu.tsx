'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { browserStorage } from '@/shared/mode';
import type { Side } from '../config';
import { loadHighScores } from '../scoring/highScores';
import { HighScoreTable } from './HighScoreTable';
import { otherButtonFocused } from './menuFocus';
import styles from './surf.module.css';

export function TitleMenu({ initialSide, onStart }: { initialSide: Side; onStart: (side: Side) => void }) {
  const [side, setSide] = useState<Side>(initialSide);
  const rootRef = useRef<HTMLDivElement>(null);
  const scores = useMemo(() => loadHighScores(browserStorage()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setSide('left');
      else if (e.key === 'ArrowRight') setSide('right');
      else if (e.key === 'Enter') {
        if (e.repeat || otherButtonFocused(rootRef.current)) return;
        e.preventDefault();
        onStart(side);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [side, onStart]);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-primary="true"]')?.focus();
  }, []);

  return (
    <div className={styles.center} ref={rootRef} role="dialog" aria-label="ZF Pro Surfer title menu">
      <div className={styles.menu}>
        <h1 className={styles.title}>ZF PRO SURFER</h1>
        <Panel title="SELECT BREAK">
          <div className={styles.row}>
            <RetroButton active={side === 'left'} aria-pressed={side === 'left'} onClick={() => setSide('left')}>
              LEFT
            </RetroButton>
            <RetroButton active={side === 'right'} aria-pressed={side === 'right'} onClick={() => setSide('right')}>
              RIGHT
            </RetroButton>
          </div>
        </Panel>
        <RetroButton data-primary="true" onClick={() => onStart(side)}>DROP IN</RetroButton>
        <p className={styles.legend}>
          ← → carve (hold at the lip to snap, let go at the lip to launch) · ↑ pump · ↓ stall · SPACE ollie · air: ← → spin, W A S D grabs · ESC pause
        </p>
        {scores.length > 0 ? (
          <Panel title="TOP 10">
            <HighScoreTable scores={scores} highlight={-1} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
