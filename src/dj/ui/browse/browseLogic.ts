import type { TrackEntry } from '@/shared/tracks';
import type { DeckId } from '../../constants';
import { channelFaderGain, crossfaderGains } from '../../engine/mixer/MixerCore';
import type { DeckTelemetry } from '../../engine/telemetry';
import type { MixerState } from '../../store/djStore';

export type SortKey = 'title' | 'bpm' | 'key';

/** Camelot "8A" → sortable number (8.0 for A, 8.5 for B). */
export const camelotRank = (key: string): number => {
  const m = /^(\d{1,2})([AB])$/.exec(key);
  return m ? Number(m[1]) + (m[2] === 'B' ? 0.5 : 0) : 99;
};

export function sortTracks(tracks: readonly TrackEntry[], key: SortKey): TrackEntry[] {
  const out = [...tracks];
  out.sort((a, b) => {
    if (key === 'bpm') return a.bpm - b.bpm || a.title.localeCompare(b.title);
    if (key === 'key') return camelotRank(a.key) - camelotRank(b.key) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
  return out;
}

export const formatDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A deck is on air when it plays and its channel reaches the master (fader up, crossfader side open). */
export function isOnAir(
  deck: DeckId,
  tel: Pick<DeckTelemetry, 'loaded' | 'state'>,
  mixer: Pick<MixerState, 'ch' | 'chCurve' | 'crossfader' | 'xfCurve'>,
): boolean {
  if (!tel.loaded || tel.state === 'PAUSED') return false;
  const ch = mixer.ch[deck];
  if (channelFaderGain(ch.fader, mixer.chCurve) < 0.05) return false;
  if (ch.xf === 'THRU') return true;
  const [a, b] = crossfaderGains(mixer.crossfader, mixer.xfCurve);
  return (ch.xf === 'A' ? a : b) > 0.05;
}

export type LoadDecision = 'load' | 'confirm';

/** "DECK ON AIR — tap again to load": the first tap on an on-air deck only arms the load. */
export function loadDecision(onAir: boolean, pendingLoad: string | null, trackId: string): LoadDecision {
  return onAir && pendingLoad !== trackId ? 'confirm' : 'load';
}
