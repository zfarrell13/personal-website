'use client';
import type { DeckId } from '../../constants';
import { CdjScreen } from './CdjScreen';
import { HotCuePads } from './HotCuePads';
import { Jog } from './Jog';
import { JogControls } from './JogControls';
import { LoopSection } from './LoopSection';
import { ScreenButtons } from './ScreenButtons';
import { TempoSection } from './TempoSection';
import { Transport } from './Transport';
import styles from './cdj.module.css';

/** One club-standard media player deck (faithful layout, no branding). */
export function Cdj({ deck }: { deck: DeckId }) {
  return (
    <section className={styles.cdj} aria-label={`Deck ${deck + 1}`} data-testid={`cdj-${deck}`}>
      <div className={styles.screenWrap}>
        <div className={styles.screenButtons}>
          <ScreenButtons deck={deck} />
        </div>
        <CdjScreen deck={deck} />
      </div>
      <div className={styles.pads}>
        <HotCuePads deck={deck} />
      </div>
      <div className={styles.left}>
        <LoopSection deck={deck} />
      </div>
      <div className={styles.jogArea}>
        <Jog deck={deck} />
      </div>
      <div className={styles.right}>
        <TempoSection deck={deck} />
      </div>
      <div className={styles.transport}>
        <Transport deck={deck} />
      </div>
      <div className={styles.jogctl}>
        <JogControls deck={deck} />
      </div>
    </section>
  );
}
