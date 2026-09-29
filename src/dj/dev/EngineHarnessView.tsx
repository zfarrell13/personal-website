'use client';
import { useState } from 'react';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { runEngineHarness, type EngineHarnessResult } from './engineHarness';
import { runGraphChecks, type GraphCheckResult } from './graphChecks';

declare global {
  interface Window {
    __djEngine?: EngineHarnessResult | { error: string };
    __djGraph?: GraphCheckResult | { error: string };
  }
}

/** /dev/dj-engine — runs the audio engine end to end in the browser (no booth UI). */
export default function EngineHarnessView() {
  const [out, setOut] = useState<string>('Press RUN (audio needs a user gesture).');
  const run = <T,>(job: () => Promise<T>, publish: (r: T | { error: string }) => void) => {
    setOut('running…');
    job()
      .then((r) => {
        publish(r);
        setOut(JSON.stringify(r, null, 2));
      })
      .catch((e: unknown) => {
        publish({ error: String(e) });
        setOut(String(e));
      });
  };
  return (
    <div style={{ padding: 24 }}>
      <Panel title="DJ ENGINE HARNESS">
        <RetroButton data-testid="run-engine" onClick={() => run(runEngineHarness, (r) => (window.__djEngine = r))}>
          RUN
        </RetroButton>{' '}
        <RetroButton data-testid="run-graph" onClick={() => run(runGraphChecks, (r) => (window.__djGraph = r))}>
          GRAPH CHECKS
        </RetroButton>
        <pre style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 16 }}>{out}</pre>
      </Panel>
    </div>
  );
}
