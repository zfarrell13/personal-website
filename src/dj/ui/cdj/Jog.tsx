'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { DeckId } from '../../constants';
import { useDj } from '../../DjContext';
import { captureLost, capturePointer, isPrimary } from '../controls/capture';
import { JogInput, type JogGeometry } from './jogInput';
import { TOP_PLATE_FRACTION } from './jogMath';
import styles from './cdj.module.css';

/** The drawn top-plate edge (CSS `--plate`, radius-relative) is the hit-test boundary. */
const PLATE_STYLE = { '--plate': `${TOP_PLATE_FRACTION * 100}%` } as React.CSSProperties;

/**
 * Jog wheel. Top plate = touch (scratch in VINYL mode, bend in normal mode, search when paused);
 * outer ring = pitch bend. Rotation is sampled once per frame; one revolution = 1.8 s of audio.
 * Each jog tracks its own pointer (two hands work), and every release path sends a final zero.
 */
export function Jog({ deck }: { deck: DeckId }) {
  const { actions, loop, displays } = useDj();
  const host = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  /** Jog geometry, measured once per press (no layout read on every pointermove). */
  const geom = useRef<JogGeometry | null>(null);
  const input = useMemo(() => new JogInput((touch, v, ring) => actions.jog(deck, touch, v, ring)), [actions, deck]);

  useEffect(() => {
    const canvas = displays[deck].jog;
    plate.current?.appendChild(canvas);
    return () => canvas.remove();
  }, [displays, deck]);

  useEffect(() => {
    const display = displays[deck];
    const off = loop.add((dt) => {
      input.frame(dt);
      display.touched = input.touchingTop;
    });
    const blur = () => {
      input.release();
      display.touched = false;
    };
    window.addEventListener('blur', blur);
    return () => {
      off();
      window.removeEventListener('blur', blur);
      blur(); // unmount / runtime change: never leave the engine holding a jog velocity
    };
  }, [input, loop, displays, deck]);

  const geometry = (): JogGeometry => {
    const r = host.current!.getBoundingClientRect(); // CSS box after the booth's scale transform
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
  };
  const release = (e: React.PointerEvent) => {
    input.release(e.pointerId);
    displays[deck].touched = input.touchingTop;
  };

  return (
    <div
      ref={host}
      className={styles.jog}
      style={PLATE_STYLE}
      data-testid={`jog-${deck}`}
      role="application"
      aria-label={`Jog wheel deck ${deck + 1}`}
      onPointerDown={(e) => {
        if (!isPrimary(e)) return;
        // a stale owner (capture lost without an event) must not block the jog forever
        if (input.pointer !== null && captureLost(e.currentTarget, input.pointer)) input.release();
        const g = geometry();
        if (!input.down(e.pointerId, e.clientX, e.clientY, g)) return;
        geom.current = g;
        capturePointer(e.currentTarget, e.pointerId);
        displays[deck].touched = input.touchingTop;
      }}
      onPointerMove={(e) => {
        if (geom.current && e.pointerId === input.pointer) input.move(e.pointerId, e.clientX, e.clientY, geom.current);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div ref={plate} className={styles.jogDisplay} />
    </div>
  );
}
