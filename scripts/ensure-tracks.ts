import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildTracks } from './lib/pipeline';
import { resolveTrackSource } from './lib/resolveTrackSource';
import { makeTestTracks } from './make-test-tracks';

const REAL = 'content/tracks';
const TEST = 'content/tracks-test';
const OUT = 'public/tracks';

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('✖ ffmpeg is required to build tracks. Install it (macOS: `brew install ffmpeg`) and retry.');
  process.exit(1);
}

let source: 'real' | 'test';
try {
  source = resolveTrackSource((p) => readFileSync(p, 'utf8'));
} catch (e) {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
}

if (source === 'real') {
  await buildTracks({ sourceDir: REAL, outDir: OUT });
} else {
  if (!existsSync(`${TEST}/tracks.json`)) {
    console.log('No tracks in content/tracks yet — synthesizing placeholder tracks…');
    await makeTestTracks(TEST);
  }
  await buildTracks({ sourceDir: TEST, outDir: OUT });
}
