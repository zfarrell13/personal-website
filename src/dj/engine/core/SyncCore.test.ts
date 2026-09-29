import { describe, expect, it } from 'vitest';
import { DeckCore, type DeckTrackData } from './DeckCore';
import { SyncCore } from './SyncCore';

const SR = 8000;
/** One shared silent buffer, 11 minutes long — positions are what matter here. */
const PCM = new Float32Array(SR * 60 * 11);
const track = (bpm: number): DeckTrackData => ({
  left: PCM,
  right: PCM,
  bpm,
  firstBeatSec: 0.25,
  memoryCuesSec: [],
  hotCuesSec: Array(8).fill(null),
});

function countSeeks(d: DeckCore): { count: number } {
  const c = { count: 0 };
  const orig = d.seek.bind(d);
  d.seek = (sec: number) => {
    c.count++;
    orig(sec);
  };
  return c;
}

function setup(masterBpm = 124, followerBpm = 120, masterTempoPct = 0) {
  const decks = [new DeckCore(SR), new DeckCore(SR)] as const;
  decks[0].set({ motorStartSec: 0, motorStopSec: 0, tempoPct: masterTempoPct });
  decks[1].set({ motorStartSec: 0, motorStopSec: 0 });
  decks[0].load(track(masterBpm));
  decks[1].load(track(followerBpm));
  const sync = new SyncCore(SR);
  const L = new Float32Array(128);
  const R = new Float32Array(128);
  const step = (seconds: number, onBlock?: () => void) => {
    const blocks = Math.round((seconds * SR) / 128);
    for (let b = 0; b < blocks; b++) {
      sync.update(decks, 128);
      decks[0].render(L, R, 0, 128);
      decks[1].render(L, R, 0, 128);
      onBlock?.();
    }
  };
  const errMs = () => (Math.abs(sync.phaseErrorBeats(decks, 1)) * 60_000) / (decks[0].bpm * decks[0].tempoRate);
  return { decks, sync, step, errMs };
}

