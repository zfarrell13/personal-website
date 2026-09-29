'use client';
import { useEffect, useRef } from 'react';
import styles from './controls.module.css';
import { captureLost, capturePointer, isPrimary } from './capture';

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
  /** Latching button (exposes aria-pressed = lit). Momentary buttons leave it off. */
  toggle?: boolean;
  testId?: string;
  title?: string;
  children?: React.ReactNode;
}

/**
 * Hardware-style button: fires on pointer down (like the real deck), releases on up/cancel/lost capture.
 * A held button can never stick: blur (keyboard hold / lost capture) and unmount release it too.
 */
export function LedButton({ label, lit = false, blink = false, led = LED.green, shape = 'rect', onPress, onRelease, toggle = false, testId, title, children }: LedButtonProps) {
  const pointer = useRef<number | null>(null);
  const keyDown = useRef(false);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const el = useRef<HTMLButtonElement>(null);

  const releaseAll = () => {
    if (pointer.current === null && !keyDown.current) return;
    pointer.current = null;
    keyDown.current = false;
    if (el.current) el.current.dataset.pressed = 'false';
    releaseRef.current?.();
  };
  useEffect(() => releaseAll, []); // eslint-disable-line react-hooks/exhaustive-deps

  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return; // not the finger that pressed, or already released
    pointer.current = null;
    if (keyDown.current) return; // keyboard still holding
    e.currentTarget.dataset.pressed = 'false';
    onRelease?.();
  };
  return (
    <button
      ref={el}
      type="button"
      className={styles.btn}
      data-shape={shape}
      data-lit={lit ? 'true' : 'false'}
      data-blink={blink || undefined}
      data-testid={testId}
      aria-pressed={toggle ? lit : undefined}
      aria-label={label}
      title={title ?? label}
      style={{ '--led': led } as React.CSSProperties}
      onPointerDown={(e) => {
        if (!isPrimary(e)) return;
        if (pointer.current !== null) {
          // a live owner keeps the press; a stale one (lost capture without an event) is replaced silently
          if (!captureLost(e.currentTarget, pointer.current)) return;
          pointer.current = e.pointerId;
          capturePointer(e.currentTarget, e.pointerId);
          return;
        }
        pointer.current = e.pointerId;
        capturePointer(e.currentTarget, e.pointerId);
        e.currentTarget.dataset.pressed = 'true';
        onPress?.();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onBlur={(e) => {
        // a focus move must not drop a finger that is still holding (multi-touch); keyboard holds always release
        if (pointer.current !== null && !captureLost(e.currentTarget, pointer.current) && !keyDown.current) return;
        releaseAll();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          if (keyDown.current) return;
          keyDown.current = true;
          onPress?.();
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && keyDown.current) {
          keyDown.current = false;
          if (pointer.current === null) onRelease?.();
        }
      }}
    >
      {children ?? label}
    </button>
  );
}
