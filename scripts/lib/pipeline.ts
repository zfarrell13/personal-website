import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrackSources, type TrackEntry, type TrackManifest } from '../../src/shared/tracks';
import { encodeWaveform } from '../../src/shared/waveform';
import { analyzeWaveform } from './analyze';

const ANALYSIS_RATE = 44100;

interface Meta {
  sourceMtimeMs: number;
  durationSec: number;
  sampleRate: number;
}

function ffprobeSampleRate(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]);
  const rate = parseInt(out.toString().trim(), 10);
  if (!Number.isFinite(rate)) throw new Error(`ffprobe could not read sample rate of ${file}`);
  return rate;
}

function decodeMono(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  const aligned = new Uint8Array(raw); // copy: Buffer offsets aren't guaranteed 4-byte aligned
  return new Float32Array(aligned.buffer, 0, aligned.byteLength >> 2);
}

export async function buildTracks(opts: {
  sourceDir: string;
  outDir: string;
  urlPrefix?: string;
  log?: (msg: string) => void;
}): Promise<TrackManifest> {
  const { sourceDir, outDir, urlPrefix = '/tracks', log = console.log } = opts;
  const sources = parseTrackSources(JSON.parse(readFileSync(join(sourceDir, 'tracks.json'), 'utf8')));
  mkdirSync(outDir, { recursive: true });
  const tracks: TrackEntry[] = [];

  for (const s of sources) {
    const srcFile = join(sourceDir, s.file);
    if (!existsSync(srcFile)) throw new Error(`Track "${s.id}": missing audio file ${srcFile}`);
    const dir = join(outDir, s.id);
    mkdirSync(dir, { recursive: true });
    const mtime = statSync(srcFile).mtimeMs;
    const metaPath = join(dir, 'meta.json');
    let meta: Meta | null = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as Meta) : null;
    const fresh =
      meta?.sourceMtimeMs === mtime && ['audio.m4a', 'waveform.bin', 'overview.bin'].every((f) => existsSync(join(dir, f)));

    if (fresh) {
      log(`• ${s.id}: up to date`);
    } else {
      log(`• ${s.id}: encoding + analyzing…`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', srcFile, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', join(dir, 'audio.m4a')]);
      const mono = decodeMono(srcFile);
      const { detail, overview } = analyzeWaveform(mono, ANALYSIS_RATE);
      writeFileSync(join(dir, 'waveform.bin'), encodeWaveform(detail));
      writeFileSync(join(dir, 'overview.bin'), encodeWaveform(overview));
      meta = { sourceMtimeMs: mtime, durationSec: mono.length / ANALYSIS_RATE, sampleRate: ffprobeSampleRate(srcFile) };
      writeFileSync(metaPath, JSON.stringify(meta));
    }

    let artworkUrl: string | null = null;
    let artworkSmallUrl: string | null = null;
    if (s.artwork) {
      const art = join(sourceDir, s.artwork);
      if (!existsSync(art)) throw new Error(`Track "${s.id}": missing artwork ${art}`);
      const big = join(dir, 'artwork.jpg');
      const small = join(dir, 'artwork-128.jpg');
      if (!fresh || !existsSync(big) || statSync(big).mtimeMs < statSync(art).mtimeMs) {
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', art, '-vf', 'scale=500:500', '-q:v', '3', big]);
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', art, '-vf', 'scale=128:128', '-q:v', '4', small]);
      }
      artworkUrl = `${urlPrefix}/${s.id}/artwork.jpg`;
      artworkSmallUrl = `${urlPrefix}/${s.id}/artwork-128.jpg`;
    }

    tracks.push({
      id: s.id,
      title: s.title,
      artist: s.artist,
      bpm: s.bpm,
      key: s.key,
      firstBeatSec: s.firstBeatSec,
      memoryCues: s.memoryCues ?? [],
      surf: s.surf ?? false,
      durationSec: meta!.durationSec,
      sampleRate: meta!.sampleRate,
      audioUrl: `${urlPrefix}/${s.id}/audio.m4a`,
      artworkUrl,
      artworkSmallUrl,
      waveformUrl: `${urlPrefix}/${s.id}/waveform.bin`,
      overviewUrl: `${urlPrefix}/${s.id}/overview.bin`,
    });
  }

  const manifest: TrackManifest = { version: 1, tracks };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