describe('SyncCore', () => {
  it('picks the first playing deck as master automatically', () => {
    const { decks, sync, step } = setup();
    decks[1].play();
    step(0.1);
    expect(sync.master).toBe(1);
    decks[0].play();
    step(0.1);
    expect(sync.master).toBe(1);
  });

  it('hands master over when the master stops and the other deck plays', () => {
    const { decks, sync, step } = setup();
    decks[0].play();
    step(0.1);
    decks[1].play();
    decks[0].play(); // pause master
    step(0.1);
    expect(sync.master).toBe(1);
  });

  it('SYNC matches the follower tempo to the master BPM', () => {
    const { decks, sync, step } = setup(124, 120, 2);
    decks[0].play();
    step(0.1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    const followerBpm = decks[1].bpm * decks[1].rate;
    expect(followerBpm).toBeCloseTo(124 * 1.02, 0);
    expect(Math.abs(followerBpm / (124 * 1.02) - 1)).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it('aligns beat phase when the synced follower starts', () => {
    const { decks, sync, step, errMs } = setup();
    decks[0].play();
    step(1.37);
    sync.setSync(decks, 1, true);
    decks[1].seek(10.1);
    decks[1].play();
    step(256 / SR); // aligned on the first block where both run at full motor speed
    expect(errMs()).toBeLessThan(1);
  });

  it('aligns beat phase when SYNC is pressed while both play', () => {
    const { decks, sync, step, errMs } = setup();
    decks[0].play();
    decks[1].seek(3.33);
    decks[1].play();
    step(0.5);
    sync.setSync(decks, 1, true);
    step(128 / SR);
    expect(errMs()).toBeLessThan(1);
  });

  it('is in phase after the motors spin up (vinyl start time)', () => {
    const { decks, sync, step, errMs } = setup();
    decks[0].set({ motorStartSec: 0.3 });
    decks[1].set({ motorStartSec: 0.3 });
    decks[0].play();
    step(1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(0.5);
    expect(errMs()).toBeLessThan(1);
    expect(Math.abs(sync.trim[1])).toBeLessThan(0.001);
  });

  it('the PLL pulls a 5 ms error below 1 ms within 2 s and holds it for 10 minutes against real drift', () => {
    const { decks, sync, step, errMs } = setup(124, 120, 3.37);
    decks[0].play();
    step(0.2);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(0.2);
    decks[1].seek(decks[1].pos / SR - 0.005 * decks[1].rate); // knock the follower 5 ms behind
    expect(errMs()).toBeGreaterThan(4);
    step(2);
    expect(errMs()).toBeLessThan(1);
    // Drift source: the follower's playhead creeps 0.01 % faster than its commanded rate.
    const BIAS = 1e-4;
    const seeks = countSeeks(decks[1]);
    let worst = 0;
    let worstTrim = 0;
    let t = 0;
    let tempoChanged = false;
    step(600, () => {
      decks[1].pos += 128 * BIAS * decks[1].rate;
      t += 128 / SR;
      if (t > 300 && !tempoChanged) {
        tempoChanged = true;
        decks[0].set({ tempoPct: 4.1 }); // master tempo change mid-run
      }
      worst = Math.max(worst, errMs());
      worstTrim = Math.max(worstTrim, Math.abs(sync.trim[1]));
    });
    expect(worst).toBeLessThan(1);
    expect(seeks.count).toBe(0);
    expect(worstTrim).toBeLessThanOrEqual(0.005);
    expect(Math.abs(sync.trim[1] + BIAS)).toBeLessThan(BIAS * 0.1);
  }, 60_000);

  it('an unsynced follower with a 0.01 % tempo error would drift over 1 ms in 10 minutes', () => {
    const { decks, step } = setup(120, 120);
    decks[1].set({ tempoPct: 0.01 });
    decks[0].play();
    decks[1].play();
    step(1);
    const e0 = decks[0].beat - decks[1].beat;
    step(600);
    const drift = (Math.abs(decks[0].beat - decks[1].beat - e0) * 60_000) / 120;
    expect(drift).toBeGreaterThan(1);
  }, 60_000);

  it('realigns a synced follower right after a jump', () => {
    const { decks, sync, step, errMs } = setup(128, 120);
    decks[0].play();
    step(0.1); // deck 0 becomes master
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    expect(errMs()).toBeLessThan(1);
    decks[1].seek(decks[1].pos / SR + 0.2);
    expect(errMs()).toBeGreaterThan(10);
    step(0.05);
    expect(errMs()).toBeLessThan(1);
  });

  it('realigns after the master exits a sub-beat loop', () => {
    const { decks, sync, step, errMs } = setup(120, 120);
    decks[0].play();
    step(0.1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    decks[0].autoLoop(1 / 4);
    step(1.3);
    decks[0].reloopExit();
    step(0.05);
    expect(errMs()).toBeLessThan(1);
  });

  it('keeps the slip shadow playhead consistent when SYNC realigns the follower', () => {
    const { decks, sync, step } = setup(120, 120);
    decks[1].set({ slip: true });
    decks[0].play();
    step(0.1);
    decks[1].seek(5.1);
    decks[1].play();
    step(0.5);
    decks[1].autoLoop(4); // slip loop: the shadow keeps running while the playhead loops
    step(0.7);
    expect(decks[1].slipFlags).not.toBe(0);
    decks[1].pos += 500; // knock the follower off the grid
    const lead = decks[1].shadowPos - decks[1].pos;
    const p0 = decks[1].pos;
    sync.alignPhase(decks[0], decks[1]);
    expect(Math.abs(decks[1].pos - p0)).toBeGreaterThan(1);
    expect(decks[1].shadowPos - decks[1].pos).toBeCloseTo(lead, 6);
  });

  it('turning SYNC off releases the follower to its own tempo', () => {
    const { decks, sync, step } = setup();
    decks[0].play();
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(0.5);
    sync.setSync(decks, 1, false);
    step(0.1);
    expect(decks[1].rate).toBe(1);
  });

  it('does not re-jump a synced follower while it is pitch-bent, and snaps back once when the bend ends', () => {
    const { decks, sync, step, errMs } = setup(120, 120);
    decks[0].play();
    step(0.1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    const seeks = countSeeks(decks[1]);
    decks[1].jog(false, 0.5, true);
    step(1);
    expect(seeks.count).toBe(0);
    decks[1].jog(false, 0, true);
    step(0.5);
    expect(seeks.count).toBeLessThanOrEqual(1);
    expect(errMs()).toBeLessThan(1);
  });

  it('does not re-jump the follower while the master is pitch-bent, and snaps back once when the bend ends', () => {
    const { decks, sync, step, errMs } = setup(120, 120);
    decks[0].play();
    step(0.1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    const seeks = countSeeks(decks[1]);
    decks[0].jog(false, 0.5, true);
    step(1);
    expect(seeks.count).toBe(0);
    decks[0].jog(false, 0, true);
    step(0.5);
    expect(seeks.count).toBeLessThanOrEqual(1);
    expect(errMs()).toBeLessThan(1);
  });

  it('does not re-jump every cycle of a manual non-integer loop', () => {
    const { decks, sync, step } = setup(120, 120);
    decks[0].set({ quantize: false });
    decks[0].play();
    step(0.1);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(1);
    decks[0].loopInPress();
    const seeks = countSeeks(decks[1]);
    step(0.688); // loop out after ~1.376 beats (0.688 s at 120 BPM)
    decks[0].loopOutPress();
    step(5);
    expect(seeks.count).toBeLessThanOrEqual(1);
  });
});
