export type Mode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'zf-mode';

export const MODE_ROUTES: Record<Mode, '/surf' | '/dj'> = { light: '/surf', dark: '/dj' };

export function readMode(storage: Pick<Storage, 'getItem'> | null, prefersDark: boolean): Mode {
  try {
    const stored = storage?.getItem(MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // storage blocked (private mode, sandboxed iframe) — fall through
  }
  return prefersDark ? 'dark' : 'light';
}

export function writeMode(storage: Pick<Storage, 'setItem'> | null, mode: Mode): void {
  try {
    storage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // non-fatal: mode just won't persist
  }
}

export const otherMode = (mode: Mode): Mode => (mode === 'light' ? 'dark' : 'light');

export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}
