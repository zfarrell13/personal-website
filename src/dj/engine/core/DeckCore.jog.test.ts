import { describe, expect, it } from 'vitest';
import { SCRATCH_SEC_PER_REV } from '../../constants';
import { FIRST, makeDeck, run } from './testUtil';

describe('jog', () => {
  it('VINYL mode: touching the top plate scratches — rate follows angular velocity', () => {
    const d = makeDeck();
    d.play();
    run(d, 100);
    d.jog(true, 0.5, false); // half a revolution per second forward
    run(d, 100);
    expect(d.scratching).toBe(true);
    expect(d.rate).toBeCloseTo(0.5 * SCRATCH_SEC_PER_REV, 3);
    d.jog(true, -1, false);
    run(d, 100);
    expect(d.rate).toBeCloseTo(-SCRATCH_SEC_PER_REV, 3);
  });

  it('holding the platter still stops the audio; releasing hands back to the motor', () => {
    const d = makeDeck({ jogWeight: 0 });
    d.play();
    d.jog(true, 0, false);
    run(d, 100);
    expect(Math.abs(d.rate)).toBeLessThan(1e-3);
    d.jog(false, 0, false);
    run(d, 200);
    expect(d.rate).toBe(1);
  });

  it('a heavier platter (JOG ADJUST) takes longer to get back to speed', () => {
    const light = makeDeck({ jogWeight: 0 });
    const heavy = makeDeck({ jogWeight: 1 });
    for (const d of [light, heavy]) {
      d.play();
      d.jog(true, 0, false);
      run(d, 100);
      d.jog(false, 0, false);
      run(d, 40);
    }
    expect(light.rate).toBeGreaterThan(heavy.rate);
  });

  it('one full revolution scrubs 1.8 s of audio', () => {
    const d = makeDeck();
    d.jog(true, 1, false); // paused, touching
    run(d, 1000); // one second at 1 rev/s
    d.jog(true, 0, false);
    run(d, 50);
    expect((d.pos - FIRST) / 1000).toBeCloseTo(SCRATCH_SEC_PER_REV, 1);
  });

  it('CDJ mode / outer ring bends pitch while playing, decaying when released', () => {
    const d = makeDeck({ vinylMode: false });
    d.play();
    d.jog(true, 1, false); // CDJ mode: top plate = bend
    run(d, 200);
    expect(d.scratching).toBe(false);
    expect(d.rate).toBeGreaterThan(1.05);
    d.jog(false, 0, true);
    run(d, 300);
    expect(d.rate).toBeCloseTo(1, 3);
  });

  it('turning the jog while paused searches through the track', () => {
    const d = makeDeck({ vinylMode: false });
    d.jog(false, 0.25, true);
    run(d, 1000);
    d.jog(false, 0, true);
    expect(d.pos).toBeGreaterThan(FIRST + 400);
    expect(d.atCue).toBe(false);
  });
});
