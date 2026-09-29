'use client';
import { useCallback, useEffect, useState } from 'react';
import { browserStorage, readMode, systemPrefersDark, writeMode, type Mode } from './mode';

/** Mode is null until hydrated on the client, to avoid SSR mismatches. */
export function useMode(): { mode: Mode | null; setMode: (m: Mode) => void } {
  const [mode, setModeState] = useState<Mode | null>(null);
  useEffect(() => {
    setModeState(readMode(browserStorage(), systemPrefersDark()));
  }, []);
  const setMode = useCallback((m: Mode) => {
    writeMode(browserStorage(), m);
    setModeState(m);
  }, []);
  return { mode, setMode };
}
