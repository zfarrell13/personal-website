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
    expect(Math.abs(sync.trim[1])).toBeLessThan(0.005);
  });

  it('the PLL pulls a 5 ms error below 1 ms within 2 s and holds it for 10 minutes', () => {
    const { decks, sync, step, errMs } = setup(124, 120, 3.37);
    decks[0].play();
    step(0.2);
    sync.setSync(decks, 1, true);
    decks[1].play();
    step(0.2);
    decks[1].seek(decks[1].pos / SR - 0.005 * (decks[1].rate)); // knock the follower 5 ms behind
    expect(errMs()).toBeGreaterThan(4);
    step(2);
    expect(errMs()).toBeLessThan(1);
    let worst = 0;
    step(600, () => {
      worst = Math.max(worst, errMs());
    });
    expect(worst).toBeLessThan(1);
    expect(Math.abs(sync.trim[1])).toBeLessThanOrEqual(0.005);
  }, 60_000);

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
});
