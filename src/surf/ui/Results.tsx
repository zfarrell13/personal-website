'use client';
import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { browserStorage } from '@/shared/storage';
import type { WipeoutReason } from '../physics/events';
import { insertHighScore, loadHighScores, qualifies, sanitizeInitials, saveHighScores, type HighScore } from '../scoring/highScores';
import type { RunSummary } from '../state/store';
import { HighScoreTable } from './HighScoreTable';
import { otherButtonFocused } from './menuFocus';
import styles from './surf.module.css';

const REASONS: Record<WipeoutReason, string> = {
  swallowed: 'SWALLOWED BY THE BARREL',
  badLanding: 'BLEW THE LANDING',
  whitewater: 'LANDED IN THE WHITEWATER',
};
const A = 'A'.charCodeAt(0);

export function Results({ run, onAgain, onTitle }: { run: RunSummary; onAgain: () => void; onTitle: () => void }) {
  const [scores, setScores] = useState<HighScore[]>(() => loadHighScores(browserStorage()));
  const [entering, setEntering] = useState(() => qualifies(scores, run.score));
  const [letters, setLetters] = useState([0, 0, 0]);
  const [cursor, setCursor] = useState(0);
  const [rank, setRank] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  // Arrow keys held from the run must not spin the initials: wait for a fresh (non-repeat) keydown.
  const armed = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat) armed.current = true;
      if (entering) {
        if (e.repeat && !armed.current && e.key.startsWith('Arrow')) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = e.key === 'ArrowUp' ? 1 : 25;
          setLetters((l) => l.map((v, i) => (i === cursor ? (v + d) % 26 : v)));
        } else if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
        else if (e.key === 'ArrowRight') setCursor((c) => Math.min(2, c + 1));
        else if (/^[a-z]$/i.test(e.key)) {
          const v = e.key.toUpperCase().charCodeAt(0) - A;
          setLetters((l) => l.map((x, i) => (i === cursor ? v : x)));
          setCursor((c) => Math.min(2, c + 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (e.repeat) return;
          const initials = sanitizeInitials(String.fromCharCode(...letters.map((v) => v + A)));
          const res = insertHighScore(scores, { initials, score: run.score, side: run.side, date: new Date().toISOString().slice(0, 10) });
          saveHighScores(browserStorage(), res.list);
          setScores(res.list);
          setRank(res.rank);
          setEntering(false);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (e.repeat || otherButtonFocused(rootRef.current)) return;
        e.preventDefault();
        onAgain();
      } else if (e.key === 'Escape') onTitle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entering, cursor, letters, scores, run, onAgain, onTitle]);

  // Focus the primary action once initials are done (or immediately if none), else the dialog itself.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    (entering ? root : root.querySelector<HTMLElement>('[data-primary="true"]') ?? root).focus();
  }, [entering]);

  const headline = run.end === 'kickedOut' ? 'KICKED OUT' : `WIPEOUT — ${run.wipeoutReason ? REASONS[run.wipeoutReason] : ''}`;

  return (
    <div className={styles.center} ref={rootRef} role="dialog" aria-label="Run results" tabIndex={-1}>
      <div className={styles.menu}>
        <Panel title={headline}>
          <p className={styles.score} data-testid="final-score">{run.score.toLocaleString('en-US')}</p>
          <p className={styles.legend}>
            BEST COMBO {run.bestCombo.toLocaleString('en-US')} · LONGEST TUBE {run.longestTube.toFixed(1)}s · TRICKS {run.tricks} · RIDE {run.durationSec.toFixed(0)}s
          </p>
        </Panel>
        {entering ? (
          <Panel title="NEW HIGH SCORE — ENTER INITIALS">
            <div className={styles.initials} data-testid="initials" role="group" aria-label="Initials, three letters">
              {letters.map((v, i) => (
                <span key={i} className={styles.letter} data-active={i === cursor ? 'true' : 'false'}>
                  {String.fromCharCode(v + A)}
                </span>
              ))}
            </div>
            <p className={styles.legend}>↑ ↓ letter · ← → move · ENTER save</p>
          </Panel>
        ) : (
          <>
            {scores.length > 0 ? (
              <Panel title="TOP 10">
                <HighScoreTable scores={scores} highlight={rank} />
              </Panel>
            ) : null}
            <div className={styles.row}>
              <RetroButton data-primary="true" onClick={onAgain}>GO AGAIN (ENTER)</RetroButton>
              <RetroButton onClick={onTitle}>TITLE (ESC)</RetroButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
