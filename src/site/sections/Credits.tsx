import type { Credits as CreditsContent } from '@/content/types';
import styles from './sections.module.css';

const BUILT_WITH = ['Next.js', 'React', 'three.js', 'WebGL 2', 'Web Audio', 'TypeScript'];

/**
 * CREDITS: contact, links, resume and what the site is built with, set like a game's end
 * credits. The roll plays once on arrival and then rests (static under reduced motion), so every link
 * stays still enough to use.
 */
export function Credits({ credits, resumePdf }: { credits: CreditsContent; resumePdf: string }) {
  return (
    <div className={styles.credits}>
      <div className={styles.roll}>
        <section className={styles.creditBlock} aria-labelledby="credits-contact">
          <h2 id="credits-contact" className={styles.creditRole}>
            CONTACT
          </h2>
          <a className={styles.creditLink} href={`mailto:${credits.email}`}>
            {credits.email}
          </a>
        </section>

        <section className={styles.creditBlock} aria-labelledby="credits-links">
          <h2 id="credits-links" className={styles.creditRole}>
            LINKS
          </h2>
          {credits.links.map((l) => (
            <a key={l.href} className={styles.creditLink} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} <span className={styles.srOnly}>(opens in a new tab)</span>
            </a>
          ))}
        </section>

        <section className={styles.creditBlock} aria-labelledby="credits-resume">
          <h2 id="credits-resume" className={styles.creditRole}>
            RESUME
          </h2>
          <a className={styles.creditLink} href={resumePdf} download>
            DOWNLOAD RESUME (PDF)
          </a>
        </section>

        <section className={styles.creditBlock} aria-labelledby="credits-built">
          <h2 id="credits-built" className={styles.creditRole}>
            BUILT WITH
          </h2>
          <p className={styles.creditName}>{BUILT_WITH.join(' · ')}</p>
        </section>

        <p className={styles.theEnd}>THANKS FOR PLAYING</p>
      </div>
    </div>
  );
}
