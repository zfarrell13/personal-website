import { describe, expect, it } from 'vitest';
import { FIRST, FPB, makeDeck, rampTrack, run, SR } from './testUtil';

describe('CUE state machine (CDJ manual)', () => {
  it('PAUSED away from cue + CUE down → sets the cue (quantized) and stays paused', () => {
    const d = makeDeck();
    d.seek((FIRST + 2 * FPB + 120) / SR); // 120 frames after beat 2
    d.cue(true);
    expect(d.cueFrame).toBe(FIRST + 2 * FPB);
    expect(d.pos).toBe(FIRST + 2 * FPB);
    expect(d.state).toBe('PAUSED');
    expect(d.drainEvents()).toEqual([{ kind: 'cue', sec: (FIRST + 2 * FPB) / SR }]);
    d.cue(false);
    expect(d.state).toBe('PAUSED');
  });

  it('without quantize the cue is set exactly where the playhead is', () => {
    const d = makeDeck({ quantize: false });
    d.seek(1.234);
    d.cue(true);
    expect(d.cueFrame).toBe(1234);
  });

  it('PAUSED at cue + CUE held → plays (preview); release → back to cue, paused', () => {
    const d = makeDeck();
    d.cue(true);
    expect(d.state).toBe('CUE_HOLD');
    run(d, 300);
    expect(d.pos).toBe(FIRST + 300);
    d.cue(false);
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST);
    expect(d.rate).toBe(0);
  });

  it('CUE held + PLAY → keeps playing after CUE is released', () => {
    const d = makeDeck();
    d.cue(true);
    run(d, 100);
    d.play();
    d.cue(false);
    expect(d.state).toBe('PLAYING');
    run(d, 100);
    expect(d.pos).toBe(FIRST + 200);
  });

  it('PLAYING + CUE → back cue: returns to the cue and pauses instantly', () => {
    const d = makeDeck();
    d.play();
    run(d, 2000);
    d.cue(true);
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST);
    run(d, 100);
    expect(d.pos).toBe(FIRST);
  });

  it('PAUSED + PLAY → plays; PLAYING + PLAY → pauses where it is', () => {
    const d = makeDeck();
    d.play();
    expect(d.state).toBe('PLAYING');
    run(d, 400);
    d.play();
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST + 400);
    expect(d.atCue).toBe(false);
  });

  it('pause, then CUE sets a new cue at the pause point (quantized)', () => {
    const d = makeDeck();
    d.play();
    run(d, 1010); // just past beat 2
    d.play();
    d.cue(true);
    expect(d.cueFrame).toBe(FIRST + 2 * FPB);
  });

  it('at the end, CUE returns to the cue point', () => {
    const d = makeDeck({}, rampTrack(3000));
    d.play();
    run(d, 3000);
    expect(d.ended).toBe(true);
    d.cue(true);
    expect(d.pos).toBe(FIRST);
    expect(d.ended).toBe(false);
  });
});

