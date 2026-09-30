import type { SurferMode } from '../physics/Surfer';
import type { Phase } from '../state/store';

/** Read-only snapshot for Playwright and the debug panel. */
export interface SurfDebugHook {
  frames: number;
  phase: Phase;
  score: number;
  mode: SurferMode;
  x: number;
  calls: number;
  triangles: number;
  fps: number;
  /** Camera shot: 'chase' | 'tube' | 'underwater'. */
  shot: string;
}

declare global {
  interface Window {
    __surf?: SurfDebugHook;
  }
}
