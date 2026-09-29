'use client';
import type { DeckId } from '../../constants';
import { useDjStore } from '../../store/djStore';
import { LED, LedButton } from '../controls/LedButton';
import { CdjScreen } from './CdjScreen';
import { TempoSection } from './TempoSection';
import { Transport } from './Transport';
import styles from './cdj.module.css';

/** One club-standard media player deck (faithful layout, no branding). First playable version: screen, BROWSE, transport, tempo. */
export function Cdj({ deck }: { deck: DeckId }) {
  const browseOpen = useDjStore((s) => s.decks[deck].browseOpen);
  const setDeck = useDjStore((s) => s.setDeck);
  return (
    <section className={styles.cdj} aria-label={`Deck ${deck + 1}`} data-testid={`cdj-${deck}`}>
      <div className={styles.screenWrap}>
        <div className={styles.screenButtons}>
          <LedButton label="BROWSE" led={LED.white} lit={browseOpen} toggle onPress={() => setDeck(deck, { browseOpen: !browseOpen, pendingLoad: null })} testId={`browse-${deck}`} />
        </div>
        <CdjScreen deck={deck} />
      </div>
      <div className={styles.pads} />
      <div className={styles.left} />
      <div className={styles.jogArea} />
      <div className={styles.right}>
        <TempoSection deck={deck} />
      </div>
      <div className={styles.transport}>
        <Transport deck={deck} />
      </div>
      <div className={styles.jogctl} />
    </section>
  );
}
