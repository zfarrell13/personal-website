export interface SynthOptions {
  bpm: number;
  rootHz: number;
  bars: number;
  sampleRate: number;
  leadInSec: number;
  seed: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 4/4 house loop — a DJ-friendly placeholder with a known beatgrid. */
export function synthTestTrack(o: SynthOptions): { left: Float32Array; right: Float32Array } {
  const sr = o.sampleRate;
  const spb = 60 / o.bpm;
  const lead = Math.round(o.leadInSec * sr);
  const total = lead + Math.round(o.bars * 4 * spb * sr);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const rand = mulberry32(o.seed);
  const noise = new Float32Array(Math.round(sr * 0.25)).map(() => rand() * 2 - 1);
  const introBars = Math.floor(o.bars / 6);
  const outroStart = o.bars - introBars;

  const add = (start: number, len: number, fn: (t: number, i: number) => number, panL = 1, panR = 1) => {
    for (let i = 0; i < len && start + i < total; i++) {
      const v = fn(i / sr, i);
      left[start + i]! += v * panL;
      right[start + i]! += v * panR;
    }
  };

  for (let bar = 0; bar < o.bars; bar++) {
    const full = bar >= introBars && bar < outroStart;
    for (let beat = 0; beat < 4; beat++) {
      const beatStart = lead + Math.round((bar * 4 + beat) * spb * sr);
      // Kick: pitch-swept sine, exponential decay.
      let phase = 0;
      add(beatStart, Math.round(0.35 * sr), (t) => {
        const f = 50 + 100 * Math.exp(-t * 30);
        phase += (2 * Math.PI * f) / sr;
        return 0.55 * Math.sin(phase) * Math.exp(-t * 7);
      });
      // Open hat on the off-beat.
      const hatStart = beatStart + Math.round(0.5 * spb * sr);
      let prev = 0;
      add(
        hatStart,
        Math.round(0.08 * sr),
        (t, i) => {
          const n = noise[i % noise.length]!;
          const hp = n - prev;
          prev = n;
          return 0.12 * hp * Math.exp(-t * 45);
        },
        beat % 2 === 0 ? 0.7 : 1,
        beat % 2 === 0 ? 1 : 0.7,
      );
      if (!full) continue;
      // Clap on 2 and 4.
      if (beat === 1 || beat === 3) {
        add(beatStart, Math.round(0.15 * sr), (t, i) => 0.18 * noise[(i * 3) % noise.length]! * Math.exp(-t * 22));
      }
      // Off-beat bass.
      let bp = 0;
      add(hatStart, Math.round(0.45 * spb * sr), (t) => {
        bp += (2 * Math.PI * o.rootHz) / sr;
        return 0.3 * (Math.sin(bp) + 0.3 * Math.sin(2 * bp)) * Math.min(1, t * 200) * Math.exp(-t * 4);
      });
    }
    // Minor-triad stab every 2 bars in the main section.
    if (full && bar % 2 === 0) {
      const start = lead + Math.round(bar * 4 * spb * sr);
      const freqs = [o.rootHz * 4, o.rootHz * 4 * 2 ** (3 / 12), o.rootHz * 4 * 2 ** (7 / 12)];
      const phases = [0, 0, 0];
      add(
        start,
        Math.round(0.6 * sr),
        (t) => {
          let v = 0;
          freqs.forEach((f, k) => {
            phases[k]! += (2 * Math.PI * f) / sr;
            v += Math.sin(phases[k]!) + 0.25 * Math.sin(3 * phases[k]!);
          });
          return 0.06 * v * Math.exp(-t * 5);
        },
        0.85,
        1,
      );
    }
  }
  for (let i = 0; i < total; i++) {
    left[i] = Math.tanh(left[i]!);
    right[i] = Math.tanh(right[i]!);
  }
  return { left, right };
}
