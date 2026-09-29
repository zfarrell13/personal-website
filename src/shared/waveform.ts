export interface WaveformData {
  /** Bins per second of audio; 0 for a whole-track overview. */
  binsPerSec: number;
  binCount: number;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
}

export const WAVEFORM_HEADER_BYTES = 16;
const MAGIC = [0x5a, 0x46, 0x57, 0x46]; // "ZFWF"
const VERSION = 1;

export function encodeWaveform(d: WaveformData): Uint8Array {
  const out = new Uint8Array(WAVEFORM_HEADER_BYTES + d.binCount * 3);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  const view = new DataView(out.buffer);
  view.setFloat32(8, d.binsPerSec, true);
  view.setUint32(12, d.binCount, true);
  for (let i = 0, o = WAVEFORM_HEADER_BYTES; i < d.binCount; i++, o += 3) {
    out[o] = d.low[i]!;
    out[o + 1] = d.mid[i]!;
    out[o + 2] = d.high[i]!;
  }
  return out;
}

export function decodeWaveform(buf: ArrayBufferLike): WaveformData {
  if (buf.byteLength < WAVEFORM_HEADER_BYTES) throw new Error('Waveform data too short');
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('Waveform data has bad magic');
  if (bytes[4] !== VERSION) throw new Error(`Unsupported waveform version ${bytes[4]}`);
  const view = new DataView(buf);
  const binsPerSec = view.getFloat32(8, true);
  const binCount = view.getUint32(12, true);
  if (buf.byteLength !== WAVEFORM_HEADER_BYTES + binCount * 3) throw new Error('Waveform data length mismatch');
  const low = new Uint8Array(binCount);
  const mid = new Uint8Array(binCount);
  const high = new Uint8Array(binCount);
  for (let i = 0, o = WAVEFORM_HEADER_BYTES; i < binCount; i++, o += 3) {
    low[i] = bytes[o]!;
    mid[i] = bytes[o + 1]!;
    high[i] = bytes[o + 2]!;
  }
  return { binsPerSec, binCount, low, mid, high };
}
