'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import { browserStorage } from '@/shared/storage';
import type { Side } from './config';
import { SurfGame } from './game/SurfGame';
import { loadGuide, saveGuide } from './state/guidePref';
import { createSurfStore } from './state/store';
import { DebugPanel } from './ui/DebugPanel';
import { Hud } from './ui/Hud';
import { PauseMenu, Underwater } from './ui/Overlays';
import { Results } from './ui/Results';
import { TitleMenu } from './ui/TitleMenu';
import { TouchControls } from './ui/TouchControls';
import styles from './ui/surf.module.css';

export default function SurfApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(createSurfStore);
  const [game, setGame] = useState<SurfGame | null>(null);
  const [debug, setDebug] = useState(false);
  const phase = useStore(store, (s) => s.phase);
  const side = useStore(store, (s) => s.side);
  const run = useStore(store, (s) => s.run);
  const guide = useStore(store, (s) => s.guide);

  useEffect(() => {
    const dbg = new URLSearchParams(window.location.search).has('debug');
    setDebug(dbg);
    store.setState({ guide: loadGuide(browserStorage()) });
    const g = new SurfGame(canvasRef.current!, store, { debug: dbg });
    setGame(g);
    g.load().catch((e: unknown) => console.error('Surf failed to load', e));
    return () => {
      g.dispose();
      setGame(null);
    };
  }, [store]);

  const start = useCallback((s: Side) => game?.start(s), [game]);
  const again = useCallback(() => game?.start(store.getState().side), [game, store]);
  const toTitle = useCallback(() => game?.quitToTitle(), [game]);
  const resume = useCallback(() => game?.resume(), [game]);
  const pause = useCallback(() => game?.pause(), [game]);
  const setGuide = useCallback(
    (on: boolean) => {
      store.setState({ guide: on });
      saveGuide(browserStorage(), on);
    },
    [store],
  );

  return (
    <div className={styles.root}>
      <canvas ref={canvasRef} className="retro-canvas" data-testid="surf-canvas" />
      {phase === 'loading' ? <LoadingScreen label="Paddling out" /> : null}
      {game && phase === 'title' ? <TitleMenu initialSide={side} onStart={start} guide={guide} onGuide={setGuide} /> : null}
      {phase === 'playing' || phase === 'paused' ? <Hud store={store} /> : null}
      {game && phase === 'paused' ? <PauseMenu onResume={resume} onQuit={toTitle} /> : null}
      {game && phase === 'results' && run ? <Results run={run} onAgain={again} onTitle={toTitle} /> : null}
      <Underwater store={store} />
      {game && phase === 'playing' ? <TouchControls actions={game.actions} onPause={pause} /> : null}
      {game && debug ? <DebugPanel game={game} /> : null}
    </div>
  );
}
