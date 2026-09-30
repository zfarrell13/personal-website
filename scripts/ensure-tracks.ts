import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildTracks } from './lib/pipeline';
import { resolveTrackSource } from './lib/resolveTrackSource';
import { makeTestTracks } from './make-test-tracks';

const REAL = 'content/tracks';
const TEST = 'content/tracks-test';
const OUT = 'public/tracks';
/** The test tracks are always built here too (`?tracks=test`, used by the e2e suite). */
const TEST_OUT = 'public/tracks-test';

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

if (!existsSync(`${TEST}/tracks.json`)) {
  console.log('Synthesizing placeholder test tracks…');
  await makeTestTracks(TEST);
}
await buildTracks({ sourceDir: TEST, outDir: TEST_OUT, urlPrefix: '/tracks-test' });
if (source === 'real') await buildTracks({ sourceDir: REAL, outDir: OUT });
else await buildTracks({ sourceDir: TEST, outDir: OUT });
