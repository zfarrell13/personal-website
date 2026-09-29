'use client';
import { useDjStore } from '../../store/djStore';
import { Fader } from '../controls/Fader';
import styles from './mixer.module.css';

/** First playable mixer: channel faders + crossfader (the full mixer panel replaces this in Task 16). */
export function Mixer() {
  const ch = useDjStore((s) => s.mixer.ch);
  const crossfader = useDjStore((s) => s.mixer.crossfader);
  const setChannel = useDjStore((s) => s.setChannel);
  const setMixer = useDjStore((s) => s.setMixer);
  return (
    <section className={styles.mixer} aria-label="Mixer" data-testid="mixer">
      {([0, 1] as const).map((i) => (
        <div key={i} className={styles.channel}>
          <span className={styles.chName}>CH {i + 1}</span>
          <Fader label={`CH ${i + 1}`} value={ch[i].fader} onChange={(v) => setChannel(i, { fader: v })} length={200} testId={`fader-ch-${i}`} />
        </div>
      ))}
      <div />
      <div className={styles.xfRow}>
        <Fader label="CROSSFADER" orientation="horizontal" value={crossfader} defaultValue={0.5} length={260} onChange={(v) => setMixer({ crossfader: v })} testId="crossfader" />
      </div>
    </section>
  );
}
