import { describe, expect, it } from 'vitest';
import { SHORE } from '../render/shore';
import { scrollWrap } from '../render/scroll';
import { insidePier, nearestPier, PIER, PIER_TRACK, pierCeiling, pierFade, PIER_FADE, pierFrameX, pierRows, riderHitsPier, sideBraced } from './track';

describe('pier track', () => {
  it('is the shore strip\'s landmark sets, scrolled like the scenery (frame x = world x − travel, wrapped)', () => {
    expect(SHORE.landmarkU).toEqual(PIER_TRACK.sets);
    expect(SHORE.span).toBe(PIER_TRACK.span);
    expect(SHORE.start).toBe(PIER_TRACK.start);
    for (const travel of [0, 37.25, 299, 1000, 5123.5]) {
      PIER_TRACK.sets.forEach((U, k) => expect(pierFrameX(k, travel)).toBeCloseTo(scrollWrap(U, travel, SHORE.span, SHORE.start), 9));
      // Moving 1 m of travel moves the pier 1 m back through the frame (away from a wrap).
      const n = nearestPier(travel, 10);
      if (Math.abs(n.x) < 600) expect(nearestPier(travel + 1, 10).x).toBeCloseTo(n.x - 1, 9);
    }
  });

  it('first passes the rider ≈ 30–40 s into a run at the base peel, then every ≈ 160 s (the scroller wrap)', () => {
    const vp = 8;
    const riderX = 10;
    const passes: number[] = [];
    let prev = nearestPier(0, riderX).x;
    for (let t = 1 / 120; t < 600; t += 1 / 120) {
      const x = nearestPier(vp * t, riderX).x;
      if (prev > riderX && x <= riderX) passes.push(t);
      prev = x;
    }
    expect(passes[0]).toBeGreaterThan(30);
    expect(passes[0]).toBeLessThan(40);
    expect(passes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < passes.length; i++) expect(passes[i]! - passes[i - 1]!).toBeCloseTo(PIER_TRACK.span / PIER_TRACK.sets.length / vp, 1);
    expect(PIER_TRACK.span / PIER_TRACK.sets.length / vp).toBeGreaterThan(150);
    expect(PIER_TRACK.span / PIER_TRACK.sets.length / vp).toBeLessThan(170);
  });

  it('runs out past the break: bents from beyond the back of the wave to the beach, the deck well above the crest', () => {
    const rows = pierRows(140);
    expect(rows[0]!).toBeGreaterThanOrEqual(PIER.endZ);
    expect(rows[0]!).toBeLessThan(-20);
    expect(rows.at(-1)!).toBeGreaterThan(130);
    for (let i = 1; i < rows.length; i++) expect(rows[i]! - rows[i - 1]!).toBeCloseTo(PIER.spacing, 9);
    expect(rows.some((z) => Math.abs(z - PIER.rowZ) < 1e-9)).toBe(true);
    // Crest ≈ 2.4 m, 3.2 m on a full section peak: the caps are ≥ 3 m above it.
    expect(PIER.capY).toBeGreaterThan(2.4 * 1.35 + 3);
    expect(PIER.deckY).toBeGreaterThanOrEqual(6);
    expect(PIER.deckY).toBeLessThanOrEqual(7.5);
  });

  it('leaves two clear lanes (face and barrel; trough) and blocks the upper wall, the foot of the face and the flats', () => {
    const { radius } = { radius: 0.4 };
    const reach = radius + PIER.pilingR;
    const rows = pierRows(140);
    const clear = (z: number) => rows.every((r) => Math.abs(z - r) >= reach);
    // (Playtest 7: the concave face moved the lanes.) FACE: the middle of the face, the transition below
    // it and the barrel (a tubed rider at a pier pass is at z ≈ 1.6 … 3.4).
    for (let z = 1.55; z <= 3.55; z += 0.05) expect(clear(z)).toBe(true);
    // TROUGH: the trough in front of the face.
    for (let z = 5.05; z <= 7.05; z += 0.05) expect(clear(z)).toBe(true);
    // Blocked: the steep upper wall up to just under the crest (z ≈ 0.1 … 1.5 on the open face), the foot of
    // the face (z ≈ 3.6 … 5, where a sliding rider crosses), the flats (z ≈ 7.2, where a rider who does nothing ends up).
    for (const z of [0.2, 0.8, 1.4, 3.7, 4.3, 4.9, 7.2, 7.5]) expect(clear(z)).toBe(false);
    // No side bracing across the lanes.
    expect(sideBraced(PIER.rowZ - PIER.spacing, PIER.rowZ)).toBe(false);
    expect(sideBraced(PIER.rowZ, PIER.rowZ + PIER.spacing)).toBe(false);
  });

  it('detects a rider touching a piling, a bent\'s bracing or the deck, and not one in a lane', () => {
    // Running down the line (+x) through the high and low lanes, under the deck.
    for (const z of [1.6, 2.5, 3.5, 5.1, 6, 7]) for (let x = -5; x <= 5; x += 0.05) expect(riderHitsPier(x, 1, z, 1, 0)).toBe(false);
    // Into the middle row: the near piling, the X-brace between the pair, the far piling.
    expect(riderHitsPier(-PIER.half - 1.2, 1, PIER.rowZ, 1, 0)).toBe(true);
    expect(riderHitsPier(-PIER.half - 1.4, 1, PIER.rowZ, 1, 0)).toBe(false);
    expect(riderHitsPier(0, 1, PIER.rowZ, 1, 0)).toBe(true);
    expect(riderHitsPier(PIER.half, 1, PIER.rowZ + 0.65, 1, 0)).toBe(true);
    expect(riderHitsPier(PIER.half, 1, PIER.rowZ + 0.75, 1, 0)).toBe(false);
    // The board's length counts: across the lane (along z) it reaches the row.
    expect(riderHitsPier(0, 1, PIER.rowZ - 1.2, 0, 1)).toBe(true);
    expect(riderHitsPier(0, 1, PIER.rowZ - 1.2, 1, 0)).toBe(false);
    // Air up into the deck from below.
    const faceLane = PIER.rowZ - PIER.spacing / 2;
    expect(riderHitsPier(0, PIER.capY - 1.7, faceLane, 1, 0)).toBe(true);
    expect(riderHitsPier(0, PIER.capY - 1.9, faceLane, 1, 0)).toBe(false);
    // Far along the line from it: nothing.
    expect(riderHitsPier(6, 1, PIER.rowZ, 1, 0)).toBe(false);
  });

  it('knows its solid volume for sight lines', () => {
    expect(insidePier(PIER.half, 1, PIER.rowZ)).toBe(true);
    expect(insidePier(0, 1, PIER.rowZ)).toBe(true);
    const faceLane = PIER.rowZ - PIER.spacing / 2;
    expect(insidePier(0, 1, faceLane)).toBe(false);
    expect(insidePier(0, PIER.deckY - 0.2, faceLane)).toBe(true);
    expect(insidePier(0, PIER.deckY + 0.5, faceLane)).toBe(false);
    expect(insidePier(4, 1, PIER.rowZ)).toBe(false);
  });

  it('caps the chase camera under the deck over it, easing out continuously along the line', () => {
    expect(pierCeiling(0)).toBeCloseTo(PIER.capY - 0.5, 9);
    expect(pierCeiling(PIER.width / 2 + 1)).toBeCloseTo(PIER.capY - 0.5, 9);
    expect(pierCeiling(30)).toBeGreaterThan(12);
    let prev = pierCeiling(0);
    for (let d = 0.01; d < 30; d += 0.01) {
      const c = pierCeiling(d);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(c - prev).toBeLessThan(0.01); // ≤ 1 m per m along the line: a short ease, no step
      prev = c;
    }
  });

  it('fades pier fragments out near the camera', () => {
    expect(pierFade(PIER_FADE.hidden)).toBe(0);
    expect(pierFade(0.2)).toBe(0);
    expect(pierFade(PIER_FADE.shown)).toBe(1);
  });
});
