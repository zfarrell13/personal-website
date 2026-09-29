import { describe, expect, it } from 'vitest';
import { DeckCore } from './DeckCore';
import { FIRST, FPB, makeDeck, rampTrack, run, SR } from './testUtil';

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

describe('fix round 1', () => {
  it('slip pause -> CUE set -> CUE preview -> PLAY leaves no stale slip flag; loop exit returns correctly', () => {
    const d = makeDeck({ slip: true });
    d.play();
    run(d, 100);
    d.play(); // slip pause
    run(d, 50);
    d.cue(true); // set new cue (pos is off the cue point)
    d.cue(false);
    d.cue(true); // preview
    d.play();
    expect(d.state).toBe('PLAYING');
    expect(d.slipFlags).toBe(0);
    const loopStart = Math.floor(d.pos);
    d.autoLoop(1);
    run(d, 3 * FPB + 7);
    d.reloopExit();
    expect(d.pos).toBe(loopStart + 3 * FPB + 7);
  });

  it('hot cue hold while slip-paused, then PLAY, clears the pause slip', () => {
    const d = makeDeck({ slip: true });
    d.seek(20);
    d.hotCue(0, true, false);
    d.hotCue(0, false, false);
    d.seek(5);
    d.play();
    run(d, 100);
    d.play(); // slip pause
    d.hotCue(0, true, false); // paused -> HOTCUE_HOLD
    d.play();
    expect(d.slipFlags).toBe(0);
  });

  it('CALL while slip-paused discards the shadow: PLAY continues from the cue', () => {
    const d = makeDeck({ slip: true }, rampTrack(60_000, { memoryCuesSec: [10] }));
    d.play();
    run(d, 100);
    d.play();
    run(d, 50);
    d.callMemoryCue(1);
    d.play();
    expect(d.pos).toBe(10 * SR);
  });

  it('beat jump never moves the loop off the track', () => {
    const d = makeDeck({ beatJumpBeats: 64 });
    d.play();
    d.autoLoop(2);
    const len = d.loopOut - d.loopIn;
    d.beatJump(-1);
    expect(d.loopIn).toBeGreaterThanOrEqual(0);
    expect(d.loopOut - d.loopIn).toBe(len);
    d.beatJump(1);
    d.beatJump(1);
    d.beatJump(1);
    expect(d.loopOut).toBeLessThanOrEqual(d.length);
    expect(d.loopOut - d.loopIn).toBe(len);
  });

  it('quantized LOOP OUT respects the quantize resolution like LOOP IN', () => {
    const d = makeDeck({ quantizeBeats: 4 });
    d.play();
    d.loopInPress();
    run(d, Math.round(1.2 * FPB));
    d.loopOutPress();
    expect(d.loopOut - d.loopIn).toBe(4 * FPB);
  });

  it('scaleLoop is a no-op on an unloaded deck', () => {
    const d = new DeckCore(SR);
    expect(() => d.scaleLoop(2)).not.toThrow();
  });
});

describe('final review: targets outside an active loop leave it', () => {
  /** Playing deck with an active 2-beat loop starting at FIRST (frames 250..1250). */
  function looping(track = rampTrack()): DeckCore {
    const d = makeDeck({}, track);
    d.play();
    d.autoLoop(2);
    run(d, 100);
    return d;
  }

  it('render only wraps when the playhead crosses the out point from inside the loop', () => {
    const d = looping();
    d.pos = 30_000; // past the loop, loop still active
    run(d, 100);
    expect(d.pos).toBe(30_100);
    d.set({ reverse: true });
    d.pos = 100; // before the loop, moving backward
    run(d, 50);
    expect(d.pos).toBe(50);
  });

  it('reverse still wraps when crossing the in point from inside', () => {
    const d = looping();
    d.set({ reverse: true });
    const posBefore = d.pos; // FIRST + 100
    run(d, 150);
    expect(d.pos).toBe(posBefore - 150 + 2 * FPB);
  });

  it('needle search past the loop exits it and keeps playing from there', () => {
    const d = looping();
    d.seek(30);
    expect(d.loopActive).toBe(false);
    run(d, 100);
    expect(d.pos).toBe(30 * SR + 100);
  });

  it('needle search inside the loop keeps it active', () => {
    const d = looping();
    d.seek((FIRST + FPB) / SR);
    expect(d.loopActive).toBe(true);
  });

  it('back-CUE to a cue point outside the loop exits it; PLAY resumes from the cue', () => {
    const d = makeDeck();
    d.seek(35);
    d.cue(true); // paused off-cue → sets cue at 35 s (on a beat)
    d.cue(false);
    const cue = d.cueFrame;
    d.seek(0.25);
    d.play();
    d.autoLoop(2);
    run(d, 100);
    d.cue(true); // back cue
    expect(d.loopActive).toBe(false);
    d.cue(false);
    d.play();
    run(d, 30);
    expect(d.pos).toBe(cue + 30);
  });

  it('paused hot-cue preview of a cue past the loop exits it', () => {
    const d = makeDeck();
    d.seek(40);
    d.hotCue(0, true, false); // store
    d.hotCue(0, false, false);
    const stored = d.hotCues[0]!;
    d.seek(0.25);
    d.play();
    d.autoLoop(2);
    run(d, 100);
    d.play(); // pause, loop still active
    expect(d.loopActive).toBe(true);
    d.hotCue(0, true, false); // preview from the stored point
    expect(d.loopActive).toBe(false);
    run(d, 30);
    expect(d.pos).toBe(stored + 30);
    d.play(); // hot cue + PLAY keeps playing
    d.hotCue(0, false, false);
    run(d, 30);
    expect(d.pos).toBe(stored + 60);
  });

  it('CALL to a memory cue past the loop (paused) exits it', () => {
    const d = looping(rampTrack(60_000, { memoryCuesSec: [30] }));
    d.play(); // pause
    d.callMemoryCue(1);
    expect(d.loopActive).toBe(false);
    d.play();
    run(d, 30);
    expect(d.pos).toBe(30 * SR + 30);
  });
});
