'use client';
import { useStore } from 'zustand';
import { Meter } from '@/retro/ui/Meter';
import type { SurfStore } from '../state/store';
import styles from './surf.module.css';

export function Hud({ store }: { store: SurfStore }) {
  const score = useStore(store, (s) => s.score);
  const pot = useStore(store, (s) => s.pot);
  const multiplier = useStore(store, (s) => s.multiplier);
  const tubeTime = useStore(store, (s) => s.tubeTime);
  const speed = useStore(store, (s) => s.speedKmh);
  const ticker = useStore(store, (s) => s.ticker);
  const fast = useStore(store, (s) => s.fastSection);
  return (
    <div className={styles.layer} aria-live="off">
      <div className={styles.hudTop}>
        <div className={styles.score} data-testid="score">{score.toLocaleString('en-US')}</div>
        {pot > 0 ? (
          <div className={styles.combo} data-testid="combo">
            {pot.toLocaleString('en-US')} × {multiplier}
          </div>
        ) : null}
      </div>
      {tubeTime > 0 ? <div className={styles.tube}>TUBE {tubeTime.toFixed(1)}s</div> : null}
      {fast ? (
        <div className={styles.fast} data-testid="fast-section">
          ⚡ FAST SECTION
        </div>
      ) : null}
      <div className={styles.ticker}>
        {ticker.map((t) => (
          <div key={t.id} className={styles.trick} data-neg={t.points < 0 ? 'true' : 'false'}>
            {t.text} {t.points >= 0 ? `+${t.points}` : t.points}
          </div>
        ))}
      </div>
      <div className={styles.speed}>
        <span>{speed} KM/H</span>
        <Meter value={speed / 50} segments={14} label="Speed" />
      </div>
    </div>
  );
}
