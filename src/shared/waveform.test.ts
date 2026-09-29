import { describe, expect, it } from 'vitest';
import { decodeWaveform, encodeWaveform, WAVEFORM_HEADER_BYTES } from './waveform';

const sample = () => ({
  binsPerSec: 150,
  binCount: 3,
  low: new Uint8Array([1, 2, 3]),
  mid: new Uint8Array([4, 5, 6]),
  high: new Uint8Array([7, 8, 255]),
});

describe('waveform codec', () => {
  it('round-trips', () => {
    const bytes = encodeWaveform(sample());
    expect(bytes.byteLength).toBe(WAVEFORM_HEADER_BYTES + 9);
    const back = decodeWaveform(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(back.binsPerSec).toBe(150);
    expect(back.binCount).toBe(3);
    expect([...back.low]).toEqual([1, 2, 3]);
    expect([...back.mid]).toEqual([4, 5, 6]);
    expect([...back.high]).toEqual([7, 8, 255]);
  });
  it('interleaves bins after the header', () => {
    const bytes = encodeWaveform(sample());
    expect([...bytes.slice(16, 19)]).toEqual([1, 4, 7]);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('ZFWF');
  });
  it('rejects bad data', () => {
    expect(() => decodeWaveform(new ArrayBuffer(4))).toThrow(/too short/);
    const bytes = encodeWaveform(sample());
    bytes[0] = 0;
    expect(() => decodeWaveform(bytes.buffer)).toThrow(/magic/);
    const truncated = encodeWaveform(sample()).slice(0, 20);
    expect(() => decodeWaveform(truncated.buffer)).toThrow(/length/);
  });
});
