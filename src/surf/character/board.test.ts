import { describe, expect, it } from 'vitest';
import { BOARD, boardHalfWidth, boardRocker, buildBoardGeometry } from './board';

describe('board', () => {
  it('has a squash tail, widest point near the middle and a pointed nose', () => {
    const mid = boardHalfWidth(0.5);
    expect(mid).toBeCloseTo(BOARD.width / 2, 1);
    expect(boardHalfWidth(0)).toBeGreaterThan(0.08);
    expect(boardHalfWidth(1)).toBeLessThan(0.1);
  });
  it('kicks the nose up more than the tail', () => {
    expect(boardRocker(1)).toBeGreaterThan(boardRocker(0));
    expect(boardRocker(0.5)).toBe(0);
  });
  it('builds a closed low-poly mesh with deck + rest groups', () => {
    const g = buildBoardGeometry();
    expect(g.groups).toHaveLength(2);
    expect(g.getIndex()!.count / 3).toBeLessThan(600);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(BOARD.length, 3);
  });
});
