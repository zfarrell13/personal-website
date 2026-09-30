import Image from 'next/image';
import type { Profile as ProfileContent } from '@/content/types';
import { Meter } from '@/retro/ui/Meter';
import styles from './sections.module.css';

/** RIDER PROFILE: the player card (photo, name, title, location, tagline, bio, looking-for) and stat bars. */
export function Profile({ profile }: { profile: ProfileContent }) {
  return (
    <div className={styles.profile}>
      <section className={styles.card} aria-labelledby="rider-name">
        <Image className={styles.photo} src={profile.photo} alt={`Photo of ${profile.name}`} width={320} height={400} preload />
        <div className={styles.cardId}>
          <h2 id="rider-name" className={styles.riderName}>
            {profile.name}
          </h2>
          <p className={styles.riderTitle}>{profile.title}</p>
          <p className={styles.riderMeta}>
            <span aria-hidden="true">⌖ </span>
            {profile.location}
          </p>
          <p className={styles.quote}>{profile.tagline}</p>
        </div>
      </section>

      <section className={styles.block} aria-labelledby="rider-bio">
        <h3 id="rider-bio" className={styles.label}>
          BIO
        </h3>
        {profile.bio.map((p) => (
          <p key={p} className={styles.text}>
            {p}
          </p>
        ))}
      </section>

      <section className={styles.block} aria-labelledby="rider-next">
        <h3 id="rider-next" className={styles.label}>
          LOOKING FOR
        </h3>
        <p className={styles.text}>{profile.lookingFor}</p>
      </section>

      <section className={styles.block} aria-labelledby="rider-stats">
        <h3 id="rider-stats" className={styles.label}>
          STATS
        </h3>
        <ul className={styles.stats}>
          {profile.stats.map((s) => (
            <li key={s.label} className={styles.stat}>
              <span className={styles.statLabel}>{s.label}</span>
              <span className={styles.statMeter}>
                <Meter value={s.value / 10} segments={10} label={s.label} />
              </span>
              <span className={styles.statValue} aria-hidden="true">
                {s.value}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
