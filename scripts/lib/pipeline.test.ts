import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWaveform } from '../../src/shared/waveform';
import { buildTracks } from './pipeline';
import { synthTestTrack } from './synth';
import { encodeWav16 } from './wav';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('buildTracks', () => {
  it('builds audio, waveforms and a manifest', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-out-'));
    const { left, right } = synthTestTrack({ bpm: 120, rootHz: 55, bars: 2, sampleRate: 44100, leadInSec: 0.25, seed: 1 });
    writeFileSync(join(src, 'loop.wav'), encodeWav16([left, right], 44100));
    writeFileSync(
      join(src, 'tracks.json'),
      JSON.stringify({ tracks: [{ id: 'loop', title: 'Loop', artist: 'Test', file: 'loop.wav', bpm: 120, key: '8A', firstBeatSec: 0.25, surf: true }] }),
    );

    const manifest = await buildTracks({ sourceDir: src, outDir: out });
    const expectedDur = 0.25 + 2 * 4 * 0.5;
    const t = manifest.tracks[0]!;
    expect(t.durationSec).toBeCloseTo(expectedDur, 1);
    expect(t.sampleRate).toBe(44100);
    expect(t.audioUrl).toBe('/tracks/loop/audio.m4a');
    expect(t.artworkUrl).toBeNull();
    expect(t.surf).toBe(true);
    expect(existsSync(join(out, 'loop', 'audio.m4a'))).toBe(true);
    const wf = readFileSync(join(out, 'loop', 'waveform.bin'));
    const detail = decodeWaveform(wf.buffer.slice(wf.byteOffset, wf.byteOffset + wf.byteLength) as ArrayBuffer);
    expect(detail.binCount).toBe(Math.ceil(expectedDur * 150));
    const onDisk = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(onDisk.version).toBe(1);

    // Second run is incremental and still yields the same manifest.
    const logs: string[] = [];
    const again = await buildTracks({ sourceDir: src, outDir: out, log: (m) => logs.push(m) });
    expect(again).toEqual(manifest);
    expect(logs.some((l) => l.includes('up to date'))).toBe(true);
  }, 60_000);
});
