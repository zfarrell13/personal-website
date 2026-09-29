'use client';
import { useRef } from 'react';
import { clampTo, positionToValue, valueToFraction } from './knobMath';
import styles from './controls.module.css';
import { captureLost, capturePointer, isPrimary } from './capture';

export interface FaderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  orientation?: 'vertical' | 'horizontal';
  /** Vertical faders: top = max unless `invert` (the tempo fader: top = slower). */
  invert?: boolean;
  length?: number;
  defaultValue?: number;
  testId?: string;
}

/** Linear fader: drag the cap, or click the track to jump there; double-click resets. */
export function Fader({ label, value, onChange, min = 0, max = 1, orientation = 'vertical', invert = false, length = 160, defaultValue, testId }: FaderProps) {
  const r = { min, max };
  const trackRef = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const vertical = orientation === 'vertical';
  // Vertical: screen y grows downward, so "top = max" is inverted pointer mapping.
  const pointerInvert = vertical ? !invert : invert;

  const fromPointer = (e: React.PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return vertical
      ? positionToValue(e.clientY, rect.top, rect.height, r, pointerInvert)
      : positionToValue(e.clientX, rect.left, rect.width, r, pointerInvert);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (active.current === e.pointerId) active.current = null;
  };
  const frac = valueToFraction(value, r);
  const along = pointerInvert ? 1 - frac : frac;

  return (
    <div className={styles.fader} data-testid={testId}>
      <div
        ref={trackRef}
        className={styles.track}
        data-orientation={orientation}
        style={vertical ? { height: length } : { width: length }}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        onPointerDown={(e) => {
          if (!isPrimary(e)) return;
          if (active.current !== null && !captureLost(e.currentTarget, active.current)) return; // one finger per fader
          capturePointer(e.currentTarget, e.pointerId);
          active.current = e.pointerId;
          onChange(fromPointer(e));
        }}
        onPointerMove={(e) => {
          if (active.current === e.pointerId) onChange(fromPointer(e));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = (max - min) * (e.shiftKey ? 0.005 : 0.05);
          const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
          const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
          if (up || down) onChange(clampTo(value + (up ? step : -step) * (invert ? -1 : 1), r));
        }}
      >
        <div className={styles.cap} style={vertical ? { top: `${along * 100}%` } : { left: `${along * 100}%` }} />
      </div>
      <span className={styles.faderLabel}>{label}</span>
    </div>
  );
}
