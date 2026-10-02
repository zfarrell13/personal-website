import { smoothstep } from '../math/scalar';
import { scrollWrap } from '../render/scroll';

/**
 * Crystal Pier as a feature of the coast: where it is in the wave frame, its shape, and what of it is
 * solid. ONE source for the scenery (Environment places the pier meshes with `pierFrameX`, shore.ts
 * builds them from `PIER` and `pierRows`) and the physics (PierDirector sweeps the rider against the
 * same rows, deck and bracing).
 *
 * The pier runs along z (out from the beach, perpendicular to it) and stands still on the coast; the
 * wave peels along x through it. In the wave frame a world-fixed point moves at −(live peel speed),
 * surge included — exactly the scenery's floating origin: frame x = world x − travel, wrapped like the
 * shore strip (scrollWrap). Frame coordinates: +x down the line, +z toward shore, the trough at z ≈ 7
 * and the crest at z ≈ 0 (the face between them), the back of the wave seaward (−z).
 */
export const PIER_TRACK = {
  /** Strip u of the pier in each landmark set (the shore strip's sets): 300 m down the line at travel 0 (≈ 37 s at 8 m/s), then every 1300 m (≈ 2.7 min). */
  sets: [300, 1600] as readonly number[],
  /** The shore strip's period and scroll window (SHORE.span / SHORE.start). */
  span: 2600,
  start: -1300,
} as const;

export const PIER = {
  /** Top of the deck (m above the sea): well above the crest (≈ 2.4 m, 3.2 m on a section peak) and the lip. */
  deckY: 7,
  /** Deck slab thickness (m). */
  deckThick: 0.45,
  /**
   * Underside of the pile caps (m): the lowest part of the pier over the water — the bents' caps and
   * the tops of their X-braces. A rider's head (or a camera) above this inside the deck's width hits it.
   */
  capY: 6.4,
  /** Deck width along x (m) and the pilings' offset from the centre line (±half). */
  width: 5,
  half: 2.2,
  /** Piling radius (m): drawn as an 8-sided prism, solid as a cylinder. */
  pilingR: 0.3,
  /**
   * Bents (a pair of pilings across the deck, X-braced between them) stand every `spacing` m along z,
   * one of them at z = `rowZ`. Fairness (rider radius 0.4, piling 0.3: a centre needs 0.7 m from a row)
   * with a choice: the rows at 0.8, 4.3 and 7.8 leave two clear lanes (PIER_LANES) — FACE (z ≈ 1.5 … 3.6:
   * the middle of the face, the transition below it and the barrel: a tubed rider at a pier pass is at
   * z ≈ 1.6–3.4) and TROUGH (z ≈ 5 … 7.1: the trough in front of the face) — and block the steep upper
   * wall (z ≈ 0.1 … 1.5, up to just under the crest), the foot of the face (z ≈ 3.6 … 5, where a sliding
   * rider crosses) and the flats (z ≈ 7.2, where a rider who does nothing ends up). Playtest 7: the concave
   * face (rows were −0.4, 3.6, 7.6 every 4 m) puts the barrel lower and wider in z (it was z ≈ 1.4–2.7) and
   * a sliding rider takes ≈ 2 s through its flat-bottomed transition to the flats. Not steering for a lane
   * is PIER'D (headless: no input / pumps only never shot it in the 40 seeded passes).
   */
  spacing: 3.5,
  rowZ: 4.3,
  /** Seaward end of the deck (z, m): past the break, five bents beyond the back of the wave. */
  endZ: -33,
  /**
   * No bracing along the pier (between bents, in the pilings' lines) over this z band — the face, the
   * crest and the flats, where the lanes are; outside it the side lattice of the real pier.
   */
  openZ: [-9, 14] as readonly [number, number],
} as const;

/** The rider as the pier sees them: a capsule along the board (radius, board half-length) standing this tall. */
export const PIER_RIDER = { radius: 0.4, boardHalf: 1, height: 1.8 } as const;

/**
 * The two clear lanes through the bents (frame z ranges a rider's centre may hold, running along x):
 * FACE between the rows either side of the middle row's seaward neighbour, TROUGH shoreward of it.
 */
export const PIER_LANES = (() => {
  const clear = PIER_RIDER.radius + PIER.pilingR;
  return {
    face: [PIER.rowZ - PIER.spacing + clear, PIER.rowZ - clear] as const,
    trough: [PIER.rowZ + clear, PIER.rowZ + PIER.spacing - clear] as const,
  };
})();

/**
 * Pier fragments nearer the camera than `hidden` m are not drawn, faded in (screen-door dither) to
 * fully drawn at `shown` m: the chase / tube camera never sees from inside a piling or brace it grazes,
 * and the tube camera (≈ 2 m behind the rider and 1.2 m shoreward, across the middle row from a rider
 * in the barrel) sees through the bent between them.
 */
export const PIER_FADE = { hidden: 1.8, shown: 3 } as const;

/** The chase camera stays this far (m) under the pile caps while it is over / under the deck … */
export const PIER_CAMERA = {
  clearance: 0.5,
  /** … easing down from this far (m along x, from the pier's centre line) to the deck's edge + 1 m. */
  ease: 14,
  /** The ceiling's rise over the ease (m): above any chase height, so far out it never binds. */
  rise: 8,
} as const;

/** Frame x (m) of the pier of landmark set `set` at scenery travel `travel`: where it is drawn and where it is solid. */
export function pierFrameX(set: number, travel: number): number {
  return scrollWrap(PIER_TRACK.sets[set]!, travel, PIER_TRACK.span, PIER_TRACK.start);
}

