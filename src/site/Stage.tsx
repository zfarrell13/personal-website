'use client';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { checkSupport } from '@/retro/support';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import styles from './site.module.css';
import { attractFpsFor, stageModeFor } from './stageMode';

/** While the game's chunk loads: /surf shows the loading screen as before; the attract stage shows nothing. */
function StageLoading() {
  return stageModeFor(usePathname()) === 'play' ? <LoadingScreen label="Paddling out" /> : null;
}

const SurfApp = dynamic(() => import('@/surf/SurfApp'), { ssr: false, loading: () => <StageLoading /> });

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_MOTION);
    if (!mq) return;
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * The persistent surf stage: one SurfGame behind every page, created once (SiteShell lives in the root
 * layout, which persists across navigations). /surf plays it; every other route shows the attract loop, at a
 * lower frame rate behind the section screens (attractFpsFor).
 * Without WebGL 2 it renders nothing (/surf shows the SupportGate message instead).
 */
export function Stage() {
  const pathname = usePathname();
  const mode = stageModeFor(pathname);
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const toMenu = useCallback(() => router.push('/'), [router]);
  const [webgl2, setWebgl2] = useState(false);
  useEffect(() => setWebgl2(checkSupport(window).webgl2), []);
  if (!webgl2) return null;
  return (
    <div className={styles.stage} data-mode={mode} aria-hidden={mode === 'attract' || undefined}>
      <SurfApp mode={mode} reducedMotion={reducedMotion} attractFps={attractFpsFor(pathname)} onMenu={toMenu} />
    </div>
  );
}
