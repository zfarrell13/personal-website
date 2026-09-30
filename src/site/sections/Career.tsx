'use client';
import { useId, useState } from 'react';
import { seasonsNewestFirst } from '@/content/site';
import type { Career as CareerContent, Season } from '@/content/types';
import { menuSelect } from '../sfx';
import { Chips } from './Chips';
import styles from './sections.module.css';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2023-06" → "JUN 2023"; "Present" → "PRESENT". */
function month(ym: string): string {
  const [y, m] = ym.split('-');
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : ym.toUpperCase();
}

const dates = (s: Season) => `${month(s.start)} – ${month(s.end)}`;

/**
 * CAREER MODE: the resume PDF, then the seasons newest first. Each season is a button row
 * (role · company · dates) that opens its wins and stack; the newest starts open.
 */
export function Career({ career }: { career: CareerContent }) {
  const seasons = seasonsNewestFirst(career.seasons);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const idBase = useId();

  const toggle = (i: number) => {
    menuSelect();
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  };

  return (
    <div className={styles.career}>
      <a className={styles.action} href={career.resumePdf} download>
        ⬇ DOWNLOAD RESUME (PDF)
      </a>
      <ol className={styles.seasons}>
        {seasons.map((s, i) => {
          const expanded = open.has(i);
          const panelId = `${idBase}-season-${i}`;
          return (
            <li key={`${s.start}-${s.company}`} className={styles.season}>
              <h2 className={styles.seasonHead}>
                <button
                  type="button"
                  className={styles.seasonRow}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(i)}
                  onKeyDown={(e) => {
                    // Enter toggles here (and preventDefault stops the browser's own Enter click toggling it back).
                    if (e.key !== 'Enter' || e.repeat) return;
                    e.preventDefault();
                    toggle(i);
                  }}
                >
                  <span className={styles.chevron} aria-hidden="true">
                    {expanded ? '▼' : '▶'}
                  </span>
                  <span className={styles.seasonRole}>{s.role}</span>
                  <span className={styles.seasonCompany}>{s.company}</span>
                  <span className={styles.seasonDates}>{dates(s)}</span>
                </button>
              </h2>
              <div id={panelId} className={styles.seasonBody} hidden={!expanded}>
                {expanded ? (
                  <>
                    {s.location ? <p className={styles.seasonWhere}>{s.location}</p> : null}
                    <ul className={styles.wins}>
                      {s.wins.map((w) => (
                        <li key={w} className={styles.text}>
                          {w}
                        </li>
                      ))}
                    </ul>
                    {s.stack?.length ? <Chips items={s.stack} /> : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
