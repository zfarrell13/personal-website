/** What the persistent surf stage does on a route: `/surf` (and under it) is the game, everywhere else the attract loop. */
export type StageMode = 'play' | 'attract';

export function stageModeFor(pathname: string): StageMode {
  const path = pathname.split(/[?#]/)[0]!;
  return path === '/surf' || path.startsWith('/surf/') ? 'play' : 'attract';
}
