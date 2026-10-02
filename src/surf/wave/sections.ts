/**
 * Reference cross-sections of the wave, as 8 Catmull-Rom control points each,
 * in units of H: [z, y] pairs. z points toward shore, y up. Index 0 is the flat
 * trough in front of the wave; the curve climbs the face, passes the crest
 * (index 5 is the highest point) and ends at the lip tip / back (index 7).
 *
 *   BARREL_CLOSED side view (z →shore):
 *
 *        P5 _ P6
 *       /       \
 *     P4          \
 *     |   tube     P7 (lip lands in trough)
 *     P3            .
 *    /               .
 *  P2__P1___________P0
 */
export type Section = readonly (readonly [number, number])[];

/**
 * h = 0: the open face down the line. Concave, like a halfpipe transition (playtest 7): a gentle
 * ramp out of the trough (< 25° below a quarter of the height), steepening through the middle
 * (≈ 45° at half height) to a steep wall (≈ 68° at three quarters, 73° at its steepest), which then
 * rounds over the crest. It stays rideable to the crest (never past the Surfer's FACE_MIN_NY, ≈ 78°,
 * even on a full section peak, 1.35× as tall on the same footprint): the open face's lip is its
 * crest. Only the pitching lip near the curl goes vertical. The curve ends down the back of the wave.
 */
export const SWELL: Section = [
  [3.0, 0.0],
  [1.63, 0.1],
  [0.916, 0.241],
  [0.519, 0.421],
  [0.256, 0.682],
  [0.06, 1.0],
  [-0.45, 0.91],
  [-1.6, 0.4],
];

/**
 * The far end of the shoulder, where the wave fades out: a gentle, rounded swell (the open face before
 * playtest 7). The shoulder eases from SWELL into it as the height tapers (WaveShape.rollerBlend).
 */
export const ROLLER: Section = [
  [3.0, 0.0],
  [2.2, 0.06],
  [1.5, 0.25],
  [0.9, 0.55],
  [0.35, 0.85],
  [-0.2, 1.0],
  [-0.9, 0.8],
  [-1.8, 0.4],
];

/**
 * x = 0 (h = 1): the lip has just started to pitch; the tip hangs at 0.88 H, well out — the open eye of
 * the barrel. The face is the same concave transition as SWELL, steeper: vertical under the lip.
 */
export const BARREL_OPEN: Section = [
  [3.0, 0.0],
  [2.0, 0.04],
  [1.0, 0.25],
  [0.42, 0.6],
  [0.25, 1.0],
  [0.55, 1.15],
  [1.1, 1.09],
  [1.55, 0.88],
];

/**
 * Lip points (indices 6, 7) of the feathering crest on the way from the swell to the barrel, as
 * offsets from the crest point (index 5): a short lip just thrown past the crest. Ahead of the curl
 * the lip recedes to this — up and back to the crest — instead of sweeping the tip down across the
 * face (which hung a curtain of water over the barrel's exit). Indices 0–5 keep the plain
 * SWELL ↔ BARREL_OPEN blend.
 */
export const FEATHER_LIP: Section = [
  [0.06, -0.02],
  [0.12, -0.06],
];
/** Hollowness at which the lip is FEATHER_LIP (it grows from the swell's back below, pitches toward BARREL_OPEN above). */
export const FEATHER_AT = 0.25;
/** Hollowness above which the feathering lip pitches out to BARREL_OPEN (the throw is right at the curl). */
export const PITCH_AT = 0.96;

/** x = −D: the lip has landed in the trough in front of the face. */
export const BARREL_CLOSED: Section = [
  [3.0, 0.0],
  [2.0, 0.04],
  [1.0, 0.25],
  [0.42, 0.6],
  [0.3, 1.0],
  [0.7, 1.15],
  [1.8, 0.85],
  [2.6, 0.05],
];

/** x < −D: whitewater mound (foam). Scaled down further behind by the decay. */
export const MOUND: Section = [
  [3.0, 0.0],
  [2.2, 0.1],
  [1.6, 0.25],
  [1.1, 0.4],
  [0.7, 0.5],
  [0.3, 0.55],
  [-0.2, 0.45],
  [-0.8, 0.2],
];

export const SECTION_POINTS = 8;
/** Control-point index of the crest in every section. */
export const CREST_INDEX = 5;
