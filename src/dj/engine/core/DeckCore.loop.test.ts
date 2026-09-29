import { describe, expect, it } from 'vitest';
import { FIRST, FPB, makeDeck, run, SR } from './testUtil';

describe('loops', () => {
  it('LOOP IN / OUT (quantized) wraps sample-accurately', () => {
    const d = makeDeck();
    d.play();
    run(d, 30); // pos = FIRST + 30 → loop in snaps to FIRST
    d.loopInPress();
    expect(d.loopIn).toBe(FIRST);
    run(d, 2 * FPB - 30 + 40); // a bit past beat 2
    d.loopOutPress();
    expect(d.loopOut).toBe(FIRST + 2 * FPB);
    expect(d.loopActive).toBe(true);
    expect(d.pos).toBe(FIRST + 40); // already past the out point → wrapped
    const out = run(d, 2 * FPB);
    // frame by frame: ... FIRST+999, then FIRST+0 exactly (no interpolation smear at the wrap)
    const wrapAt = 2 * FPB - 40;
    expect(out[wrapAt - 1]).toBe(FIRST + 2 * FPB - 1);
    expect(out[wrapAt]).toBe(FIRST);
  });

  it('RELOOP/EXIT exits and re-enters the loop', () => {
    const d = makeDeck();
    d.play();
    d.autoLoop(4);
    run(d, 10);
    d.reloopExit();
    expect(d.loopActive).toBe(false);
    run(d, 4 * FPB);
    expect(d.pos).toBe(FIRST + 4 * FPB + 10);
    d.reloopExit();
    expect(d.loopActive).toBe(true);
    expect(d.pos).toBe(FIRST);
  });

  it('4-BEAT and 8-BEAT loops start on the previous beat when quantized', () => {
    const d = makeDeck();
    d.seek((FIRST + 3 * FPB + 300) / SR);
    d.play();
    d.autoLoop(4);
    expect(d.loopIn).toBe(FIRST + 3 * FPB);
    expect(d.loopBeats).toBe(4);
    d.autoLoop(8);
    expect(d.loopBeats).toBe(8);
  });

  it('½X / 2X halve and double between 1/16 and 32 beats', () => {
    const d = makeDeck();
    d.play();
    d.autoLoop(4);
    d.scaleLoop(0.5);
    expect(d.loopBeats).toBe(2);
    for (let i = 0; i < 10; i++) d.scaleLoop(0.5);
    expect(d.loopBeats).toBe(1 / 16);
    for (let i = 0; i < 12; i++) d.scaleLoop(2);
    expect(d.loopBeats).toBe(32);
  });

  it('halving wraps a playhead that is now beyond the out point', () => {
    const d = makeDeck();
    d.play();
    d.autoLoop(4);
    run(d, 3 * FPB + 10);
    d.scaleLoop(0.5); // 2 beats; pos was 3 beats + 10 in → 1 beat + 10
    expect(d.pos).toBe(FIRST + FPB + 10);
  });

  it('beat jump moves by the jump size, and moves an active loop with it', () => {
    const d = makeDeck({ beatJumpBeats: 4 });
    d.beatJump(1);
    expect(d.pos).toBe(FIRST + 4 * FPB);
    d.beatJump(-1);
    expect(d.pos).toBe(FIRST);
    d.play();
    d.autoLoop(2);
    d.beatJump(1);
    expect(d.loopIn).toBe(FIRST + 4 * FPB);
    expect(d.pos).toBe(FIRST + 4 * FPB);
  });
});

describe('slip', () => {
  it('a loop with SLIP on returns to where the track would have been', () => {
    const d = makeDeck({ slip: true });
    d.play();
    d.autoLoop(1);
    run(d, 3 * FPB + 7);
    d.reloopExit();
    expect(d.pos).toBe(FIRST + 3 * FPB + 7);
  });

  it('reverse with SLIP on returns to the shadow position', () => {
    const d = makeDeck({ slip: true });
    d.seek(10);
    d.play();
    d.set({ reverse: true });
    run(d, 1000);
    expect(d.pos).toBe(10 * SR - 1000);
    d.set({ reverse: false });
    expect(d.pos).toBe(10 * SR + 1000);
  });

  it('slip pause: the shadow keeps running while paused', () => {
    const d = makeDeck({ slip: true });
    d.play();
    run(d, 100);
    d.play(); // pause (instant motor in tests)
    run(d, 400);
    d.play();
    expect(d.pos).toBe(FIRST + 500);
  });

  it('a hot cue held with SLIP on returns to the shadow on release', () => {
    const d = makeDeck({ slip: true });
    d.seek(20);
    d.hotCue(0, true, false); // 20 s = beat 39.5 → quantize rounds to beat 40
    expect(d.hotCues[0]).toBe(FIRST + 40 * FPB);
    d.seek(5);
    d.play();
    d.hotCue(0, true, false);
    run(d, 250);
    d.hotCue(0, false, false);
    expect(d.pos).toBe(5 * SR + 250);
  });

  it('turning SLIP off during a slip event keeps the current position', () => {
    const d = makeDeck({ slip: true });
    d.play();
    d.autoLoop(1);
    run(d, 700);
    d.set({ slip: false });
    d.reloopExit();
    expect(d.pos).toBe(FIRST + 200);
  });
});
