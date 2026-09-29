import { describe, expect, it } from 'vitest';
import type { TrackEntry } from '@/shared/tracks';
import { initialDjData } from '../../store/djStore';
import { camelotRank, formatDuration, isOnAir, loadDecision, sortTracks } from './browseLogic';

const t = (id: string, title: string, bpm: number, key: string) => ({ id, title, bpm, key }) as TrackEntry;
const tracks = [t('a', 'Zulu', 120, '8A'), t('b', 'Alpha', 128, '1B'), t('c', 'Mike', 124, '1A')];

describe('browse logic', () => {
  it('sorts by title, BPM and Camelot key', () => {
    expect(sortTracks(tracks, 'title').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortTracks(tracks, 'bpm').map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(sortTracks(tracks, 'key').map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(camelotRank('12B')).toBe(12.5);
  });
  it('formats durations', () => {
    expect(formatDuration(186.06)).toBe('3:06');
  });
  it('detects on-air decks', () => {
    const mixer = initialDjData().mixer;
    const playing = { loaded: true, state: 'PLAYING' as const };
    expect(isOnAir(0, playing, mixer)).toBe(false); // fader down
    const up = { ...mixer, ch: [{ ...mixer.ch[0], fader: 1 }, mixer.ch[1]] as typeof mixer.ch };
    expect(isOnAir(0, playing, up)).toBe(true);
    expect(isOnAir(0, { loaded: true, state: 'PAUSED' }, up)).toBe(false);
    const xfAway = { ...up, crossfader: 1, ch: [{ ...up.ch[0], xf: 'A' as const }, up.ch[1]] as typeof mixer.ch };
    expect(isOnAir(0, playing, xfAway)).toBe(false);
  });
  it('asks for a second tap when on air', () => {
    expect(loadDecision(true, null, 'x')).toBe('confirm');
    expect(loadDecision(true, 'x', 'x')).toBe('load');
    expect(loadDecision(false, null, 'x')).toBe('load');
  });
});
