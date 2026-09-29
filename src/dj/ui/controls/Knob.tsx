'use client';
import { useRef } from 'react';
import { applyDetent, dragValue, valueToAngle, wheelValue } from './knobMath';
import styles from './controls.module.css';
import { capturePointer } from './capture';

export interface KnobProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
  /** Magnetic centre detent value (null = none). Defaults to `defaultValue`. */
  detent?: number | null;
  size?: number;
  /** Colour of the indicator arc (e.g. the Colour FX knob). */
  accent?: string;
  testId?: string;
}

/** Rotary knob: vertical drag (SHIFT = fine), wheel, double-click = reset, magnetic centre detent. */
export function Knob({ label, value, onChange, min = 0, max = 1, defaultValue = (min + max) / 2, detent, size = 44, accent = '#e8e8e8', testId }: KnobProps) {
  const r = { min, max };
  const drag = useRef<{ id: number; y: number; v: number; fine: boolean; last: number } | null>(null);
  const det = detent === undefined ? defaultValue : detent;
  const set = (v: number) => {
    const next = applyDetent(v, det, r);
    if (next !== value) onChange(next);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const angle = valueToAngle(value, r);
  const rad = size / 2 - 3;
  const toXY = (deg: number, rr: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [size / 2 + rr * Math.cos(a), size / 2 + rr * Math.sin(a)] as const;
  };
  const [sx, sy] = toXY(-135, rad);
  const [ex, ey] = toXY(angle, rad);
  const large = angle + 135 > 180 ? 1 : 0;
  const [px, py] = toXY(angle, rad - 7);

  return (
    <div
      className={styles.knob}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      data-testid={testId}
      onPointerDown={(e) => {
        if (drag.current) return; // one finger per knob; other pointers can drive other controls
        capturePointer(e.currentTarget, e.pointerId);
        drag.current = { id: e.pointerId, y: e.clientY, v: value, fine: e.shiftKey, last: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (d.fine !== e.shiftKey) {
          // SHIFT toggled mid-drag: rebase so the knob does not jump
          d.y = e.clientY;
          d.v = d.last;
          d.fine = e.shiftKey;
        }
        const next = applyDetent(dragValue(d.v, e.clientY - d.y, r, d.fine), det, r);
        d.last = next;
        if (next !== value) onChange(next);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onWheel={(e) => set(wheelValue(value, e.deltaY, r, e.shiftKey))}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(wheelValue(value, -1, r, e.shiftKey));
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(wheelValue(value, 1, r, e.shiftKey));
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={rad} fill="#15171c" stroke="#2c3039" strokeWidth={2} />
        <circle cx={size / 2} cy={size / 2} r={rad - 5} fill="url(#knobCap)" />
        <defs>
          <radialGradient id="knobCap" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#50545d" />
            <stop offset="100%" stopColor="#1d1f24" />
          </radialGradient>
        </defs>
        {angle > -135 ? <path d={`M ${sx} ${sy} A ${rad} ${rad} 0 ${large} 1 ${ex} ${ey}`} stroke={accent} strokeOpacity={0.35} strokeWidth={2} fill="none" /> : null}
        <line x1={size / 2} y1={size / 2} x2={px} y2={py} stroke={accent} strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <span className={styles.knobLabel}>{label}</span>
    </div>
  );
}
