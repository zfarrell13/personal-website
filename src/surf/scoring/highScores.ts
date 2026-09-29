import type { Side } from '../config';

export interface HighScore {
  initials: string;
  score: number;
  side: Side;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

export const HIGH_SCORE_KEY = 'zf-surf-highscores';
export const MAX_HIGH_SCORES = 10;

const isEntry = (v: unknown): v is HighScore => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.initials === 'string' &&
    /^[A-Z]{3}$/.test(o.initials) &&
    typeof o.score === 'number' &&
    Number.isFinite(o.score) &&
    (o.side === 'left' || o.side === 'right') &&
    typeof o.date === 'string'
  );
};

const sortDesc = (a: HighScore, b: HighScore) => b.score - a.score;

export function loadHighScores(storage: Pick<Storage, 'getItem'> | null): HighScore[] {
  try {
    const raw = storage?.getItem(HIGH_SCORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort(sortDesc).slice(0, MAX_HIGH_SCORES);
  } catch {
    return [];
  }
}

export function saveHighScores(storage: Pick<Storage, 'setItem'> | null, list: HighScore[]): void {
  try {
    storage?.setItem(HIGH_SCORE_KEY, JSON.stringify(list.slice(0, MAX_HIGH_SCORES)));
  } catch {
    // storage blocked — scores just won't persist
  }
}

export function qualifies(list: readonly HighScore[], score: number): boolean {
  if (score <= 0) return false;
  if (list.length < MAX_HIGH_SCORES) return true;
  return score > list[list.length - 1]!.score;
}

/** Inserts (stable: an equal score ranks below existing ones) and trims to 10. Returns the 0-based rank or -1. */
export function insertHighScore(list: readonly HighScore[], entry: HighScore): { list: HighScore[]; rank: number } {
  const next = [...list];
  let i = next.findIndex((e) => entry.score > e.score);
  if (i < 0) i = next.length;
  next.splice(i, 0, entry);
  const trimmed = next.slice(0, MAX_HIGH_SCORES);
  return { list: trimmed, rank: i < MAX_HIGH_SCORES ? i : -1 };
}

/** Uppercase A–Z only, exactly 3 letters (padded with 'A'). */
export function sanitizeInitials(raw: string): string {
  return (raw.toUpperCase().replace(/[^A-Z]/g, '') + 'AAA').slice(0, 3);
}
