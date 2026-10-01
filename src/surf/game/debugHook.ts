import type { SurferMode } from '../physics/Surfer';
import type { Phase } from '../state/store';
import type { CoachState } from './coach';

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
  /** Current peel speed (m/s) and whether a fast section is on. */
  peel: number;
  fast: boolean;
  /** The run's fast-section seed (replay a run by feeding it to PeelController.reset). */
  seed: number;
  /** Camera shot: 'chase' | 'tube' | 'underwater' | 'title'. */
  shot: string;
  /** The rider's heaviest-weighted body pose (e.g. 'bottomTurnToe', 'topTurnHeel'). */
  pose: string;
  /** The in-game coach (live object): whether the ▲ PUMP prompt is up, pumps landed, beat phase. */
  coach: CoachState;
  /**
   * The section peak: phase ('none' | 'rising' | 'pitching' | 'fading'), frame x and extra height (fraction),
   * where it pitches, and whether the rider was on / past it at the pitch (null before the pitch).
   */
  peak: { phase: string; x: number; amp: number; xPitch: number; made: boolean | null };
}

/** ?debug only: a free camera for screenshots, in wave-frame coordinates (set from the console or Playwright). */
export interface SurfDebugCamera {
  pos: [number, number, number];
  look: [number, number, number];
}

/**
 * ?debug only: an autopilot for screenshots and browser probes — the lineBot's down-the-line S-turns,
 * pumping every `pumpEvery` s (0: no pumps). The keys' ollie and stall still apply on top.
 */
export interface SurfDebugBot {
  pumpEvery: number;
}

declare global {
  interface Window {
    __surf?: SurfDebugHook;
    __surfCam?: SurfDebugCamera;
    __surfBot?: SurfDebugBot;
  }
}
