'use client';
import type { DeckId } from '../../constants';
import { useDj, useTel } from '../../DjContext';
import { useDjStore } from '../../store/djStore';
import { Fader } from '../controls/Fader';
import { LED, LedButton } from '../controls/LedButton';
import styles from './cdj.module.css';

/** MASTER, BEAT SYNC, TEMPO RANGE, MASTER TEMPO, TEMPO RESET and the long tempo fader (top = −, bottom = +). */
export function TempoSection({ deck }: { deck: DeckId }) {
  const { actions } = useDj();
  const d = useDjStore((s) => s.decks[deck]);
  const setDeck = useDjStore((s) => s.setDeck);
  const mtAvailable = useDjStore((s) => s.ui.mtAvailable);
  const isMaster = useTel((t) => t.master === deck);
  // baseRate: the displayed tempo never includes the PLL trim (TEL.rate does).
  const tempoText = useTel((t) => {
    const pct = (t.decks[deck].baseRate - 1) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  });
  return (
    <>
      <LedButton label="MASTER" led={LED.orange} lit={isMaster} toggle onPress={() => actions.setMaster(deck)} testId={`master-${deck}`} />
      <LedButton label="BEAT SYNC" led={LED.blue} lit={d.sync} toggle onPress={() => actions.toggleSync(deck)} testId={`sync-${deck}`}>
        SYNC
      </LedButton>
      <LedButton label="TEMPO RANGE" lit={false} onPress={() => actions.cycleRange(deck)} testId={`range-${deck}`}>
        {d.range === 100 ? 'WIDE' : `±${d.range}`}
      </LedButton>
      <LedButton
        label="MASTER TEMPO"
        led={LED.red}
        lit={d.masterTempo}
        toggle
        onPress={() => mtAvailable && setDeck(deck, { masterTempo: !d.masterTempo })}
        title={mtAvailable ? 'Master Tempo (key lock)' : 'Master Tempo unavailable in this browser'}
        testId={`mt-${deck}`}
      >
        MT
      </LedButton>
      <LedButton label="TEMPO RESET" led={LED.green} lit={d.tempoReset} toggle onPress={() => actions.toggleTempoReset(deck)} testId={`reset-${deck}`}>
        RESET
      </LedButton>
      <span className={styles.tempoValue} data-testid={`tempo-${deck}`}>
        {tempoText}
      </span>
      <Fader label="TEMPO" value={d.tempoFader} min={-1} max={1} invert length={260} defaultValue={0} onChange={(v) => actions.tempoFader(deck, v)} testId={`tempo-fader-${deck}`} />
    </>
  );
}
