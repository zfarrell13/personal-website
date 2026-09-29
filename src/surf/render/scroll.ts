/**
 * Floating origin: world objects are fixed on the reef, and the wave frame
 * travels +x at the peel speed. An object at world x appears at frame
 * x − travel; wrapping into [start, start + span) makes scenery endless.
 */
export function scrollWrap(worldX: number, travel: number, span: number, start: number): number {
  const rel = (((worldX - travel - start) % span) + span) % span;
  return start + rel;
}
