/** First-visit memory for the guide. Storage may be missing or throw (private mode): the guide then just opens. */
export const GUIDE_STORAGE_KEY = 'dj.guide';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

/** Open by itself on the first visit, unless the URL says `?guide=off` (automated tests). */
export function shouldAutoOpen(storage: Store, search: string): boolean {
  if (new URLSearchParams(search).get('guide') === 'off') return false;
  try {
    return storage?.getItem(GUIDE_STORAGE_KEY) == null;
  } catch {
    return true;
  }
}

export function rememberGuide(storage: Store, outcome: 'dismissed' | 'done'): void {
  try {
    storage?.setItem(GUIDE_STORAGE_KEY, outcome);
  } catch {
    // no storage: the guide opens again next visit
  }
}
