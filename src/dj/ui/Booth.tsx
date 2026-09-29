'use client';
import { useEffect, useRef, useState } from 'react';
import { useDjStore } from '../store/djStore';
import { Browse } from './browse/Browse';
import { Cdj } from './cdj/Cdj';
import { BOOTH_H, BOOTH_W, compactPanelScale, fitScale, HUD_H, isCompact, PANEL_SIZES, panelAt } from './layout';
import { Mixer } from './mixer/Mixer';
import styles from './booth.module.css';

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/** Scales fixed-size hardware to fit while keeping a correctly sized layout box (so centring works). */
function Scaled({ w, h, scale, className, children }: { w: number; h: number; scale: number; className?: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: w * scale, height: h * scale, flex: 'none' }}>
      <div className={className} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        {children}
      </div>
    </div>
  );
}

/** Close-up booth: deck 1 | mixer | deck 2 scaled to fit; on phones, three swipeable full-size panels. */
export function Booth() {
  const { w, h } = useViewport();
  const view = useDjStore((s) => s.ui.view);
  const panel = useDjStore((s) => s.ui.mobilePanel);
  const setUi = useDjStore((s) => s.setUi);
  const browse0 = useDjStore((s) => s.decks[0].browseOpen);
  const browse1 = useDjStore((s) => s.decks[1].browseOpen);
  const scroller = useRef<HTMLDivElement>(null);
  const compact = isCompact(w, h);

  // Entering the compact layout: scroll to the remembered panel (the mixer by default).
  const initialPanel = useRef(panel);
  useEffect(() => {
    const el = scroller.current;
    if (compact && el) el.scrollTo({ left: initialPanel.current * el.clientWidth });
  }, [compact]);

  const parts = [<Cdj key="d1" deck={0} />, <Mixer key="mx" />, <Cdj key="d2" deck={1} />];

  return (
    <div className={styles.stage} data-view={view} data-testid="booth">
      <div className={styles.dim} />
      {compact ? (
        <>
          <div
            ref={scroller}
            className={styles.panels}
            onScroll={(e) => {
              const p = panelAt(e.currentTarget.scrollLeft, e.currentTarget.clientWidth);
              initialPanel.current = p;
              if (p !== panel) setUi({ mobilePanel: p });
            }}
          >
            {parts.map((part, i) => (
              <div key={i} className={styles.panel}>
                <Scaled w={PANEL_SIZES[i]!.w} h={PANEL_SIZES[i]!.h} scale={compactPanelScale(PANEL_SIZES[i]!.w, w)}>
                  {part}
                </Scaled>
              </div>
            ))}
          </div>
          <div className={styles.dots}>
            {[0, 1, 2].map((i) => (
              <button key={i} type="button" className={styles.dot} data-on={panel === i} aria-label={['Deck 1', 'Mixer', 'Deck 2'][i]} onClick={() => scroller.current?.scrollTo({ left: i * scroller.current.clientWidth, behavior: 'smooth' })} />
            ))}
          </div>
        </>
      ) : (
        <Scaled w={BOOTH_W} h={BOOTH_H} scale={fitScale(BOOTH_W, BOOTH_H, w, h - HUD_H)} className={styles.booth}>
          {parts}
        </Scaled>
      )}
      {browse0 ? <Browse deck={0} /> : null}
      {browse1 ? <Browse deck={1} /> : null}
    </div>
  );
}
