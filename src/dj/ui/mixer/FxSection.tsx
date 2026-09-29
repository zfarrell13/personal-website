'use client';
import { BEAT_FX_DIVISIONS, BEAT_FX_TYPES, COLOR_FX_TYPES, FX_CHANNELS } from '../../constants';
import { useShallow } from 'zustand/react/shallow';
import { useDjStore } from '../../store/djStore';
import { Knob } from '../controls/Knob';
import { LED, LedButton } from '../controls/LedButton';
import { LevelMeter } from './LevelMeter';
import styles from './mixer.module.css';

const cycle = <T,>(list: readonly T[], v: T, dir = 1): T => list[(list.indexOf(v) + dir + list.length) % list.length]!;
/** Beat FX division as shown on the LCD: 1/8, 1/4, 1/2, 3/4, 1, 2 … 16. */
export const divisionLabel = (d: number): string => (d >= 1 ? String(d) : d === 0.75 ? '3/4' : `1/${Math.round(1 / d)}`);

/** BEAT FX, COLOR FX, MASTER and HEADPHONES sections. */
export function FxSection() {
  // Only this section's values: channel-strip / crossfader drags must not re-render it.
  const m = useDjStore(
    useShallow((s) => ({
      masterLevel: s.mixer.masterLevel,
      masterCue: s.mixer.masterCue,
      cueMix: s.mixer.cueMix,
      hpLevel: s.mixer.hpLevel,
      hpMode: s.mixer.hpMode,
      colorFxType: s.mixer.colorFxType,
      colorFxParam: s.mixer.colorFxParam,
      beatFx: s.mixer.beatFx,
    })),
  );
  const setMixer = useDjStore((s) => s.setMixer);
  const setBeatFx = useDjStore((s) => s.setBeatFx);
  const fx = m.beatFx;
  const division = BEAT_FX_DIVISIONS[fx.divisionIndex] ?? 1;
  return (
    <div className={styles.fx}>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>MASTER</span>
        <div className={styles.row}>
          <div className={styles.stack}>
            <Knob label="MASTER" size={40} value={m.masterLevel} defaultValue={0.84} detent={null} onChange={(v) => setMixer({ masterLevel: v })} testId="master-level" />
            <LedButton label="MASTER CUE" led={LED.orange} lit={m.masterCue} toggle onPress={() => setMixer({ masterCue: !m.masterCue })} testId="master-cue">
              CUE
            </LedButton>
          </div>
          <LevelMeter label="Master level" read={[(t) => t.levels.master[0], (t) => t.levels.master[1]]} />
        </div>
      </div>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>HEADPHONES</span>
        <div className={styles.row}>
          <Knob label="MIX" size={36} value={m.cueMix} detent={null} defaultValue={0} onChange={(v) => setMixer({ cueMix: v })} testId="hp-mix" />
          <Knob label="LEVEL" size={36} value={m.hpLevel} detent={null} defaultValue={0.6} onChange={(v) => setMixer({ hpLevel: v })} testId="hp-level" />
          <LedButton label={`HEADPHONES ${m.hpMode}`} led={LED.amber} lit={m.hpMode === 'SPLIT'} onPress={() => setMixer({ hpMode: m.hpMode === 'SPLIT' ? 'STEREO' : 'SPLIT' })} testId="hp-mode">
            {m.hpMode}
          </LedButton>
        </div>
      </div>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>COLOR FX</span>
        <div className={styles.colorGrid}>
          {COLOR_FX_TYPES.map((t) => (
            <LedButton key={t} label={`COLOR FX ${t.replace('_', ' ')}`} led={LED.blue} lit={m.colorFxType === t} toggle onPress={() => setMixer({ colorFxType: t })} testId={`colorfx-${t}`}>
              {t === 'DUB_ECHO' ? 'DUB ECHO' : t}
            </LedButton>
          ))}
        </div>
        <Knob label="PARAMETER" size={36} value={m.colorFxParam} detent={null} onChange={(v) => setMixer({ colorFxParam: v })} testId="colorfx-param" />
      </div>
      <div className={styles.section} data-testid="beat-fx">
        <span className={styles.sectionTitle}>BEAT FX</span>
        <div className={styles.row}>
          <LedButton label="PREVIOUS BEAT FX" onPress={() => setBeatFx({ type: cycle(BEAT_FX_TYPES, fx.type, -1) })} testId="beat-fx-prev">
            ◄
          </LedButton>
          <LedButton label="NEXT BEAT FX" onPress={() => setBeatFx({ type: cycle(BEAT_FX_TYPES, fx.type) })} testId="beat-fx-next">
            ►
          </LedButton>
        </div>
        <div className={styles.lcd} data-testid="beat-fx-lcd" aria-live="polite">
          <span>{fx.type.replace('_', ' ')}</span> <span className={styles.lcdBeat}>{divisionLabel(division)}</span>
        </div>
        <div className={styles.row}>
          <LedButton label="BEAT DOWN" onPress={() => setBeatFx({ divisionIndex: Math.max(0, fx.divisionIndex - 1) })} testId="beat-down">
            ◄
          </LedButton>
          <span className={styles.rowLabel}>BEAT</span>
          <LedButton label="BEAT UP" onPress={() => setBeatFx({ divisionIndex: Math.min(BEAT_FX_DIVISIONS.length - 1, fx.divisionIndex + 1) })} testId="beat-up">
            ►
          </LedButton>
        </div>
        <Knob label="LEVEL/DEPTH" size={36} value={fx.depth} detent={null} onChange={(v) => setBeatFx({ depth: v })} testId="beat-fx-depth" />
        <div className={styles.row}>
          <LedButton label={`FX CHANNEL ${fx.channel.replace('_', '-')}`} onPress={() => setBeatFx({ channel: cycle(FX_CHANNELS, fx.channel) })} testId="beat-fx-channel">
            {fx.channel.replace('_', '-')}
          </LedButton>
          <LedButton label="BEAT FX ON/OFF" led={LED.red} lit={fx.on} blink={fx.on ? 'slow' : false} toggle onPress={() => setBeatFx({ on: !fx.on })} testId="beat-fx-on">
            ON/OFF
          </LedButton>
        </div>
      </div>
    </div>
  );
}
