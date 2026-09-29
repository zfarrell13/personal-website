'use client';
import type { DeckId, XfAssign } from '../../constants';
import type { ChannelState } from '../../store/djStore';
import { useDjStore } from '../../store/djStore';
import { Fader } from '../controls/Fader';
import { Knob } from '../controls/Knob';
import { LED, LedButton } from '../controls/LedButton';
import { LevelMeter } from './LevelMeter';
import styles from './mixer.module.css';

const XF_NEXT: Record<XfAssign, XfAssign> = { A: 'THRU', THRU: 'B', B: 'A' };

/** TRIM, HI/MID/LOW isolator, COLOR, CUE, channel level meter, channel fader, crossfader assign. */
export function ChannelColumn({ ch }: { ch: DeckId }) {
  const c = useDjStore((s) => s.mixer.ch[ch]);
  const setChannel = useDjStore((s) => s.setChannel);
  const set = (patch: Partial<ChannelState>) => setChannel(ch, patch);
  const n = ch + 1;
  return (
    <div className={styles.channel} data-testid={`channel-${ch}`}>
      <span className={styles.chName}>CH {n}</span>
      <Knob label="TRIM" value={c.trim} onChange={(v) => set({ trim: v })} testId={`trim-${ch}`} />
      <Knob label="HI" value={c.hi} onChange={(v) => set({ hi: v })} testId={`hi-${ch}`} />
      <Knob label="MID" value={c.mid} onChange={(v) => set({ mid: v })} testId={`mid-${ch}`} />
      <Knob label="LOW" value={c.low} onChange={(v) => set({ low: v })} testId={`low-${ch}`} />
      <Knob label="COLOR" value={c.color} min={-1} max={1} defaultValue={0} accent="#4fc3ff" onChange={(v) => set({ color: v })} testId={`color-${ch}`} />
      <LedButton label={`CUE ${n}`} led={LED.orange} lit={c.cue} toggle onPress={() => set({ cue: !c.cue })} testId={`chcue-${ch}`}>
        CUE
      </LedButton>
      <div className={styles.faderRow}>
        <LevelMeter label={`Channel ${n} level`} read={[(t) => t.levels.ch[ch]]} />
        <Fader label={`CH ${n}`} value={c.fader} onChange={(v) => set({ fader: v })} length={200} testId={`fader-ch-${ch}`} />
      </div>
      <LedButton label={`CROSSFADER ASSIGN ${n}: ${c.xf}`} onPress={() => set({ xf: XF_NEXT[c.xf] })} testId={`xf-assign-${ch}`}>
        {c.xf}
      </LedButton>
    </div>
  );
}
