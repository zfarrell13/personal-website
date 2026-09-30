'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trophy, TrophyLink } from '@/content/types';
import { isBackToMenuKey } from '@/shared/input/backKey';
import { menuMove, menuSelect } from '../sfx';
import { Chips } from './Chips';
import styles from './sections.module.css';

const ARROW: Record<TrophyLink['label'], string> = { PLAY: '▶', VIEW: '↗', CODE: '</>' };

/** PLAY/VIEW/CODE: site routes through next/link, anything else opens in a new tab. */
function TrophyLinks({ links }: { links: readonly TrophyLink[] }) {
  return (
    <div className={styles.links}>
      {links.map((l) =>
        l.href.startsWith('/') ? (
          <Link key={l.label} className={styles.action} href={l.href}>
            {l.label} <span aria-hidden="true">{ARROW[l.label]}</span>
          </Link>
        ) : (
          <a key={l.label} className={styles.action} href={l.href} target="_blank" rel="noopener noreferrer">
            {l.label} <span aria-hidden="true">{ARROW[l.label]}</span>
          </a>
        ),
      )}
    </div>
  );
}

/**
 * The detail card, a modal dialog: focus moves in (and Tab stays in), Esc or Backspace closes it and is
 * marked handled so useBackToMenu leaves it alone; the next Esc goes back to the menu. Focus returns to
 * the card that opened it.
 */
function TrophyDetail({ trophy, onClose }: { trophy: Trophy; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    // Capture phase: runs before the menu's window listener, whatever inside the page has focus.
    const onKey = (e: KeyboardEvent) => {
      if (isBackToMenuKey(e)) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = dialogRef.current.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const titleId = `trophy-${trophy.id}-title`;
  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
          ✕ CLOSE
        </button>
        <Image className={styles.detailImage} src={trophy.image} alt="" width={480} height={270} />
        <h2 id={titleId} className={styles.trophyName}>
          {trophy.name}
        </h2>
        <p className={styles.oneLiner}>{trophy.oneLiner}</p>
        {trophy.story.map((p) => (
          <p key={p} className={styles.text}>
            {p}
          </p>
        ))}
        <Chips items={trophy.stack} />
        <TrophyLinks links={trophy.links} />
      </div>
    </div>
  );
}

/** TROPHY ROOM: a grid of project cards; selecting one opens its detail card. */
export function Trophies({ trophies }: { trophies: readonly Trophy[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const open = trophies.find((t) => t.id === openId);

  // The card to refocus once the dialog has gone (and the grid is no longer inert).
  const returnTo = useRef<string | null>(null);
  const close = useCallback(() => {
    setOpenId(null);
    menuMove();
  }, []);
  useEffect(() => {
    if (openId !== null || returnTo.current === null) return;
    openers.current.get(returnTo.current)?.focus();
    returnTo.current = null;
  }, [openId]);

  return (
    <>
      <ul className={styles.grid} inert={open ? true : undefined}>
        {trophies.map((t) => (
          <li key={t.id}>
            <article className={styles.trophy} aria-labelledby={`trophy-${t.id}-name`}>
              <button
                ref={(el) => {
                  if (el) openers.current.set(t.id, el);
                  else openers.current.delete(t.id);
                }}
                type="button"
                className={styles.trophyOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  menuSelect();
                  returnTo.current = t.id;
                  setOpenId(t.id);
                }}
              >
                <Image className={styles.trophyImage} src={t.image} alt="" width={480} height={270} />
                <span id={`trophy-${t.id}-name`} className={styles.trophyName}>
                  {t.name}
                </span>
                <span className={styles.oneLiner}>{t.oneLiner}</span>
              </button>
              <Chips items={t.stack} />
              <TrophyLinks links={t.links} />
            </article>
          </li>
        ))}
      </ul>
      {open ? <TrophyDetail trophy={open} onClose={close} /> : null}
    </>
  );
}