/** The pier nearest frame x `ref` (default the curl) at `travel`: its frame x and set. */
export function nearestPier(travel: number, ref = 0): { x: number; set: number } {
  let best = { x: Infinity, set: 0 };
  for (let k = 0; k < PIER_TRACK.sets.length; k++) {
    const x = pierFrameX(k, travel);
    if (Math.abs(x - ref) < Math.abs(best.x - ref)) best = { x, set: k };
  }
  return best;
}

/** z of every bent from the seaward end to `z1` (the shore end). */
export function pierRows(z1: number): number[] {
  const { spacing, rowZ, endZ } = PIER;
  const rows: number[] = [];
  for (let z = rowZ - Math.floor((rowZ - endZ - 0.6) / spacing) * spacing; z <= z1; z += spacing) rows.push(z);
  return rows;
}

/** Is the stretch between bents z0 and z1 braced along the sides (outside the open band)? */
export function sideBraced(z0: number, z1: number): boolean {
  return z1 <= PIER.openZ[0] || z0 >= PIER.openZ[1];
}

/** Squared distance between 2D segments ab and cd (xz). */
function segSegDist2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const pt = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => {
    const ex = rx - qx;
    const ez = rz - qz;
    const l2 = ex * ex + ez * ez;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - qx) * ex + (pz - qz) * ez) / l2)) : 0;
    const fx = qx + u * ex - px;
    const fz = qz + u * ez - pz;
    return fx * fx + fz * fz;
  };
  // Crossing segments touch.
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz);
  const d2 = o(ax, az, bx, bz, dx, dz);
  const d3 = o(cx, cz, dx, dz, ax, az);
  const d4 = o(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pt(ax, az, cx, cz, dx, dz), pt(bx, bz, cx, cz, dx, dz), pt(cx, cz, ax, az, bx, bz), pt(dx, dz, ax, az, bx, bz));
}

/**
 * Does a rider at pier-local (x, y, z) — x from the pier's centre line, y the board, z frame z — with
 * the board along (hx, hz) touch the pier? The bents are solid from the sea floor to the caps (the two
 * pilings and the X-brace between them: one thick segment across the deck at each row z), the side
 * bracing likewise outside the open band, and the deck from the caps up (a head above `capY` inside
 * the deck's width). The deck runs from the seaward end to the beach.
 */
export function riderHitsPier(x: number, y: number, z: number, hx: number, hz: number): boolean {
  const { radius, boardHalf, height } = PIER_RIDER;
  const { half, pilingR, width, capY, spacing, rowZ, endZ } = PIER;
  if (Math.abs(x) > width / 2 + boardHalf + radius || z < endZ - boardHalf - radius) return false;
  const hl = Math.hypot(hx, hz);
  const [ux, uz] = hl > 1e-9 ? [hx / hl, hz / hl] : [1, 0];
  const a = boardHalf - radius;
  const [ax, az, bx, bz] = [x - ux * a, z - uz * a, x + ux * a, z + uz * a];
  const reach2 = (radius + pilingR) ** 2;
  // The deck: the rider's head up into the caps inside its width.
  if (y + height > capY && Math.min(Math.abs(ax), Math.abs(bx), Math.abs(x)) < width / 2 + radius) return true;
  // The bents either side of the rider (and the next ones: the board can reach across a row).
  const k0 = Math.floor((z - rowZ) / spacing);
  for (let k = k0 - 1; k <= k0 + 2; k++) {
    const zr = rowZ + k * spacing;
    if (zr < endZ) continue;
    if (segSegDist2(ax, az, bx, bz, -half, zr, half, zr) < reach2) return true;
    const zn = zr + spacing;
    if (sideBraced(zr, zn)) {
      for (const s of [-1, 1]) if (segSegDist2(ax, az, bx, bz, s * half, zr, s * half, zn) < reach2) return true;
    }
  }
  return false;
}

/**
 * Is pier-local point (x, y, z) inside the solid pier (a bent / side brace from the sea floor to the
 * caps, or the deck slab with its railing)? For line-of-sight probes.
 */
export function insidePier(x: number, y: number, z: number): boolean {
  const { half, pilingR, width, capY, deckY, spacing, rowZ, endZ } = PIER;
  if (Math.abs(x) > width / 2 || z < endZ) return false;
  if (y >= capY) return y <= deckY + 1.1 && (y <= deckY || Math.abs(x) > width / 2 - 0.3);
  const k = Math.round((z - rowZ) / spacing);
  if (Math.abs(z - (rowZ + k * spacing)) < pilingR && Math.abs(x) < half + pilingR) return true;
  const zr = rowZ + Math.floor((z - rowZ) / spacing) * spacing;
  return sideBraced(zr, zr + spacing) && Math.abs(Math.abs(x) - half) < pilingR;
}

/**
 * Highest the chase camera may be at frame-x distance `dx` from a pier's centre line: under the caps
 * (by PIER_CAMERA.clearance) over the deck and 1 m either side of it, rising smoothly (smoothstep over
 * PIER_CAMERA.ease m) out of reach beyond — continuous in dx, so a passing pier lowers the camera on a
 * short ease, never a pop.
 */
export function pierCeiling(dx: number): number {
  const inner = PIER.width / 2 + 1;
  return PIER.capY - PIER_CAMERA.clearance + PIER_CAMERA.rise * smoothstep(inner, inner + PIER_CAMERA.ease, Math.abs(dx));
}

/** Drawn share (0 hidden … 1 drawn) of a pier fragment `d` m from the camera (the shader's fade). */
export function pierFade(d: number): number {
  return smoothstep(PIER_FADE.hidden, PIER_FADE.shown, d);
}
