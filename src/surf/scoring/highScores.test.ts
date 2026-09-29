import { describe, expect, it } from 'vitest';
import {
  HIGH_SCORE_KEY,
  insertHighScore,
  loadHighScores,
  qualifies,
  sanitizeInitials,
  saveHighScores,
  type HighScore,
} from './highScores';

const entry = (score: number, initials = 'ZAF'): HighScore => ({ initials, score, side: 'right', date: '2026-09-29' });
const memory = () => {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

describe('high scores', () => {
  it('round-trips through storage, sorted, max 10, ignoring junk', () => {
    const m = memory();
    saveHighScores(m, Array.from({ length: 12 }, (_, i) => entry(i * 100)));
    m.data[HIGH_SCORE_KEY] = JSON.stringify([...JSON.parse(m.data[HIGH_SCORE_KEY]!), { initials: 'bad' }]);
    const list = loadHighScores(m);
    expect(list).toHaveLength(10);
    expect(list[0]!.score).toBeGreaterThan(list[9]!.score);
  });

  it('survives broken storage', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadHighScores(broken)).toEqual([]);
    expect(() => saveHighScores(broken, [entry(1)])).not.toThrow();
    const m = memory();
    m.data[HIGH_SCORE_KEY] = '{not json';
    expect(loadHighScores(m)).toEqual([]);
  });

  it('decides qualification and rank', () => {
    const full = Array.from({ length: 10 }, (_, i) => entry(1000 - i * 100));
    expect(qualifies(full, 100)).toBe(false);
    expect(qualifies(full, 150)).toBe(true);
    expect(qualifies([], 0)).toBe(false);
    const { list, rank } = insertHighScore(full, entry(850, 'NEW'));
    expect(rank).toBe(2);
    expect(list).toHaveLength(10);
    expect(list[2]!.initials).toBe('NEW');
    expect(insertHighScore(full, entry(1000, 'TIE')).rank).toBe(1);
  });

  it('sanitizes initials', () => {
    expect(sanitizeInitials('z1f')).toBe('ZFA');
    expect(sanitizeInitials('abcd')).toBe('ABC');
  });
});
