import { HOT_CUE_COUNT } from '../constants';

export interface StoredHotCue {
  sec: number;
  color: string;
}
export type HotCueSlots = (StoredHotCue | null)[];

export const hotCueKey = (trackId: string) => `zf-dj-hotcues:${trackId}`;
export const emptySlots = (): HotCueSlots => Array.from({ length: HOT_CUE_COUNT }, () => null);

/** localStorage, or null when the accessor throws (SecurityError) or there is none. */
export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadHotCues(storage: Pick<Storage, 'getItem'> | null, trackId: string): HotCueSlots {
  try {
    const raw = storage?.getItem(hotCueKey(trackId));
    if (!raw) return emptySlots();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return emptySlots();
    return emptySlots().map((_, i) => {
      const v = parsed[i] as unknown;
      if (v && typeof v === 'object' && typeof (v as StoredHotCue).sec === 'number' && typeof (v as StoredHotCue).color === 'string') {
        return { sec: (v as StoredHotCue).sec, color: (v as StoredHotCue).color };
      }
      return null;
    });
  } catch {
    return emptySlots();
  }
}

export function saveHotCues(storage: Pick<Storage, 'setItem'> | null, trackId: string, slots: HotCueSlots): void {
  try {
    storage?.setItem(hotCueKey(trackId), JSON.stringify(slots));
  } catch {
    // quota / privacy mode — hot cues still live in memory
  }
}