describe('hot cues', () => {
  it('an empty pad stores the quantized position and reports it', () => {
    const d = makeDeck();
    d.seek((FIRST + 4 * FPB + 200) / SR);
    d.hotCue(0, true, false);
    expect(d.hotCues[0]).toBe(FIRST + 4 * FPB);
    expect(d.drainEvents()).toEqual([{ kind: 'hotcue', index: 0, sec: (FIRST + 4 * FPB) / SR }]);
  });

  it('while playing, a stored pad jumps and keeps playing, preserving beat phase under quantize', () => {
    const d = makeDeck({}, rampTrack(60_000, { hotCuesSec: [(FIRST + 8 * FPB) / SR, null, null, null, null, null, null, null] }));
    d.play();
    run(d, 100); // 100 frames past beat 0
    d.hotCue(0, true, false);
    expect(d.state).toBe('PLAYING');
    expect(d.pos).toBe(FIRST + 8 * FPB + 100);
    d.hotCue(0, false, false);
    expect(d.state).toBe('PLAYING');
  });

  it('while paused, holding a pad previews from it and releasing returns and pauses', () => {
    const d = makeDeck({}, rampTrack(60_000, { hotCuesSec: [(FIRST + 8 * FPB) / SR, null, null, null, null, null, null, null] }));
    d.hotCue(0, true, false);
    expect(d.state).toBe('HOTCUE_HOLD');
    run(d, 200);
    expect(d.pos).toBe(FIRST + 8 * FPB + 200);
    d.hotCue(0, false, false);
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST + 8 * FPB);
  });

  it('hot cue held + PLAY continues playback', () => {
    const d = makeDeck({}, rampTrack(60_000, { hotCuesSec: [(FIRST + 8 * FPB) / SR, null, null, null, null, null, null, null] }));
    d.hotCue(0, true, false);
    d.play();
    d.hotCue(0, false, false);
    expect(d.state).toBe('PLAYING');
  });

  it('SHIFT + pad clears it', () => {
    const d = makeDeck();
    d.hotCue(3, true, false);
    d.drainEvents();
    d.hotCue(3, true, true);
    expect(Number.isNaN(d.hotCues[3]!)).toBe(true);
    expect(d.drainEvents()).toEqual([{ kind: 'hotcue', index: 3, sec: null }]);
  });
});

describe('memory cues (CALL)', () => {
  const mem = { memoryCuesSec: [(FIRST + 16 * FPB) / SR, (FIRST + 32 * FPB) / SR] };
  it('CALL ► / ◄ steps through memory cues and moves the paused playhead', () => {
    const d = makeDeck({}, rampTrack(60_000, mem));
    d.callMemoryCue(1);
    expect(d.cueFrame).toBe(FIRST + 16 * FPB);
    expect(d.pos).toBe(FIRST + 16 * FPB);
    d.callMemoryCue(1);
    expect(d.cueFrame).toBe(FIRST + 32 * FPB);
    d.callMemoryCue(1);
    expect(d.cueFrame).toBe(FIRST + 32 * FPB); // no further cue
    d.callMemoryCue(-1);
    expect(d.cueFrame).toBe(FIRST + 16 * FPB);
  });
  it('while playing, CALL only moves the cue point', () => {
    const d = makeDeck({}, rampTrack(60_000, mem));
    d.play();
    run(d, 100);
    d.callMemoryCue(1);
    expect(d.cueFrame).toBe(FIRST + 16 * FPB);
    expect(d.pos).toBe(FIRST + 100);
  });
});

describe('fix round 1 regressions', () => {
  it('CUE while the motor is still braking sets the cue and stops dead', () => {
    const d = makeDeck({ motorStopSec: 0.2 });
    d.play();
    run(d, 1000);
    d.play(); // pause: motor braking
    d.cue(true);
    const cue = d.cueFrame;
    run(d, 200);
    expect(d.pos).toBe(cue);
    expect(d.atCue).toBe(true);
  });

  it('reaching the end in CUE_HOLD returns to the cue on release', () => {
    const d = makeDeck({}, rampTrack(1000));
    d.cue(true);
    run(d, 800);
    expect(d.ended).toBe(true);
    expect(d.drainEvents()).toEqual([{ kind: 'ended' }]);
    d.cue(false);
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(FIRST);
    expect(d.ended).toBe(false);
  });

  it('reaching the end in HOTCUE_HOLD returns to the pad on release', () => {
    const d = makeDeck({}, rampTrack(1000, { hotCuesSec: [0.5, null, null, null, null, null, null, null] }));
    d.hotCue(0, true, false);
    run(d, 800);
    expect(d.ended).toBe(true);
    d.hotCue(0, false, false);
    expect(d.state).toBe('PAUSED');
    expect(d.pos).toBe(500);
  });

  it('load clears pending events; drainEvents with none is allocation-free', () => {
    const d = makeDeck();
    d.seek(1);
    d.cue(true);
    d.load(rampTrack());
    expect(d.drainEvents()).toEqual([]);
    expect(d.drainEvents()).toBe(d.drainEvents());
  });
});
