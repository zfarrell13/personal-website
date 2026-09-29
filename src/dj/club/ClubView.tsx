'use client';
import { useEffect, useRef } from 'react';
import { useDj } from '../DjContext';
import { useDjStore } from '../store/djStore';
import { ClubScene } from './ClubScene';

/** Full-screen PS2 club canvas behind the booth (dimmed in close-up, full in room view). */
export function ClubView() {
  const { engine, telemetry, loop, displays } = useDj();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const club = new ClubScene(canvas, {
      telemetry,
      getState: useDjStore.getState,
      nowFrame: () => engine.nowFrame(),
      readSpectrum: (out) => engine.readSpectrum(out),
      canvases: displays,
      artwork: (d) => displays[d].artworkImage,
    });
    const forceDrop = () => club.forceDrop();
    const resize = () => club.resize(canvas.clientWidth, canvas.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    // Registered after the booth's callback (DjApp adds it before mounting us), so the
    // DeckDisplay canvases are already redrawn when the club uploads them as textures.
    const off = loop.add((dt, now) => {
      club.update(dt, now);
      // Written every frame rather than once: DjApp installs window.__dj in its own effect, which runs
      // AFTER this child effect (and StrictMode's remount replaces the hook object), so a one-time
      // assignment here would land on a missing or stale hook. Two property writes, no allocation.
      const dbg = window.__dj;
      if (dbg) {
        dbg.clubFrames = club.frames;
        dbg.clubDrop = forceDrop;
      }
    });
    return () => {
      off();
      ro.disconnect();
      club.dispose();
    };
  }, [engine, telemetry, loop, displays]);

  return <canvas ref={ref} className="retro-canvas" data-testid="club-canvas" aria-hidden="true" />;
}
