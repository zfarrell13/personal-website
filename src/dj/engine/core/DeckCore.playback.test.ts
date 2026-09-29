import { describe, expect, it } from 'vitest';
import { FIRST, makeDeck, rampTrack, run, SR } from './testUtil';

describe('DeckCore playback', () => {
  it('loads paused with the cue on the first downbeat', () => {
    const d = makeDeck();
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST);
    expect(d.cueFrame).toBe(FIRST);
    expect(d.atCue).toBe(true);
  });

  it('plays at exactly 1 frame per frame at tempo 0 and outputs the source samples', () => {
    const d = makeDeck();
    d.play();
    const out = run(d, 100);
    expect(out[0]).toBe(FIRST);
    expect(out[99]).toBe(FIRST + 99);
    expect(d.pos).toBe(FIRST + 100);
  });

  it('a stopped deck outputs silence, not a held sample', () => {
    const d = makeDeck();
    d.play();
    run(d, 100);
    d.play(); // pause
    const out = run(d, 100);
    expect(out[99]).toBe(0);
  });

  it('applies the tempo percentage', () => {
    const d = makeDeck({ tempoPct: 8 });
    d.play();
    run(d, 1000);
    expect(d.pos).toBeCloseTo(FIRST + 1080, 6);
  });

  it('ramps the motor up and down with the vinyl speed times', () => {
    const d = makeDeck({ motorStartSec: 0.1, motorStopSec: 0.2 });
    d.play();
    run(d, 100);
    expect(d.motor).toBe(1);
    expect(d.pos - FIRST).toBeGreaterThan(45);
    expect(d.pos - FIRST).toBeLessThan(55);
    d.play(); // pause
    const before = d.pos;
    run(d, 200);
    expect(d.motor).toBe(0);
    expect(d.pos - before).toBeGreaterThan(90);
    expect(d.pos - before).toBeLessThan(110);
    const stopped = d.pos;
    run(d, 50);
    expect(d.pos).toBe(stopped);
  });

  it('plays backwards in reverse', () => {
    const d = makeDeck();
    d.seek(10);
    d.play();
    d.set({ reverse: true });
    run(d, 500);
    expect(d.pos).toBe(10 * SR - 500);
  });

  it('needle search seeks anywhere', () => {
    const d = makeDeck();
    d.seek(30);
    expect(d.pos).toBe(30 * SR);
    d.seek(9999);
    expect(d.pos).toBe(d.length);
  });

  it('stops at the end of the track and reports it once', () => {
    const d = makeDeck({}, rampTrack(2000));
    d.seek(1.9);
    d.play();
    run(d, 300);
    expect(d.state).toBe('PAUSED');
    expect(d.ended).toBe(true);
    expect(d.pos).toBe(2000);
    expect(d.drainEvents()).toEqual([{ kind: 'ended' }]);
    d.play();
    expect(d.state).toBe('PAUSED'); // PLAY does nothing at the end
  });

  it('reverse reaching frame 0 outputs silence, not a held sample', () => {
    const ones = new Float32Array(60_000).fill(1); // non-zero at frame 0 (a ramp would hide held DC)
    const d = makeDeck({}, rampTrack(60_000, { left: ones, right: ones }));
    d.seek(0.2);
    d.play();
    d.set({ reverse: true });
    const out = run(d, 600);
    expect(d.pos).toBe(0);
    expect(out[599]).toBe(0);
  });
});
