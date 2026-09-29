import { describe, expect, it } from 'vitest';
import { ParticlePool, RateAccumulator } from './ParticlePool';

const base = { x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, life: 1, size: 0.1, gravity: -10, drag: 0, shade: 1 };

describe('ParticlePool', () => {
  it('integrates ballistic motion and dies after its life', () => {
    const p = new ParticlePool(4);
    p.spawn(base);
    for (let i = 0; i < 10; i++) p.update(0.05);
    expect(p.pos[0]).toBeCloseTo(0.5, 5);
    expect(p.pos[1]).toBeLessThan(-1);
    expect(p.alive()).toBe(1);
    for (let i = 0; i < 11; i++) p.update(0.05);
    expect(p.alive()).toBe(0);
    expect(p.alpha[0]).toBe(0);
  });

  it('recycles the oldest slot when full', () => {
    const p = new ParticlePool(3);
    for (let i = 0; i < 5; i++) p.spawn({ ...base, x: i });
    expect(p.alive()).toBe(3);
    expect([...p.pos.filter((_, k) => k % 3 === 0)].sort()).toEqual([2, 3, 4]);
  });

  it('fades alpha over the last 30% of life', () => {
    const p = new ParticlePool(1);
    p.spawn(base);
    p.update(0.5);
    expect(p.alpha[0]).toBe(1);
    p.update(0.35);
    expect(p.alpha[0]).toBeCloseTo(0.5, 1);
  });
});

describe('RateAccumulator', () => {
  it('carries fractional particles across frames', () => {
    const r = new RateAccumulator();
    let total = 0;
    for (let i = 0; i < 60; i++) total += r.take(50, 1 / 60);
    expect(total).toBeGreaterThanOrEqual(49);
    expect(total).toBeLessThanOrEqual(50);
  });
});
