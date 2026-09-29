import { Meter } from './Meter';
import styles from './retro.module.css';

export function LoadingScreen({ label = 'Loading', progress }: { label?: string; progress?: number }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.disc} aria-hidden />
      <div>{label.toUpperCase()}…</div>
      {progress !== undefined ? <Meter value={progress} segments={16} label="Loading progress" /> : null}
    </div>
  );
}
