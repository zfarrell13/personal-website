import { describe, expect, it } from 'vitest';
import { encodeWav16 } from './wav';

describe('encodeWav16', () => {
  it('writes a valid 16-bit PCM header and clipped samples', () => {
    const buf = encodeWav16([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, -0.5, 0, -2])], 48000);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(4)).toBe(36 + 16);
    expect(buf.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(buf.readUInt16LE(20)).toBe(1);
    expect(buf.readUInt16LE(22)).toBe(2);
    expect(buf.readUInt32LE(24)).toBe(48000);
    expect(buf.readUInt32LE(28)).toBe(48000 * 4);
    expect(buf.readUInt16LE(32)).toBe(4);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(16);
    expect(buf.readInt16LE(44 + 4 * 1)).toBe(32767); // L frame 1 = 1.0
    expect(buf.readInt16LE(44 + 4 * 3)).toBe(32767); // L frame 3 = 2.0 clipped
    expect(buf.readInt16LE(44 + 4 * 3 + 2)).toBe(-32768); // R frame 3 = -2.0 clipped
  });
});
