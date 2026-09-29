import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { synthTestTrack } from './lib/synth';
import { encodeWav16 } from './lib/wav';

export const TEST_TRACKS = [
  { id: 'test-sunrise', title: 'Sunrise (Test 120)', bpm: 120, key: '8A', rootHz: 55, color: '0xff8a3d' },
  { id: 'test-tidal', title: 'Tidal (Test 124)', bpm: 124, key: '5A', rootHz: 65.41, color: '0x2ec4b6' },
  { id: 'test-midnight', title: 'Midnight (Test 128)', bpm: 128, key: '1A', rootHz: 51.91, color: '0x7b2ff7' },
] as const;

const SAMPLE_RATE = 44100;
const LEAD_IN = 0.25;
const BARS = 96;

export async function makeTestTracks(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  TEST_TRACKS.forEach((t, i) => {
    const { left, right } = synthTestTrack({ bpm: t.bpm, rootHz: t.rootHz, bars: BARS, sampleRate: SAMPLE_RATE, leadInSec: LEAD_IN, seed: i + 1 });
    writeFileSync(join(dir, `${t.id}.wav`), encodeWav16([left, right], SAMPLE_RATE));
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${t.color}:s=500x500`, '-frames:v', '1', join(dir, `${t.id}.jpg`)]);
  });
  const tracks = TEST_TRACKS.map((t) => ({
    id: t.id,
    title: t.title,
    artist: 'ZF Test Signal',
    file: `${t.id}.wav`,
    artwork: `${t.id}.jpg`,
    bpm: t.bpm,
    key: t.key,
    firstBeatSec: LEAD_IN,
    memoryCues: [64],
    surf: true,
  }));
  writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'content/tracks-test';
  await makeTestTracks(dir);
  console.log(`Wrote ${TEST_TRACKS.length} test tracks to ${dir}`);
}
