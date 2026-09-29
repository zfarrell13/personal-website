/**
 * Floating origin: world objects are fixed on the reef, and the wave frame
 * travels +x at the peel speed. An object at world x appears at frame
 * x − travel; wrapping into [start, start + span) makes scenery endless.
 */
export function scrollWrap(worldX: number, travel: number, span: number, start: number): number {
  const rel = (((worldX - travel - start) % span) + span) % span;
  return start + rel;
}

/**
 * Reef tiling: `count` tiles of `tile` metres cycling through a window of
 * count·tile starting at `start`. Chosen so coverage always spans
 * [−200, 450] (tube interior … near fog far) and wraps happen outside it.
 */
export const REEF_TILES = { tile: 200, count: 5, start: -400 } as const;
