import { parseTrackSources } from '../../src/shared/tracks';

/**
 * Decide whether content/tracks holds real tracks. Only a missing file (ENOENT)
 * or an empty `tracks` array means "test"; malformed/invalid JSON throws.
 */
export function resolveTrackSource(readFile: (path: string) => string): 'real' | 'test' {
  const path = 'content/tracks/tracks.json';
  let text: string;
  try {
    text = readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'test';
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  try {
    return parseTrackSources(json).length > 0 ? 'real' : 'test';
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
}
