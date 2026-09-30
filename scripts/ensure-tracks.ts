import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseTrackSources } from '../src/shared/tracks';
import { missingTracksPolicy } from './lib/missingTracks';
import { buildTracks } from './lib/pipeline';
import { resolveTrackSource } from './lib/resolveTrackSource';
import { makeTestTracks } from './make-test-tracks';

const REAL = 'content/tracks';
const TEST = 'content/tracks-test';
const OUT = 'public/tracks';
/** The test tracks are always built here too (`?tracks=test`, used by the e2e suite). */
const TEST_OUT = 'public/tracks-test';

let source: 'real' | 'test';
try {
  source = resolveTrackSource((p) => readFileSync(p, 'utf8'));
} catch (e) {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
}

// Real audio is git-ignored: a fresh clone or CI build has the manifest but not the files.
const missing = source === 'real' ? parseTrackSources(JSON.parse(readFileSync(`${REAL}/tracks.json`, 'utf8'))).filter((t) => !existsSync(`${REAL}/${t.file}`)).map((t) => t.file) : [];
const policy = missingTracksPolicy(missing, process.env);
if (policy.action === 'fail') {
  console.error(`✖ ${policy.message}`);
  process.exit(1);
}
if (policy.action === 'placeholder') console.warn(`⚠ ${policy.message}`);

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('✖ ffmpeg is required to build tracks. Install it (macOS: `brew install ffmpeg`) and retry.');
  process.exit(1);
}

if (!existsSync(`${TEST}/tracks.json`)) {
  console.log('Synthesizing placeholder test tracks…');
  await makeTestTracks(TEST);
}
await buildTracks({ sourceDir: TEST, outDir: TEST_OUT, urlPrefix: '/tracks-test' });
if (source === 'real' && policy.action === 'real') await buildTracks({ sourceDir: REAL, outDir: OUT });
else await buildTracks({ sourceDir: TEST, outDir: OUT });
