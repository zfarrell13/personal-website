import styles from './retro.module.css';

export function Meter({ value, segments = 12, label }: { value: number; segments?: number; label?: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  const lit = Math.round(clamped * segments);
  return (
    <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={clamped} aria-label={label}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? styles.segOn : styles.seg} data-on={i < lit ? 'true' : 'false'} />
      ))}
    </div>
  );
}
