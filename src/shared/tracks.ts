export interface TrackSource {
  id: string;
  title: string;
  artist: string;
  file: string;
  artwork?: string;
  bpm: number;
  key: string;
  firstBeatSec: number;
  memoryCues?: number[];
  surf?: boolean;
}

export interface TrackEntry {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  firstBeatSec: number;
  memoryCues: number[];
  surf: boolean;
  durationSec: number;
  sampleRate: number;
  audioUrl: string;
  artworkUrl: string | null;
  artworkSmallUrl: string | null;
  waveformUrl: string;
  overviewUrl: string;
}

export interface TrackManifest {
  version: 1;
  tracks: TrackEntry[];
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAMELOT_RE = /^(1[0-2]|[1-9])[AB]$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid tracks.json: ${path} ${problem}`);
};
const str = (o: Obj, k: string, path: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${k}`, 'must be a non-empty string');
  return v as string;
};
const num = (o: Obj, k: string, path: string, min: number, exclusive = false): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || (exclusive ? v <= min : v < min)) {
    fail(`${path}.${k}`, `must be a number ${exclusive ? '>' : '>='} ${min}`);
  }
  return v as number;
};

export function parseTrackSources(json: unknown): TrackSource[] {
  if (!isObj(json) || !Array.isArray(json.tracks)) fail('tracks', 'must be an array');
  const seen = new Set<string>();
  return ((json as Obj).tracks as unknown[]).map((raw, i) => {
    const path = `tracks[${i}]`;
    if (!isObj(raw)) fail(path, 'must be an object');
    const o = raw as Obj;
    const id = str(o, 'id', path);
    if (!ID_RE.test(id)) fail(`${path}.id`, 'must be kebab-case');
    if (seen.has(id)) fail(`${path}.id`, `duplicate id "${id}"`);
    seen.add(id);
    const key = str(o, 'key', path);
    if (!CAMELOT_RE.test(key)) fail(`${path}.key`, 'must be Camelot notation like 8A');
    const memoryCues = o.memoryCues ?? [];
    if (!Array.isArray(memoryCues) || memoryCues.some((c) => typeof c !== 'number' || c < 0)) {
      fail(`${path}.memoryCues`, 'must be an array of beat numbers >= 0');
    }
    if (o.artwork !== undefined && typeof o.artwork !== 'string') fail(`${path}.artwork`, 'must be a string');
    return {
      id,
      title: str(o, 'title', path),
      artist: str(o, 'artist', path),
      file: str(o, 'file', path),
      artwork: o.artwork as string | undefined,
      bpm: num(o, 'bpm', path, 0, true),
      key,
      firstBeatSec: num(o, 'firstBeatSec', path, 0),
      memoryCues: memoryCues as number[],
      surf: o.surf === true,
    };
  });
}

export function parseManifest(json: unknown): TrackManifest {
  if (!isObj(json) || json.version !== 1) throw new Error('Invalid manifest: version must be 1');
  if (!Array.isArray(json.tracks)) throw new Error('Invalid manifest: tracks must be an array');
  for (const [i, t] of (json.tracks as unknown[]).entries()) {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.bpm !== 'number' || typeof t.audioUrl !== 'string') {
      throw new Error(`Invalid manifest: tracks[${i}] is malformed`);
    }
  }
  return json as unknown as TrackManifest;
}

export async function loadManifest(fetchFn: typeof fetch = fetch, url = '/tracks/manifest.json'): Promise<TrackManifest> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load track manifest: HTTP ${res.status}`);
  return parseManifest(await res.json());
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

export function beatTimeSec(t: Pick<TrackEntry, 'bpm' | 'firstBeatSec'>, beat: number): number {
  return t.firstBeatSec + beat * secondsPerBeat(t.bpm);
}

export function beatAtTime(t: Pick<TrackEntry, 'bpm' | 'firstBeatSec'>, sec: number): number {
  return (sec - t.firstBeatSec) / secondsPerBeat(t.bpm);
}
