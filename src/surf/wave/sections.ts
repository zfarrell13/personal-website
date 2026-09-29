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

/** h = 0: unbroken swell. The curve ends down the back of the wave. */
export const SWELL: Section = [
  [3.0, 0.0],
  [2.2, 0.06],
  [1.5, 0.25],
  [0.9, 0.55],
  [0.35, 0.85],
  [-0.2, 1.0],
  [-0.9, 0.8],
  [-1.8, 0.4],
];

/** x = 0 (h = 1): the lip has just started to pitch; tip hangs at 0.7 H. */
export const BARREL_OPEN: Section = [
  [3.0, 0.0],
  [1.6, 0.05],
  [0.8, 0.3],
  [0.35, 0.7],
  [0.25, 1.0],
  [0.55, 1.15],
  [1.05, 1.02],
  [1.45, 0.7],
];

/** x = −D: the lip has landed in the trough in front of the face. */
export const BARREL_CLOSED: Section = [
  [3.0, 0.0],
  [1.6, 0.05],
  [0.8, 0.3],
  [0.35, 0.7],
  [0.3, 1.0],
  [0.7, 1.15],
  [1.55, 0.85],
  [2.1, 0.05],
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
