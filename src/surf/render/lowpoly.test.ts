import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LowPoly } from './lowpoly';

/** Every triangle's winding normal points away from `centre` (front faces outward: single-sided is safe). */
function outward(b: LowPoly, centre: readonly [number, number, number]): number {
  const pos = b.build().getAttribute('position');
  const [a, p, q, n, m] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const c = new Vector3(...centre);
  let bad = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    p.fromBufferAttribute(pos, i + 1).sub(a);
    q.fromBufferAttribute(pos, i + 2).sub(a);
    n.crossVectors(p, q);
    if (n.lengthSq() < 1e-12) continue;
    m.fromBufferAttribute(pos, i).add(p.clone().multiplyScalar(1 / 3)).add(q.clone().multiplyScalar(1 / 3)).sub(c);
    if (n.dot(m) <= 0) bad++;
  }
  return bad;
}

describe('LowPoly winding: every primitive faces outward', () => {
  it('box', () => expect(outward(new LowPoly().box(1, 0, 2, 3, 4, 5, '#fff'), [1, 2, 2])).toBe(0));
  it('gable (both ridge directions) and hip (both orientations), over the footprint centre', () => {
    expect(outward(new LowPoly().gable(0, 0, 0, 6, 4, 2, '#fff', true), [0, 0.01, 0])).toBe(0);
    expect(outward(new LowPoly().gable(0, 0, 0, 6, 4, 2, '#fff', false), [0, 0.01, 0])).toBe(0);
    expect(outward(new LowPoly().hip(0, 0, 0, 6, 4, 2, '#fff'), [0, 0.01, 0])).toBe(0);
    expect(outward(new LowPoly().hip(0, 0, 0, 4, 6, 2, '#fff'), [0, 0.01, 0])).toBe(0);
  });
  it('prism and cone', () => {
    expect(outward(new LowPoly().prism(0, 0, 0, 2, 1, 4, 8, '#fff'), [0, 2, 0])).toBe(0);
    expect(outward(new LowPoly().prism(0, 0, 0, 2, 0, 4, 3, '#fff', 0.7), [0, 0.5, 0])).toBe(0);
  });
  it('ball', () => expect(outward(new LowPoly().ball(1, 2, 3, 2, 8, 6, '#fff'), [1, 2, 3])).toBe(0));
  it('strut (vertical, horizontal and diagonal)', () => {
    expect(outward(new LowPoly().strut([0, 0, 0], [0, 5, 0], 0.4, '#fff'), [0, 2.5, 0])).toBe(0);
    expect(outward(new LowPoly().strut([0, 1, 0], [0, 1, 6], 0.4, '#fff'), [0, 1, 3])).toBe(0);
    expect(outward(new LowPoly().strut([0, 0, 0], [3, 4, 2], 0.4, '#fff'), [1.5, 2, 1])).toBe(0);
  });
});
