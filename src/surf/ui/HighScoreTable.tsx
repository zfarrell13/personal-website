import type { HighScore } from '../scoring/highScores';
import styles from './surf.module.css';

export function HighScoreTable({ scores, highlight }: { scores: readonly HighScore[]; highlight: number }) {
  return (
    <table className={styles.table}>
      <tbody>
        {scores.map((s, i) => (
          <tr key={`${s.initials}-${s.score}-${i}`} data-me={i === highlight ? 'true' : 'false'}>
            <td>{String(i + 1).padStart(2, '0')}</td>
            <td>{s.initials}</td>
            <td style={{ textAlign: 'right' }}>{s.score.toLocaleString('en-US')}</td>
            <td>{s.side === 'left' ? 'L' : 'R'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
