'use client';
import { useMemo, useState } from 'react';
import type { DeckId } from '../../constants';
import { useDj } from '../../DjContext';
import { useDjStore } from '../../store/djStore';
import { formatDuration, sortTracks, type SortKey } from './browseLogic';
import styles from './browse.module.css';

/** Large BROWSE overlay (~70 % of the viewport, 96 px rows) for one deck. */
export function Browse({ deck }: { deck: DeckId }) {
  const { tracks, actions } = useDj();
  const [sort, setSort] = useState<SortKey>('title');
  const sorted = useMemo(() => sortTracks(tracks, sort), [tracks, sort]);
  const here = useDjStore((s) => s.decks[deck].trackId);
  const other = useDjStore((s) => s.decks[deck === 0 ? 1 : 0].trackId);
  const pending = useDjStore((s) => s.decks[deck].pendingLoad);
  const setDeck = useDjStore((s) => s.setDeck);
  const close = () => setDeck(deck, { browseOpen: false, pendingLoad: null });

  return (
    <div className={styles.backdrop} onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid={`browse-overlay-${deck}`}>
      <div className={styles.panel} role="dialog" aria-label={`Browse tracks for deck ${deck + 1}`}>
        <div className={styles.head}>
          <h2>DECK {deck + 1} · BROWSE</h2>
          {(['title', 'bpm', 'key'] as const).map((k) => (
            <button key={k} type="button" className={styles.sort} aria-pressed={sort === k} onClick={() => setSort(k)}>
              {k.toUpperCase()}
            </button>
          ))}
          <button type="button" className={styles.close} onClick={close} aria-label="Close browser">
            ✕
          </button>
        </div>
        <ul className={styles.list}>
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={styles.row}
                data-testid={`track-row-${t.id}`}
                data-confirm={pending === t.id}
                onClick={() => actions.requestLoad(deck, t.id)}
              >
                {t.artworkSmallUrl ? <img className={styles.art} src={t.artworkSmallUrl} alt="" /> : <span className={styles.art} />}
                <span>
                  <div className={styles.title}>{t.title}</div>
                  <div className={styles.artist}>{t.artist}</div>
                </span>
                <span className={styles.num}>{t.bpm.toFixed(1)}</span>
                <span className={styles.num}>{t.key}</span>
                <span className={styles.num}>{formatDuration(t.durationSec)}</span>
                <span>
                  {pending === t.id ? (
                    <span className={styles.warn}>DECK ON AIR — TAP AGAIN TO LOAD</span>
                  ) : here === t.id ? (
                    <span className={styles.badge}>LOADED</span>
                  ) : other === t.id ? (
                    <span className={styles.badge}>ON DECK {deck === 0 ? 2 : 1}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
