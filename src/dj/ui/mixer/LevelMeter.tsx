'use client';
import { useEffect, useRef } from 'react';
import { useDj } from '../../DjContext';
import { LADDER_DB } from '../../engine/mixer/MixerCore';
import type { EngineTelemetry } from '../../engine/telemetry';
import { meterSegments, PeakHold } from './peakHold';
import styles from './mixer.module.css';

const zone = (i: number) => (LADDER_DB[i]! >= 4 ? 'r' : LADDER_DB[i]! >= 0 ? 'o' : 'g');

/** 15-segment LED ladder(s) with peak hold, updated per frame through refs (no React renders). */
export function LevelMeter({ read, label }: { read: ((t: EngineTelemetry) => number)[]; label: string }) {
  const { loop, telemetry } = useDj();
  const cols = useRef<Array<HTMLDivElement | null>>([]);
  const readers = useRef(read);
  useEffect(() => {
    readers.current = read;
  });

  useEffect(() => {
    const holds = readers.current.map(() => new PeakHold());
    return loop.add((dt) => {
      readers.current.forEach((r, c) => {
        const el = cols.current[c];
        const hold = holds[c];
        if (!el || !hold) return;
        const n = meterSegments(r(telemetry));
        const held = hold.update(n, dt);
        const segs = el.children;
        for (let i = 0; i < segs.length; i++) {
          const on = i < n || i === held - 1 ? 'true' : 'false';
          const seg = segs[i] as HTMLElement;
          if (seg.dataset.on !== on) seg.dataset.on = on;
        }
      });
    });
  }, [loop, telemetry]);

  return (
    <div className={styles.meterPair} role="img" aria-label={label}>
      {read.map((_, c) => (
        <div
          key={c}
          className={styles.meter}
          ref={(el) => {
            cols.current[c] = el;
          }}
        >
          {LADDER_DB.map((db, i) => (
            <span key={db} className={styles.seg} data-zone={zone(i)} data-on="false" />
          ))}
        </div>
      ))}
    </div>
  );
}
