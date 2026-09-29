import { MT_CROSSFADE_SEC } from '../constants';
import type { DeckTelemetry } from './telemetry';

/** Pitch shift that cancels a varispeed rate: rate 2 → −12 semitones. Clamped to ±24. */
export function mtSemitones(rate: number): number {
  const r = Math.abs(rate);
  if (r < 1e-6) return 0;
  return Math.max(-24, Math.min(24, -12 * Math.log2(r)));
}

/**
 * Whether the key-locked (wet) path may be used. Like the real deck, Master Tempo
 * drops to the dry path while scratching (and the post-scratch hand-back glide), reversing, braking/starting, or outside 0.5×–2×.
 */
export function mtWetAllowed(mtOn: boolean, d: Pick<DeckTelemetry, 'scratching' | 'releasing' | 'rate' | 'motor' | 'state'>, reverse: boolean): boolean {
  if (!mtOn || d.scratching || d.releasing || reverse || d.state === 'PAUSED') return false;
  if (d.motor < 1) return false;
  return d.rate >= 0.5 && d.rate <= 2;
}

/** Equal-power crossfade curves for AudioParam.setValueCurveAtTime: [rising, falling]. */
export function equalPowerCurves(points = 16): [Float32Array, Float32Array] {
  const up = new Float32Array(points);
  const down = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    up[i] = Math.sin((x * Math.PI) / 2);
    down[i] = Math.cos((x * Math.PI) / 2);
  }
  return [up, down];
}

export const MT_FADE_SEC = MT_CROSSFADE_SEC;

/**
 * Equal-power wet/dry fade that starts from the current wet gain, so flipping the gate
 * mid-fade continues smoothly instead of jumping to the curve's start. The duration is
 * the remaining share of the full 20 ms fade (0 when already there).
 */
export function mtFadeCurves(currentWet: number, toWet: boolean, points = 8): { wet: Float32Array; dry: Float32Array; durationSec: number } {
  const x0 = (Math.asin(Math.min(1, Math.max(0, currentWet))) * 2) / Math.PI; // position along the fade, 0 = dry
  const x1 = toWet ? 1 : 0;
  const wet = new Float32Array(points);
  const dry = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = x0 + ((x1 - x0) * i) / (points - 1);
    wet[i] = Math.sin((x * Math.PI) / 2);
    dry[i] = Math.cos((x * Math.PI) / 2);
  }
  return { wet, dry, durationSec: Math.abs(x1 - x0) * MT_FADE_SEC };
}

/** Only resend semitones when they changed audibly (0.01 st ≈ 0.06 % rate). */
export const semitonesChanged = (a: number, b: number): boolean => Math.abs(a - b) >= 0.01;
