'use client';
import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { browserStorage } from '@/shared/mode';
import type { Side } from '../config';
import { loadHighScores } from '../scoring/highScores';
import { HighScoreTable } from './HighScoreTable';
import styles from './surf.module.css';

export function TitleMenu({ initialSide, onStart }: { initialSide: Side; onStart: (side: Side) => void }) {
  const [side, setSide] = useState<Side>(initialSide);
  const scores = useMemo(() => loadHighScores(browserStorage()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setSide('left');
      else if (e.key === 'ArrowRight') setSide('right');
      else if (e.key === 'Enter') {
        e.preventDefault();
        onStart(side);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [side, onStart]);

  return (
    <div className={styles.center}>
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
        <RetroButton onClick={() => onStart(side)}>DROP IN</RetroButton>
        <p className={styles.legend}>
          ← → carve · ↑ pump · ↓ stall · SPACE ollie · air: ← → spin, W A S D grabs · ESC pause
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
