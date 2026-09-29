import styles from './retro.module.css';

export function Panel({ title, className, children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`${styles.panel} ${className ?? ''}`}>
      {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
      {children}
    </div>
  );
}
