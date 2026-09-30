/** Distance (m, along x) from frame x to the impact zone x ∈ [−D, 0], where the lip lands. */
export function impactDistance(x: number, tubeDepth: number): number {
  return x > 0 ? x : x < -tubeDepth ? -tubeDepth - x : 0;
}
