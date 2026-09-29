import { buildTracks } from './lib/pipeline';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const sourceDir = arg('source', 'content/tracks');
const outDir = arg('out', 'public/tracks');
const manifest = await buildTracks({ sourceDir, outDir });
console.log(`Built ${manifest.tracks.length} track(s) → ${outDir}`);
