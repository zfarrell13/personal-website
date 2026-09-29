'use client';
import type { CurveKind } from '../../constants';
import { useDjStore } from '../../store/djStore';
import { Fader } from '../controls/Fader';
import { LedButton } from '../controls/LedButton';
import { ChannelColumn } from './ChannelColumn';
import { FxSection } from './FxSection';
import styles from './mixer.module.css';

const CURVES: readonly CurveKind[] = [0, 1, 2];
const CURVE_NEXT = (c: CurveKind): CurveKind => CURVES[(c + 1) % CURVES.length]!;
/** Curve glyphs: 0 = smooth, 1 = linear, 2 = sharp cut. */
const CURVE_GLYPH = ['◠', '╱', '⌐'] as const;

/** Two-channel club mixer: channel strips, FX/master/headphones column, crossfader with curve selectors. */
export function Mixer() {
  const crossfader = useDjStore((s) => s.mixer.crossfader);
  const chCurve = useDjStore((s) => s.mixer.chCurve);
  const xfCurve = useDjStore((s) => s.mixer.xfCurve);
  const setMixer = useDjStore((s) => s.setMixer);
  return (
    <section className={styles.mixer} aria-label="Mixer" data-testid="mixer">
      <ChannelColumn ch={0} />
      <ChannelColumn ch={1} />
      <FxSection />
      <div className={styles.xfRow}>
        <LedButton label={`CHANNEL FADER CURVE ${chCurve + 1}`} onPress={() => setMixer({ chCurve: CURVE_NEXT(chCurve) })} testId="ch-curve">
          CH {CURVE_GLYPH[chCurve]}
        </LedButton>
        <Fader label="CROSSFADER" orientation="horizontal" value={crossfader} defaultValue={0.5} length={220} onChange={(v) => setMixer({ crossfader: v })} testId="crossfader" />
        <LedButton label={`CROSSFADER CURVE ${xfCurve + 1}`} onPress={() => setMixer({ xfCurve: CURVE_NEXT(xfCurve) })} testId="xf-curve">
          XF {CURVE_GLYPH[xfCurve]}
        </LedButton>
      </div>
    </section>
  );
}
