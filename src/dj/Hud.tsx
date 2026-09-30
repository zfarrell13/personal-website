'use client';
import { useEffect } from 'react';
import { useDjStore } from './store/djStore';
import styles from './ui/booth.module.css';

/** VIEW / SETTINGS / GUIDE buttons, Tab = switch view, Shift = SHIFT, and the notice toast. No other shortcuts (spec). */
export function Hud() {
  const view = useDjStore((s) => s.ui.view);
  const notice = useDjStore((s) => s.ui.notice);
  const settingsOpen = useDjStore((s) => s.ui.settingsOpen);
  // In the room view the guide is hidden: GUIDE then brings it back with the booth.
  const guideShown = useDjStore((s) => s.ui.guideOpen && s.ui.view === 'closeup');
  const setUi = useDjStore((s) => s.setUi);

  useEffect(() => {
    // SHIFT is written only when it changes (held Shift auto-repeats keydown ~30×/s).
    const setShift = (on: boolean) => {
      if (useDjStore.getState().ui.shift !== on) useDjStore.getState().setUi({ shift: on });
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Inside a form control (Settings) Tab keeps moving focus, so the dialog stays keyboard-usable.
        if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
        e.preventDefault();
        const v = useDjStore.getState().ui.view;
        useDjStore.getState().setUi({ view: v === 'closeup' ? 'room' : 'closeup' });
      } else if (e.key === 'Shift' && !e.repeat) {
        setShift(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
    };
    const blur = () => setShift(false);
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
        <button
          type="button"
          className={styles.hudBtn}
          aria-pressed={guideShown}
          onClick={() => setUi(guideShown ? { guideOpen: false } : { guideOpen: true, view: 'closeup' })}
          data-testid="guide-toggle"
        >
          GUIDE
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
