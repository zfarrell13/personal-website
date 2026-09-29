'use client';
import { useEffect } from 'react';
import { useDjStore } from './store/djStore';
import styles from './ui/booth.module.css';

/** VIEW / SETTINGS buttons, Tab = switch view, Shift = SHIFT, and the notice toast. No other shortcuts (spec). */
export function Hud() {
  const view = useDjStore((s) => s.ui.view);
  const notice = useDjStore((s) => s.ui.notice);
  const settingsOpen = useDjStore((s) => s.ui.settingsOpen);
  const setUi = useDjStore((s) => s.setUi);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const v = useDjStore.getState().ui.view;
        useDjStore.getState().setUi({ view: v === 'closeup' ? 'room' : 'closeup' });
      } else if (e.key === 'Shift') {
        useDjStore.getState().setUi({ shift: true });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') useDjStore.getState().setUi({ shift: false });
    };
    const blur = () => useDjStore.getState().setUi({ shift: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <>
      <div className={styles.hud}>
        <button type="button" className={styles.hudBtn} onClick={() => setUi({ view: view === 'closeup' ? 'room' : 'closeup' })} data-testid="view-toggle">
          VIEW: {view === 'closeup' ? 'BOOTH' : 'ROOM'}
        </button>
        <button type="button" className={styles.hudBtn} onClick={() => setUi({ settingsOpen: !settingsOpen })} data-testid="settings-toggle">
          SETTINGS
        </button>
      </div>
      {notice ? (
        <button type="button" className={styles.notice} onClick={() => setUi({ notice: null })}>
          {notice} ✕
        </button>
      ) : null}
    </>
  );
}
