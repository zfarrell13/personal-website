export const GUIDE_KEY = 'zf-surf-guide';

/** The GUIDE option; on unless the player turned it off (and storage works). */
export function loadGuide(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(GUIDE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveGuide(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(GUIDE_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked — the choice just won't persist
  }
}
