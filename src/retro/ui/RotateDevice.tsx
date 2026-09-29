import styles from './retro.module.css';

export function RotateDevice() {
  return (
    <div className={styles.rotate} aria-live="polite">
      <div style={{ fontSize: '3rem' }} aria-hidden>⟳</div>
      <p>ROTATE YOUR DEVICE TO LANDSCAPE</p>
    </div>
  );
}
