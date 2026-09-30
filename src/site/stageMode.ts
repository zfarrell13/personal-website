/** What the persistent surf stage does on a route: `/surf` (and under it) is the game, everywhere else the attract loop. */
export type StageMode = 'play' | 'attract';

export function stageModeFor(pathname: string): StageMode {
  const path = pathOf(pathname);
  return path === '/surf' || path.startsWith('/surf/') ? 'play' : 'attract';
}

/** The section screens: an opaque panel covers almost all of the wave, so it needs few frames. */
const SECTIONS = new Set(['/profile', '/career', '/trophies', '/credits']);

/** The attract loop's frame cap on a route: 12 fps behind a section screen, 30 elsewhere (the title menu). */
export function attractFpsFor(pathname: string): number {
  const path = pathOf(pathname);
  return SECTIONS.has(path.length > 1 ? path.replace(/\/$/, '') : path) ? 12 : 30;
}

function pathOf(pathname: string): string {
  return pathname.split(/[?#]/)[0]!;
}
