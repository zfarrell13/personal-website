'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import ModeSwitch from '@/shared/ModeSwitch';
import type { Side } from './config';
import { SurfGame } from './game/SurfGame';
import { createSurfStore } from './state/store';
import { DebugPanel } from './ui/DebugPanel';
import { Hud } from './ui/Hud';
import { NowPlayingToast, PauseMenu, Underwater } from './ui/Overlays';
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

  useEffect(() => {
    const dbg = new URLSearchParams(window.location.search).has('debug');
    setDebug(dbg);
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

  return (
    <div className={styles.root}>
      <canvas ref={canvasRef} className="retro-canvas" data-testid="surf-canvas" />
      {phase === 'loading' ? <LoadingScreen label="Paddling out" /> : null}
      {game && phase === 'title' ? <TitleMenu initialSide={side} onStart={start} /> : null}
      {phase === 'playing' || phase === 'paused' ? <Hud store={store} /> : null}
      {game && phase === 'paused' ? <PauseMenu onResume={resume} onQuit={toTitle} /> : null}
      {game && phase === 'results' && run ? <Results run={run} onAgain={again} onTitle={toTitle} /> : null}
      <Underwater store={store} />
      <NowPlayingToast store={store} />
      {game && phase === 'playing' ? <TouchControls actions={game.actions} onPause={pause} /> : null}
      {game && debug ? <DebugPanel game={game} /> : null}
      {phase !== 'playing' ? <ModeSwitch current="light" /> : null}
    </div>
  );
}
