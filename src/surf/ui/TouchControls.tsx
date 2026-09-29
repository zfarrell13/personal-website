'use client';
import { useRef, useState } from 'react';
import type { ActionState } from '@/shared/input/ActionState';
import type { SurfAction } from '../physics/input';
import styles from './surf.module.css';

type Btn = { action: SurfAction; label: string; area?: string };

const PAD: Btn[] = [
  { action: 'pump', label: '▲', area: '1 / 2' },
  { action: 'carveLeft', label: '◀', area: '2 / 1' },
  { action: 'carveRight', label: '▶', area: '2 / 3' },
  { action: 'stall', label: '▼', area: '3 / 2' },
];
const ACTIONS: Btn[] = [
  { action: 'grabW', label: 'METHOD' },
  { action: 'grabA', label: 'RAIL' },
  { action: 'ollie', label: 'OLLIE' },
  { action: 'grabS', label: 'STALE' },
  { action: 'grabD', label: 'INDY' },
];

function TouchButton({ btn, actions }: { btn: Btn; actions: Pick<ActionState<SurfAction>, 'press' | 'release'> }) {
  const [held, setHeld] = useState(false);
  // Pointers currently down on this button; each is its own ActionState source so
  // the action stays held until the last finger lifts.
  const down = useRef(new Set<number>());
  const sourceOf = (id: number) => `touch:${btn.action}:${id}`;
  const up = (e: React.PointerEvent | React.SyntheticEvent<HTMLElement, Event>) => {
    const id = (e as React.PointerEvent).pointerId;
    if (!down.current.delete(id)) return;
    setHeld(down.current.size > 0);
    actions.release(btn.action, sourceOf(id));
  };
  return (
    <button
      type="button"
      className={styles.btn}
      data-held={held ? 'true' : 'false'}
      style={btn.area ? { gridArea: btn.area } : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        down.current.add(e.pointerId);
        setHeld(true);
        actions.press(btn.action, sourceOf(e.pointerId));
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {btn.label}
    </button>
  );
}

/** Landscape touch layout: left 4-way pad, right OLLIE + 4 grabs. Hidden on fine pointers (CSS). */
export function TouchControls({ actions, onPause }: { actions: Pick<ActionState<SurfAction>, 'press' | 'release'>; onPause: () => void }) {
  return (
    <div className={styles.touch} data-testid="touch-controls">
      <div className={styles.pad}>
        {PAD.map((b) => (
          <TouchButton key={b.action} btn={b} actions={actions} />
        ))}
      </div>
      <div className={styles.actionsPad}>
        {ACTIONS.map((b) => (
          <TouchButton key={b.action} btn={b} actions={actions} />
        ))}
      </div>
      <button type="button" className={`${styles.btn} ${styles.pauseBtn}`} onClick={onPause} aria-label="Pause">
        II
      </button>
    </div>
  );
}
