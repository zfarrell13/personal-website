import type { DeckId } from '../../constants';

/** Real footprints in metres (width × depth × height). */
export const CDJ_SIZE = { w: 0.329, d: 0.453, h: 0.12 } as const;
export const DJM_SIZE = { w: 0.333, d: 0.408, h: 0.108 } as const;
/** Table top height and unit centres along x (DJ faces −z; the screen end of each unit points at the crowd). */
export const TABLE_Y = 1.0;
export const UNIT_X = { cdj0: -0.36, djm: 0, cdj1: 0.36 } as const;

/**
 * Control positions as fractions of the unit's top face, matching the close-up DOM
 * layout: u = 0 left → 1 right, v = 0 far edge (screen) → 1 near edge (DJ).
 */
export const CDJ_LAYOUT = {
  screen: { u: 0.56, v: 0.14, w: 0.8, h: 0.24 },
  jog: { u: 0.5, v: 0.62, r: 0.27 },
  tempo: { u: 0.91, v0: 0.55, v1: 0.86 },
  play: { u: 0.13, v: 0.93 },
  cue: { u: 0.13, v: 0.84 },
  pads: { v: 0.3, u0: 0.1, u1: 0.9 },
} as const;

export const DJM_LAYOUT = {
  channelU: [0.17, 0.43] as const,
  knobsV: { trim: 0.08, hi: 0.15, mid: 0.22, low: 0.29, color: 0.36 } as const,
  faderV: [0.58, 0.8] as const,
  crossfader: { v: 0.93, u0: 0.3, u1: 0.7 },
  depth: { u: 0.8, v: 0.3 },
  master: { u: 0.74, v: 0.6 },
} as const;

/** Converts a (u, v) point on a unit centred at `cx` into world x/z. */
export function unitPoint(cx: number, size: { w: number; d: number }, u: number, v: number): { x: number; z: number } {
  return { x: cx + (u - 0.5) * size.w, z: (v - 0.5) * size.d };
}

export const cdjX = (deck: DeckId): number => (deck === 0 ? UNIT_X.cdj0 : UNIT_X.cdj1);
