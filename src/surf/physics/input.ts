import type { ActionState, Bindings } from '@/shared/input/ActionState';
import type { Side } from '../config';
import type { GrabKind } from './events';

export type SurfAction =
  | 'carveLeft'
  | 'carveRight'
  | 'pump'
  | 'stall'
  | 'ollie'
  | 'grabW'
  | 'grabA'
  | 'grabS'
  | 'grabD'
  | 'pause';

export const SURF_BINDINGS: Bindings<SurfAction> = {
  carveLeft: ['ArrowLeft'],
  carveRight: ['ArrowRight'],
  pump: ['ArrowUp'],
  stall: ['ArrowDown'],
  ollie: ['Space'],
  grabW: ['KeyW'],
  grabA: ['KeyA'],
  grabS: ['KeyS'],
  grabD: ['KeyD'],
  pause: ['Escape'],
};

/** Physics-facing input for one tick. */
export interface SurferInput {
  /** −1…1; +1 turns toward the lip (up the face), −1 toward the trough. */
  carve: number;
  /** −1…1 air spin direction (screen-relative, like carve). */
  spin: number;
  /** Edge: pump pressed this tick. */
  pump: boolean;
  /** Level: stall held. */
  stall: boolean;
  /** Edge: ollie pressed this tick. */
  ollie: boolean;
  /** Held grab (first in W, A, S, D order), or null. */
  grab: GrabKind | null;
}

export const NO_INPUT: Readonly<SurferInput> = Object.freeze({
  carve: 0,
  spin: 0,
  pump: false,
  stall: false,
  ollie: false,
  grab: null,
});

const GRAB_ORDER: ReadonlyArray<readonly [SurfAction, GrabKind]> = [
  ['grabW', 'method'],
  ['grabA', 'rail'],
  ['grabS', 'stalefish'],
  ['grabD', 'indy'],
];

/**
 * Screen-relative carve: the chase camera sits on the shoulder side, so on a
 * RIGHT the lip is screen-right; the LEFT is mirrored, so → turns down the face.
 */
export function carveFromKeys(left: boolean, right: boolean, side: Side): number {
  const raw = (right ? 1 : 0) - (left ? 1 : 0);
  return side === 'right' ? raw : -raw;
}

type Readable = Pick<ActionState<SurfAction>, 'isDown' | 'pressedThisFrame'>;

export function readSurferInput(actions: Readable, side: Side, out: SurferInput = { ...NO_INPUT }): SurferInput {
  const l = actions.isDown('carveLeft');
  const r = actions.isDown('carveRight');
  out.carve = carveFromKeys(l, r, side);
  out.spin = carveFromKeys(l, r, side);
  out.pump = actions.pressedThisFrame('pump');
  out.stall = actions.isDown('stall');
  out.ollie = actions.pressedThisFrame('ollie');
  out.grab = null;
  for (const [a, g] of GRAB_ORDER) {
    if (actions.isDown(a)) {
      out.grab = g;
      break;
    }
  }
  return out;
}
