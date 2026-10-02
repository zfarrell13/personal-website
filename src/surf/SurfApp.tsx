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

export interface SurfAppProps {
  /** 'play': the game as on /surf. 'attract': the wave behind a site page — no UI, no input. */
  mode?: 'play' | 'attract';
  /** prefers-reduced-motion: the attract stage holds a still frame. */
  reducedMotion?: boolean;
  /** The attract loop's frame cap (the site lowers it behind a section screen). Default: the game's own (30). */
  attractFps?: number;
  /** Back to the site's title menu, offered on the game's title screen ("◀ MENU", Esc). */
  onMenu?: () => void;
}

/** The surf game. Created once per mount: mode changes switch it in place, never re-create it. */
export default function SurfApp({ mode = 'play', reducedMotion = false, attractFps, onMenu }: SurfAppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(createSurfStore);
  const [game, setGame] = useState<SurfGame | null>(null);
  const [debug, setDebug] = useState(false);
  const phase = useStore(store, (s) => s.phase);
  const side = useStore(store, (s) => s.side);
  const run = useStore(store, (s) => s.run);
  const guide = useStore(store, (s) => s.guide);

  // The mode at creation, so an attract stage is born in attract mode (never a play-mode moment with the keys).
  const modeRef = useRef(mode);
  const attractFpsRef = useRef(attractFps);
  useEffect(() => {
    modeRef.current = mode;
    attractFpsRef.current = attractFps;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dbg = params.has('debug');
    setDebug(dbg);
    store.setState({ guide: loadGuide(browserStorage()) });
    // Dev: ?pierSoon (the default distance) or ?pierSoon=m; ?pierSoon=0 (or not a number) is off.
    const soon = params.get('pierSoon');
    const pierSoon = soon === null ? undefined : soon === '' ? true : Number(soon);
    const g = new SurfGame(canvasRef.current!, store, { debug: dbg, attract: modeRef.current === 'attract', attractFps: attractFpsRef.current, pierSoon });
    setGame(g);
    g.load().catch((e: unknown) => console.error('Surf failed to load', e));
    return () => {
      g.dispose();
      setGame(null);
    };
  }, [store]);

  const attract = mode === 'attract';
  useEffect(() => game?.setAttract(attract), [game, attract]);
  useEffect(() => game?.setFrozen(reducedMotion), [game, reducedMotion]);
  useEffect(() => {
    if (attractFps !== undefined) game?.setAttractFps(attractFps);
  }, [game, attractFps]);

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

  // One tree for both modes: the canvas element (which the game owns) is never re-created.
  const ui = !attract;
  return (
    <div className={styles.root} data-mode={mode}>
      <canvas ref={canvasRef} className="retro-canvas" data-testid="surf-canvas" aria-hidden={attract || undefined} />
      {ui && phase === 'loading' ? <LoadingScreen label="Paddling out" /> : null}
      {ui && game && phase === 'title' ? <TitleMenu initialSide={side} onStart={start} guide={guide} onGuide={setGuide} onMenu={onMenu} /> : null}
      {ui && (phase === 'playing' || phase === 'paused') ? <Hud store={store} /> : null}
      {ui && game && phase === 'paused' ? <PauseMenu onResume={resume} onQuit={toTitle} /> : null}
      {ui && game && phase === 'results' && run ? <Results run={run} onAgain={again} onTitle={toTitle} /> : null}
      {ui ? <Underwater store={store} /> : null}
      {ui && game && phase === 'playing' ? <TouchControls actions={game.actions} onPause={pause} onCancel={(a) => a === 'ollie' && game.cancelOllie()} /> : null}
      {ui && game && debug ? <DebugPanel game={game} /> : null}
    </div>
  );
}
