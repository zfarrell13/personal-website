'use client';
import { useEffect, useRef } from 'react';
import type { DeckId } from '../../constants';
import { useDj } from '../../DjContext';
import { useDjStore } from '../../store/djStore';
import { capturePointer, isPrimary } from '../controls/capture';
import { overviewSeekSec, SCREEN_H, SCREEN_LAYOUT, SCREEN_W } from './screenDraw';
import styles from './cdj.module.css';

const ZOOMS = [2, 4, 8, 16] as const;
type Zoom = (typeof ZOOMS)[number];

/** Mounts the deck's shared screen canvas; touching/dragging the overview strip is needle search. */
export function CdjScreen({ deck }: { deck: DeckId }) {
  const { displays, actions, telemetry } = useDj();
  const host = useRef<HTMLDivElement>(null);
  const zoomSec = useDjStore((s) => s.decks[deck].zoomSec);
  const setDeck = useDjStore((s) => s.setDeck);
  const zoomIdx = Math.max(0, ZOOMS.indexOf(zoomSec as Zoom));

  useEffect(() => {
    const el = host.current;
    const canvas = displays[deck].screen;
    el?.prepend(canvas);
    return () => canvas.remove();
  }, [displays, deck]);

  /** Pointer CSS pixels → canvas pixels (the 960×540 canvas is CSS-scaled, possibly inside a transformed booth). */
  const seekFrom = (e: React.PointerEvent<HTMLDivElement>): boolean => {
    const rect = displays[deck].screen.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const y = ((e.clientY - rect.top) / rect.height) * SCREEN_H;
    const o = SCREEN_LAYOUT.overview;
    if (y < o.y || y > o.y + o.h) return false;
    const x = ((e.clientX - rect.left) / rect.width) * SCREEN_W;
    actions.seek(deck, overviewSeekSec(x, SCREEN_W, telemetry.decks[deck].lengthSec));
    return true;
  };

  return (
    <div
      ref={host}
      className={styles.screen}
      data-testid={`screen-${deck}`}
      onPointerDown={(e) => {
        if (e.target !== displays[deck].screen || !isPrimary(e)) return; // the zoom buttons handle their own taps
        if (seekFrom(e)) capturePointer(e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) seekFrom(e);
      }}
    >
      <div className={styles.screenOverlay}>
        <button type="button" aria-label="Zoom in" onClick={() => setDeck(deck, { zoomSec: ZOOMS[Math.max(0, zoomIdx - 1)] })}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => setDeck(deck, { zoomSec: ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)] })}>
          −
        </button>
      </div>
    </div>
  );
}
