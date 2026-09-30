'use client';
import { OFFSET_TOLERANCE_MS, STEP_COUNT, type GuideView } from './guideLogic';
import styles from './guide.module.css';

const PANEL_NAMES = ['DECK 1', 'MIXER', 'DECK 2'] as const;
/** The offset meter spans ±METER_MS. */
const METER_MS = 100;

export interface GuidePanelProps {
  view: GuideView;
  onBack: () => void;
  onSkip: () => void;
  onClose: () => void;
  /** Phone layout: the panel that holds the control, when it is not the one showing. */
  goPanel?: 0 | 1 | 2 | null;
  onGoPanel?: (p: 0 | 1 | 2) => void;
}

function OffsetMeter({ ms, dir }: { ms: number; dir: 'forward' | 'back' | null }) {
  const at = 50 + (Math.max(-METER_MS, Math.min(METER_MS, ms)) / METER_MS) * 50;
  const zone = (OFFSET_TOLERANCE_MS / METER_MS) * 100;
  const r = Math.round(ms);
  return (
    <span className={styles.meterWrap} data-testid="guide-offset">
      <span className={styles.meter} role="img" aria-label={`Beat offset ${r} ms`}>
        <span className={styles.zone} style={{ left: `${50 - zone / 2}%`, width: `${zone}%` }} />
        <span className={styles.mark} data-ok={dir === null} style={{ left: `${at}%` }} />
      </span>
      <span className={styles.ms} data-ok={dir === null}>
        {r > 0 ? '+' : ''}
        {r} ms {dir === null ? 'LOCKED' : dir === 'back' ? 'NUDGE BACK ◀' : 'NUDGE FWD ▶'}
      </span>
    </span>
  );
}

/** The docked step card: step n/6, what to do, live BPM / beat-offset readouts, BACK · SKIP · ✕. */
export function GuidePanel({ view, onBack, onSkip, onClose, goPanel = null, onGoPanel }: GuidePanelProps) {
  const { step, done, bpm, offset } = view;
  return (
    <div className={styles.guide} role="region" aria-label="DJ guide" data-testid="guide" data-step={step}>
      <div className={styles.head}>
        <span className={styles.badge} data-done={done}>
          {done ? '✓' : `${step}/${STEP_COUNT}`}
        </span>
        <span className={styles.title}>{view.title}</span>
        {goPanel !== null ? (
          <button type="button" className={styles.go} onClick={() => onGoPanel?.(goPanel)}>
            GO TO {PANEL_NAMES[goPanel]} ▸
          </button>
        ) : null}
        <span className={styles.nav}>
          <button type="button" className={styles.navBtn} onClick={onBack} disabled={step === 1} data-testid="guide-back">
            ◀ BACK
          </button>
          {done ? null : (
            <button type="button" className={styles.navBtn} onClick={onSkip} disabled={step === STEP_COUNT} data-testid="guide-skip">
              SKIP ▶
            </button>
          )}
          <button type="button" className={styles.navBtn} onClick={onClose} aria-label="Close guide" data-testid="guide-close">
            ✕
          </button>
        </span>
      </div>
      <div className={styles.body}>
        {bpm ? (
          <span className={styles.bpm} data-testid="guide-bpm" data-ok={bpm.dir === null}>
            D1 <b>{bpm.deck1}</b> · D2 <b>{bpm.deck2}</b> {bpm.dir === null ? '✓' : bpm.dir === 'down' ? '▼ DOWN' : '▲ UP'}
          </span>
        ) : null}
        {offset ? <OffsetMeter ms={offset.ms} dir={offset.dir} /> : null}
        <span className={styles.hint} data-testid="guide-hint">
          {view.hint}
        </span>
      </div>
    </div>
  );
}
