'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { TrackEntry } from '@/shared/tracks';
import type { DjActions } from './actions';
import type { AudioEngine } from './engine/AudioEngine';
import type { EngineTelemetry } from './engine/telemetry';
import type { FrameLoop } from './frameLoop';
import type { DeckDisplay } from './ui/cdj/DeckDisplay';

export interface DjRuntime {
  engine: AudioEngine;
  actions: DjActions;
  telemetry: EngineTelemetry;
  loop: FrameLoop;
  tracks: TrackEntry[];
  displays: readonly [DeckDisplay, DeckDisplay];
}

const Ctx = createContext<DjRuntime | null>(null);

export const DjProvider = Ctx.Provider;

export function useDj(): DjRuntime {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDj() outside <DjProvider>');
  return v;
}

/**
 * Reads a primitive from telemetry every frame and re-renders only when it changes
 * (LED states, BPM text…) — keeps React well under 20 renders/s during play.
 */
export function useTel<T extends string | number | boolean>(select: (t: EngineTelemetry) => T): T {
  const { telemetry, loop } = useDj();
  const [v, setV] = useState<T>(() => select(telemetry));
  const ref = useRef(select);
  useEffect(() => {
    ref.current = select;
  });
  useEffect(() => loop.add(() => setV(ref.current(telemetry))), [loop, telemetry]);
  return v;
}
