'use client';
import { useEffect, useRef, useState } from 'react';
import { browserStorage } from '@/shared/mode';
import ModeSwitch from '@/shared/ModeSwitch';
import { loadManifest, type TrackEntry } from '@/shared/tracks';
import { Panel } from '@/retro/ui/Panel';
import { RetroButton } from '@/retro/ui/RetroButton';
import { createDjActions, type DjActions } from './actions';
import { installDebugHook } from './debug';
import { DjProvider, type DjRuntime } from './DjContext';
import { AudioEngine } from './engine/AudioEngine';
import { FrameLoop } from './frameLoop';
import { Hud } from './Hud';
import { useDjStore } from './store/djStore';
import { Booth } from './ui/Booth';
import { DeckDisplay } from './ui/cdj/DeckDisplay';
import styles from './dj.module.css';

/** The DJ booth. The AudioContext is created on the TAP TO START gesture (autoplay policy). */
export default function DjApp() {
  const [tracks, setTracks] = useState<TrackEntry[] | null>(null);
  const [runtime, setRuntime] = useState<DjRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** Tears down the running engine; null when none. */
  const cleanup = useRef<(() => void) | null>(null);
  /** False between an unmount and the next mount (StrictMode mounts twice). */
  const mounted = useRef(false);
  /** Synchronous re-entry guard: one engine per mount even on a double tap. */
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    loadManifest()
      .then((m) => alive && setTracks(m.tracks))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanup.current?.();
      cleanup.current = null;
    };
  }, []);

  // window.__dj goes live only after the booth has rendered (children's effects run first).
  useEffect(() => (runtime ? installDebugHook(runtime.engine, runtime.loop) : undefined), [runtime]);

  const start = async () => {
    if (!tracks || busy.current || cleanup.current) return;
    busy.current = true;
    setStarting(true);
    try {
      const store = useDjStore;
      let actions: DjActions | null = null;
      // Must stay the first await: AudioEngine.create() constructs the AudioContext inside this gesture.
      const engine = await AudioEngine.create({ onDeckEvent: (d, e) => actions?.handleDeckEvent(d, e) });
      if (!mounted.current) {
        // unmounted while the engine was starting: never leave a second context running
        await engine.dispose();
        return;
      }
      actions = createDjActions({ engine, tracks, storage: browserStorage() });
      const loop = new FrameLoop();
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const deps = { telemetry: engine.telemetry, getState: store.getState, nowFrame: () => engine.nowFrame(), track: (id: string) => byId.get(id) };
      const displays = [new DeckDisplay(0, deps), new DeckDisplay(1, deps)] as const;
      engine.applyState(store.getState(), null);
      const unsubscribe = store.subscribe((s, prev) => engine.applyState(s, prev));
      const acts = actions;
      let lastMaster = engine.telemetry.master;
      loop.add((_dt, now) => {
        // The worklet picks/hands over the master on its own (first playing deck); keep followers on it.
        if (engine.telemetry.master !== lastMaster) {
          lastMaster = engine.telemetry.master;
          acts.retrackSync();
        }
        engine.tick(store.getState());
        displays[0].draw(now);
        displays[1].draw(now);
      });
      loop.start();
      store.getState().setUi({
        audioReady: true,
        mtAvailable: engine.mtAvailable,
        notice: engine.mtAvailable ? null : 'Master Tempo (key lock) is unavailable in this browser.',
      });
      cleanup.current = () => {
        unsubscribe();
        loop.stop();
        void engine.dispose();
        store.getState().reset();
        setRuntime(null); // an effect re-run (Fast Refresh) returns to TAP TO START instead of a dead booth
      };
      setRuntime({ engine, actions, telemetry: engine.telemetry, loop, tracks, displays });
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  return (
    <div className={styles.root}>
      {runtime ? (
        <DjProvider value={runtime}>
          <Booth />
          <Hud />
        </DjProvider>
      ) : (
        <div className={styles.start}>
          <Panel title="DJ BOOTH">
            <p>Two decks, a club mixer and a room full of people. Headphones recommended.</p>
            {error ? <p className={styles.error}>{error}</p> : null}
            <RetroButton onClick={() => void start()} disabled={!tracks || starting} data-testid="dj-start">
              {starting ? 'SOUNDCHECK…' : tracks ? 'TAP TO START' : 'LOADING TRACKS…'}
            </RetroButton>
          </Panel>
        </div>
      )}
      <ModeSwitch current="dark" />
    </div>
  );
}
