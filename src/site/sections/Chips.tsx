import styles from './sections.module.css';

/** A tech stack as a row of small tags. */
export function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.chips} aria-label="Stack">
      {items.map((t) => (
        <li key={t} className={styles.chip}>
          {t}
        </li>
      ))}
    </ul>
  );
}
