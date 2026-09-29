import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildTracks } from './lib/pipeline';
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

const hasReal = (() => {
  try {
    const json = JSON.parse(readFileSync(`${REAL}/tracks.json`, 'utf8')) as { tracks?: unknown[] };
    return Array.isArray(json.tracks) && json.tracks.length > 0;
  } catch {
    return false;
  }
})();

if (hasReal) {
  await buildTracks({ sourceDir: REAL, outDir: OUT });
} else {
  if (!existsSync(`${TEST}/tracks.json`)) {
    console.log('No tracks in content/tracks yet — synthesizing placeholder tracks…');
    await makeTestTracks(TEST);
  }
  await buildTracks({ sourceDir: TEST, outDir: OUT });
}
