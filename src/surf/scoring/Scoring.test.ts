import { describe, expect, it, vi } from 'vitest';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { grabPoints, Scoring, spinPoints, TRICK_BASE } from './Scoring';

const make = () => {
  const bus = new EventBus<SurfEvent>();
  const onBank = vi.fn();
  const onLost = vi.fn();
  const scoring = new Scoring(SURF_CONFIG.scoring, { onBank, onLost });
  scoring.attach(bus);
  return { bus, scoring, onBank, onLost };
};

const landed = (time: number, extra: Partial<Extract<SurfEvent, { type: 'landed' }>> = {}): SurfEvent => ({
  type: 'landed',
  time,
  spinDeg: 0,
  grabs: [],
  revert: false,
  ollie: false,
  airTime: 0.6,
  ...extra,
});

describe('trick tables', () => {
  it('scores spins and grabs per the spec', () => {
    expect(spinPoints(0)).toBeNull();
    expect(spinPoints(180)).toEqual({ name: 'Air 180', points: 300 });
    expect(spinPoints(360)!.points).toBe(700);
    expect(spinPoints(540)!.points).toBe(1200);
    expect(spinPoints(900)).toEqual({ name: 'Air 720', points: 1800 });
    expect(grabPoints(0.3)).toBe(200);
    expect(grabPoints(1.1)).toBe(500);
  });
});

describe('Scoring', () => {
  it('banks pot × distinct-trick multiplier after the combo window', () => {
    const { bus, scoring, onBank } = make();
    bus.emit(landed(1, { ollie: true, spinDeg: 360 })); // 100 + 700, 2 distinct
    expect(scoring.pot).toBe(800);
    expect(scoring.multiplier).toBe(2);
    scoring.update(2.4, false);
    expect(scoring.score).toBe(0);
    scoring.update(2.51, false);
    expect(scoring.score).toBe(1600);
    expect(onBank).toHaveBeenCalledWith({ points: 1600, pot: 800, multiplier: 2 });
    expect(scoring.pot).toBe(0);
  });

  it('keeps the combo alive with another trick or a big carve inside the window', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'snap', time: 1 });
    bus.emit({ type: 'carve', time: 2.2, degrees: 65 });
    scoring.update(3.0, false);
    expect(scoring.pot).toBe(250);
    bus.emit({ type: 'tubeExit', time: 3.5, duration: 2 }); // Barrel 1000
    scoring.update(4.9, false);
    expect(scoring.score).toBe(0);
    scoring.update(5.1, false);
    expect(scoring.score).toBe((250 + 1000) * 2);
  });

  it('does not expire while a trick is in progress', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'snap', time: 1 });
    scoring.update(5, true);
    scoring.update(6, false);
    expect(scoring.score).toBe(0);
    scoring.update(6.6, false);
    expect(scoring.score).toBe(250);
  });

  it('halves repeats within a combo and does not grow the multiplier', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'snap', time: 1 });
    bus.emit({ type: 'snap', time: 1.5 });
    expect(scoring.pot).toBe(375);
    expect(scoring.multiplier).toBe(1);
    scoring.bank();
    bus.emit({ type: 'snap', time: 5 });
    expect(scoring.pot).toBe(250); // new combo: full points again
  });

  it('loses the unbanked pot on a wipeout but keeps banked score', () => {
    const { bus, scoring, onLost } = make();
    bus.emit({ type: 'snap', time: 1 });
    scoring.update(3, false);
    expect(scoring.score).toBe(250);
    bus.emit(landed(4, { ollie: true, grabs: [{ kind: 'indy', heldSec: 0.6 }] }));
    bus.emit({ type: 'wipeout', time: 4.5, reason: 'badLanding' });
    expect(scoring.pot).toBe(0);
    expect(scoring.score).toBe(250);
    expect(onLost).toHaveBeenCalledWith(450);
  });

  it('banks on kick-out and scores floaters and reverts', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'floaterEnd', time: 1, duration: 1.5, landed: true });
    bus.emit(landed(2, { revert: true, spinDeg: 180 }));
    bus.emit({ type: 'kickedOut', time: 2.5 });
    expect(scoring.score).toBe((550 + 300 + 150) * 3);
  });
});

describe('roundhouse', () => {
  it('a ROUNDHOUSE scores 500 (double a snap; the physics drops the snap on the way round) as its own trick in the combo', () => {
    const bus = new EventBus<SurfEvent>();
    const onAward = vi.fn();
    const scoring = new Scoring(SURF_CONFIG.scoring, { onAward });
    scoring.attach(bus);
    expect(TRICK_BASE.Roundhouse).toBe(500);
    bus.emit({ type: 'landed', time: 1, spinDeg: 0, grabs: [], revert: false, ollie: true, airTime: 0.5 });
    bus.emit({ type: 'roundhouse', time: 1.4, degrees: 260, replacesSnap: false });
    expect(onAward).toHaveBeenLastCalledWith({ name: 'Roundhouse', points: 500, repeated: false });
    expect(scoring.pot).toBe(100 + 500);
    expect(scoring.multiplier).toBe(2);
  });
});

describe('roundhouse replacing a snap', () => {
  it('a roundhouse that replaces a snap already scored takes it back: only the ROUNDHOUSE counts', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'snap', time: 1 });
    expect(scoring.pot).toBe(250);
    bus.emit({ type: 'roundhouse', time: 1.5, degrees: 240, replacesSnap: true });
    expect(scoring.pot).toBe(500);
    expect(scoring.multiplier).toBe(1);
    scoring.update(4, false);
    expect(scoring.score).toBe(500);
  });

  it('… but not a snap from an earlier move, or one already banked', () => {
    const { bus, scoring } = make();
    bus.emit({ type: 'snap', time: 1 });
    scoring.update(3, false); // banked
    bus.emit({ type: 'roundhouse', time: 3.5, degrees: 240, replacesSnap: true });
    expect(scoring.pot).toBe(500);
    expect(scoring.score).toBe(250);
  });
});

describe('fast sections', () => {
  it('surviving a fast section awards SECTION MADE (500) into the combo', () => {
    const bus = new EventBus<SurfEvent>();
    const onAward = vi.fn();
    const scoring = new Scoring(SURF_CONFIG.scoring, { onAward });
    scoring.attach(bus);
    bus.emit({ type: 'fastSection', time: 1, boost: 0.4 });
    expect(scoring.pot).toBe(0);
    bus.emit({ type: 'sectionMade', time: 5 });
    expect(onAward).toHaveBeenCalledWith({ name: 'Section Made', points: 500, repeated: false });
    scoring.update(7, false);
    expect(scoring.score).toBe(500);
  });
});
