import { expect, test } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

test('audio engine: plays, syncs, key-locks and runs FX in a real browser', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/dev/dj-engine');
  await page.getByTestId('run-engine').click();
  await page.waitForFunction(() => window.__djEngine !== undefined, null, { timeout: 60_000 });
  const r = await page.evaluate(() => window.__djEngine!);
  expect('error' in r ? r.error : null).toBeNull();
  if ('error' in r) return;
  expect(r.mtAvailable).toBe(true);
  expect(r.latencySec).toBeGreaterThan(0);
  expect(r.latencySec).toBeLessThan(0.25);
  expect(r.deck1PosAfter1s).toBeGreaterThan(0.9); // started at the 0.25 s cue; polled for up to 5 s
  expect(r.master).toBe(0);
  expect(Math.abs(r.followerBpm - 120)).toBeLessThan(0.61); // synced to the 120 BPM master (±0.5 % trim)
  // Key lock: at +8 % the wet (stretched) path is engaged and the 220 Hz tone stays at 220 Hz (varispeed alone: 237.6 Hz).
  expect(r.mtWetAt8Pct).toBe(true);
  expect(Math.abs(r.tonePeakHzAt8Pct - 220)).toBeLessThan(4);
  expect(r.masterPeak).toBeGreaterThan(0.05);
  expect(r.events).toContain('0:hotcue');
  expect(r.spectrumMax).toBeGreaterThan(0);
  expect(errors()).toEqual([]);
});

test('mixer graph: XF assign, crossfader, isolator kill, limiter + soft clip (offline render)', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/dev/dj-engine');
  await page.getByTestId('run-graph').click();
  await page.waitForFunction(() => window.__djGraph !== undefined, null, { timeout: 60_000 });
  const r = await page.evaluate(() => window.__djGraph!);
  expect('error' in r ? r.error : null).toBeNull();
  if ('error' in r) return;
  // CH1 assigned to A: full at the A side, silent at the B side (constant-power curve).
  expect(r.assignA_xfA).toBeGreaterThan(0.2);
  expect(r.assignA_xfB).toBeLessThan(1e-3);
  // Assigned to B: the mirror image.
  expect(r.assignB_xfA).toBeLessThan(1e-3);
  expect(r.assignB_xfB).toBeGreaterThan(0.2);
  // THRU ignores the crossfader.
  expect(Math.abs(r.thru_xfA - r.thru_xfB)).toBeLessThan(0.01);
  expect(r.thru_xfA).toBeGreaterThan(0.2);
  // MASTER LEVEL 0 dB is unity: the limiter's automatic makeup gain is cancelled.
  expect(Math.abs(r.unityPeak - 0.25)).toBeLessThan(0.01);
  // Moving the Beat FX insert CH1 → MASTER mid-tone: no dropout, no level bump above +1 dB.
  expect(r.fxSwitchMinRatio).toBeGreaterThan(0.5);
  expect(r.fxSwitchMaxRatio).toBeLessThan(10 ** (1 / 20));
  // LOW kill takes a 40 Hz sine down by more than 60 dB (LR4 isolator, true kill).
  expect(r.lowKillDb).toBeLessThan(-60);
  // A +12 dBFS sine never leaves the master above the soft clip's ceiling (≈ 0.881).
  expect(r.hotPeak).toBeGreaterThan(0.5);
  expect(r.hotPeak).toBeLessThan(0.89);
  expect(errors()).toEqual([]);
});

for (const id of ['test-sunrise', 'test-tidal', 'test-midnight']) {
  test(`decoded ${id} puts the first kick within 5 ms of firstBeatSec`, async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/dev/dj-engine');
    const r = await page.evaluate(async (trackId) => {
      const manifest = (await (await fetch('/tracks-test/manifest.json')).json()) as {
        tracks: { id: string; audioUrl: string; firstBeatSec: number }[];
      };
      const t = manifest.tracks.find((x) => x.id === trackId)!;
      const ctx = new OfflineAudioContext(2, 1, 48000);
      const buf = await ctx.decodeAudioData(await (await fetch(t.audioUrl)).arrayBuffer());
      const d = buf.getChannelData(0);
      const end = Math.min(d.length, buf.sampleRate * 2);
      let onset = -1;
      for (let i = 0; i < end; i++) {
        if (Math.abs(d[i]!) > 0.02) {
          onset = i;
          break;
        }
      }
      return { onsetSec: onset / buf.sampleRate, firstBeatSec: t.firstBeatSec };
    }, id);
    expect(r.firstBeatSec).toBe(0.25);
    expect(Math.abs(r.onsetSec - r.firstBeatSec)).toBeLessThan(0.005);
    expect(errors()).toEqual([]);
  });
}
