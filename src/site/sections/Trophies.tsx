'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trophy, TrophyLink, TrophyVideo } from '@/content/types';
import { isBackToMenuKey } from '@/shared/input/backKey';
import { menuMove, menuSelect } from '../sfx';
import { Chips } from './Chips';
import styles from './sections.module.css';

const ARROW: Record<TrophyLink['label'], string> = { PLAY: '▶', VIEW: '↗', CODE: '</>' };

/**
 * PLAY/VIEW/CODE: site routes through next/link, anything else opens in a new tab. Each is named for its
 * project ("CODE — Kelly-style Surf Game") and says when it opens a new tab, for screen readers. A project with
 * no links (a hardware build) shows none.
 */
function TrophyLinks({ links, name }: { links: readonly TrophyLink[]; name: string }) {
  if (links.length === 0) return null;
  return (
    <div className={styles.links}>
      {links.map((l) => {
        const text = (
          <>
            {l.label} <span className={styles.srOnly}>— {name}</span> <span aria-hidden="true">{ARROW[l.label]}</span>
          </>
        );
        return l.href.startsWith('/') ? (
          <Link key={l.href} className={styles.action} href={l.href}>
            {text}
          </Link>
        ) : (
          <a key={l.href} className={styles.action} href={l.href} target="_blank" rel="noopener noreferrer">
            {text} <span className={styles.srOnly}>(opens in a new tab)</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * The detail card's clips: silent, looping, and playing on their own unless the visitor prefers reduced
 * motion, in which case each waits on its poster with the browser's controls.
 */
function TrophyVideos({ videos }: { videos: readonly TrophyVideo[] }) {
  // Read once on mount: the dialog only ever mounts in the browser, after a click.
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  return (
    <ul className={styles.videos}>
      {videos.map((v) => (
        <li key={v.src}>
          <figure className={styles.videoFigure}>
            <video
              className={styles.video}
              src={v.src}
              poster={v.poster}
              aria-label={v.label}
              width={540}
              height={960}
              muted
              loop
              playsInline
              preload="metadata"
              autoPlay={!reduced}
              controls={reduced}
            />
            <figcaption className={styles.videoLabel}>{v.label}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

/**
 * The detail card, a native modal <dialog>: the rest of the page (and the NOW PLAYING tag) is inert while it
 * is open and Tab stays inside. Esc or Backspace closes it and is marked handled so useBackToMenu leaves it
 * alone; the next Esc goes back to the menu. A click on the backdrop closes it too.
 */
function TrophyDetail({ trophy, onClose }: { trophy: Trophy; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    closeRef.current?.focus();
    // Capture phase: runs before the menu's window listener, whatever inside the page has focus.
    const onKey = (e: KeyboardEvent) => {
      if (!isBackToMenuKey(e)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const titleId = `trophy-${trophy.id}-title`;
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      // A close request the key listener didn't see (e.g. Android back): close through React, not natively.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.dialogBody}>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
          <span aria-hidden="true">✕ </span>CLOSE
        </button>
        {trophy.videos?.length ? (
          <TrophyVideos videos={trophy.videos} />
        ) : (
          <Image className={styles.detailImage} src={trophy.image} alt="" width={480} height={270} sizes="(max-width: 700px) 100vw, 640px" />
        )}
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
        <TrophyLinks links={trophy.links} name={trophy.name} />
      </div>
    </dialog>
  );
}

/** TROPHY ROOM: a grid of project cards; selecting one opens its detail card. */
export function Trophies({ trophies }: { trophies: readonly Trophy[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const open = trophies.find((t) => t.id === openId);

  // The card to refocus once the dialog has gone.
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
      <ul className={styles.grid}>
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
                aria-labelledby={`trophy-${t.id}-name`}
                aria-describedby={`trophy-${t.id}-line`}
                onClick={() => {
                  menuSelect();
                  returnTo.current = t.id;
                  setOpenId(t.id);
                }}
              >
                <Image
                  className={styles.trophyImage}
                  src={t.image}
                  alt=""
                  width={480}
                  height={270}
                  sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 300px"
                />
                <span id={`trophy-${t.id}-name`} className={styles.trophyName}>
                  {t.name}
                </span>
                <span id={`trophy-${t.id}-line`} className={styles.oneLiner}>
                  {t.oneLiner}
                </span>
              </button>
              <Chips items={t.stack} />
              <TrophyLinks links={t.links} name={t.name} />
            </article>
          </li>
        ))}
      </ul>
      {open ? <TrophyDetail trophy={open} onClose={close} /> : null}
    </>
  );
}
