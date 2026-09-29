'use client';
import { useEffect, useState } from 'react';
import { checkSupport, type SupportReport } from '../support';
import { Panel } from './Panel';
import styles from './retro.module.css';

const NAMES: Record<keyof SupportReport, string> = { webgl2: 'WebGL 2', audioWorklet: 'Web Audio worklets' };

export function SupportGate({ needs, children }: { needs: Array<keyof SupportReport>; children: React.ReactNode }) {
  const [report, setReport] = useState<SupportReport | null>(null);
  useEffect(() => setReport(checkSupport(window)), []);
  if (!report) return null;
  const missing = needs.filter((n) => !report[n]);
  if (missing.length === 0) return <>{children}</>;
  return (
    <div className={styles.unsupported}>
      <Panel title="NEEDS A MODERN BROWSER">
        <p>This experience needs {missing.map((m) => NAMES[m]).join(' and ')}.</p>
        <p>Try the latest Chrome, Edge, Firefox or Safari on a desktop.</p>
      </Panel>
    </div>
  );
}
