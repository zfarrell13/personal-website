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
 * drops to the dry path while scratching, reversing, braking/starting, or outside 0.5×–2×.
 */
export function mtWetAllowed(mtOn: boolean, d: Pick<DeckTelemetry, 'scratching' | 'rate' | 'motor' | 'state'>, reverse: boolean): boolean {
  if (!mtOn || d.scratching || reverse || d.state === 'PAUSED') return false;
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

/** Only resend semitones when they changed audibly (0.01 st ≈ 0.06 % rate). */
export const semitonesChanged = (a: number, b: number): boolean => Math.abs(a - b) >= 0.01;
