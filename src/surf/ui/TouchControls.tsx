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
// Two columns hugging the right edge (grabs above, OLLIE under the thumb in the corner): a three-wide pad
// reached into the middle of the screen, over the rider's board in the tube view.
const ACTIONS: Btn[] = [
  { action: 'grabW', label: 'METHOD', area: '1 / 1' },
  { action: 'grabA', label: 'RAIL', area: '1 / 2' },
  { action: 'grabS', label: 'STALE', area: '2 / 1' },
  { action: 'grabD', label: 'INDY', area: '2 / 2' },
  { action: 'ollie', label: 'OLLIE', area: '3 / 2' },
];

function TouchButton({ btn, actions, onCancel }: { btn: Btn; actions: Pick<ActionState<SurfAction>, 'press' | 'release'>; onCancel?: (action: SurfAction) => void }) {
  const [held, setHeld] = useState(false);
  // Pointers currently down on this button; each is its own ActionState source so
  // the action stays held until the last finger lifts.
  const down = useRef(new Set<number>());
  const sourceOf = (id: number) => `touch:${btn.action}:${id}`;
  /** `cancelled`: the OS took the pointer (a gesture, a notification), the player didn't lift it. */
  const up = (e: React.PointerEvent | React.SyntheticEvent<HTMLElement, Event>, cancelled = false) => {
    const id = (e as React.PointerEvent).pointerId;
    if (!down.current.delete(id)) return;
    setHeld(down.current.size > 0);
    // Cancelled while held (the last finger): tell the game first, so the release is not a pop.
    if (cancelled && down.current.size === 0) onCancel?.(btn.action);
    actions.release(btn.action, sourceOf(id));
  };
  const cancel = (e: React.PointerEvent) => up(e, true);
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
      onPointerCancel={cancel}
      onPointerLeave={up}
      onLostPointerCapture={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {btn.label}
    </button>
  );
}

/**
 * Landscape touch layout: left 4-way pad, right OLLIE + 4 grabs. Hidden on fine pointers (CSS).
 * `onCancel`: a held button's pointer was taken by the OS (pointercancel / lost capture), not lifted —
 * the game drops a loading ollie instead of popping it.
 */
export function TouchControls({ actions, onPause, onCancel }: { actions: Pick<ActionState<SurfAction>, 'press' | 'release'>; onPause: () => void; onCancel?: (action: SurfAction) => void }) {
  return (
    <div className={styles.touch} data-testid="touch-controls">
      <div className={styles.pad}>
        {PAD.map((b) => (
          <TouchButton key={b.action} btn={b} actions={actions} />
        ))}
      </div>
      <div className={styles.actionsPad}>
        {ACTIONS.map((b) => (
          <TouchButton key={b.action} btn={b} actions={actions} onCancel={onCancel} />
        ))}
      </div>
      <button type="button" className={`${styles.btn} ${styles.pauseBtn}`} onClick={onPause} aria-label="Pause">
        II
      </button>
    </div>
  );
}
