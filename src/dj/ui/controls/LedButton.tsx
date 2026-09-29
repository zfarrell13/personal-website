'use client';
import { useRef } from 'react';
import styles from './controls.module.css';
import { capturePointer } from './capture';

export const LED = {
  green: '#35e06b',
  orange: '#ff9c1a',
  red: '#ff3b3b',
  blue: '#3aa0ff',
  white: '#f4f4f4',
  amber: '#ffc21a',
} as const;

export interface LedButtonProps {
  label: string;
  lit?: boolean;
  blink?: 'slow' | 'fast' | false;
  led?: string;
  shape?: 'rect' | 'round' | 'pad';
  onPress?: () => void;
  onRelease?: () => void;
  testId?: string;
  title?: string;
  children?: React.ReactNode;
}

/** Hardware-style button: fires on pointer down (like the real deck), releases on up/cancel. LED lit/blink states. */
export function LedButton({ label, lit = false, blink = false, led = LED.green, shape = 'rect', onPress, onRelease, testId, title, children }: LedButtonProps) {
  const pointer = useRef<number | null>(null);
  const keyDown = useRef(false);
  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return; // not the finger that pressed, or already released
    pointer.current = null;
    e.currentTarget.dataset.pressed = 'false';
    onRelease?.();
  };
  return (
    <button
      type="button"
      className={styles.btn}
      data-shape={shape}
      data-lit={lit ? 'true' : 'false'}
      data-blink={blink || undefined}
      data-testid={testId}
      aria-pressed={lit}
      aria-label={label}
      title={title ?? label}
      style={{ '--led': led } as React.CSSProperties}
      onPointerDown={(e) => {
        if (pointer.current !== null) return; // already held by another finger
        pointer.current = e.pointerId;
        capturePointer(e.currentTarget, e.pointerId);
        e.currentTarget.dataset.pressed = 'true';
        onPress?.();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          keyDown.current = true;
          onPress?.();
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && keyDown.current) {
          keyDown.current = false;
          onRelease?.();
        }
      }}
    >
      {children ?? label}
    </button>
  );
}
