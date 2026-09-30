/** The home title menu: the site's sections, in menu order (FREE SURF first and pre-selected). */
export interface MenuItem {
  id: 'surf' | 'profile' | 'career' | 'trophies' | 'credits';
  label: string;
  href: string;
}

export const MENU: readonly MenuItem[] = [
  { id: 'surf', label: 'FREE SURF', href: '/surf' },
  { id: 'profile', label: 'RIDER PROFILE', href: '/profile' },
  { id: 'career', label: 'CAREER MODE', href: '/career' },
  { id: 'trophies', label: 'TROPHY ROOM', href: '/trophies' },
  { id: 'credits', label: 'CREDITS', href: '/credits' },
];

export const DEFAULT_INDEX = 0;

/** One step up or down a list of `n` items, wrapping at both ends. */
export function moveIndex(i: number, delta: -1 | 1, n = MENU.length): number {
  return (((i + delta) % n) + n) % n;
}
