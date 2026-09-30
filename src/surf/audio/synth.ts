/** Pure helpers for the surf audio graph (unit-tested; no AudioContext needed). */
import { mulberry32 } from '../math/random';

export { mulberry32 };

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Tube low-pass: 20 kHz open water → 800 Hz deep in the barrel (exponential). */
export function tubeCutoffHz(depth: number): number {
  const d = Math.min(1, Math.max(0, depth));
  return 20000 * Math.pow(800 / 20000, d);
}

/** Board spray noise: band-pass centre and gain follow speed and carve intensity (0–1). */
export function sprayParams(speed: number, carve: number): { freq: number; gain: number } {
  const c = Math.min(1, Math.max(0, carve));
  return {
    freq: 700 + speed * 90 + c * 1400,
    gain: Math.min(1, Math.max(0, speed / 14)) * 0.18 + c * 0.22,
  };
}

export interface HootVoice {
  delay: number;
  duration: number;
  f0: number;
  /** Pitch multiplier reached at the peak of the "whoo". */
  glide: number;
  vibratoHz: number;
  /** [start, end] Hz for formants F1 and F2 ("oo" → "oh"). */
  f1: [number, number];
  f2: [number, number];
  pan: number;
  gain: number;
}

/** A crowd "whooo!": several detuned voices with rising pitch and moving formants. */
export function hootVoices(seed: number, count = 6): HootVoice[] {
  const r = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    delay: r() * 0.25,
    duration: 0.7 + r() * 0.5,
    f0: 190 + r() * 170,
    glide: 1.25 + r() * 0.3,
    vibratoHz: 5 + r() * 2.5,
    f1: [300 + r() * 60, 480 + r() * 80] as [number, number],
    f2: [800 + r() * 100, 950 + r() * 150] as [number, number],
    pan: r() * 1.6 - 0.8,
    gain: 0.10 + r() * 0.06,
  }));
}

/** Fill a buffer with deterministic white noise. */
export function fillNoise(data: Float32Array, seed: number): Float32Array {
  const r = mulberry32(seed);
  for (let i = 0; i < data.length; i++) data[i] = r() * 2 - 1;
  return data;
}

/** Stereo reverb impulse: noise with exponential decay (≈ −60 dB at `seconds`). */
export function fillImpulse(left: Float32Array, right: Float32Array, sampleRate: number, seconds: number): void {
  fillNoise(left, 11);
  fillNoise(right, 12);
  const k = Math.log(1000) / (seconds * sampleRate);
  for (let i = 0; i < left.length; i++) {
    const e = Math.exp(-k * i);
    left[i]! *= e;
    right[i]! *= e;
  }
}
