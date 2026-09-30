'use client';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import type { SurfStore } from '../state/store';
import styles from './surf.module.css';

export function Underwater({ store }: { store: SurfStore }) {
  const on = useStore(store, (s) => s.underwater && s.phase === 'playing');
  return on ? <div className={styles.underwater} aria-hidden /> : null;
}

export function PauseMenu({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>('[data-primary="true"]')?.focus(), []);
  return (
    <div className={styles.center} ref={ref} role="dialog" aria-label="Paused">
      <Panel title="PAUSED">
        <div className={styles.row}>
          <RetroButton data-primary="true" onClick={onResume}>RESUME (ESC)</RetroButton>
          <RetroButton onClick={onQuit}>QUIT TO TITLE</RetroButton>
        </div>
      </Panel>
    </div>
  );
}
