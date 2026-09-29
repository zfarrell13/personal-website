import { describe, expect, it } from 'vitest';
import { headphoneRouting } from './HeadphoneOutput';

describe('headphoneRouting', () => {
  it('uses the second device when one is active', () => {
    expect(headphoneRouting('STEREO', true)).toEqual({ main: 'master', device: true, deviceSignal: 'stereo' });
    expect(headphoneRouting('SPLIT', true)).toEqual({ main: 'master', device: true, deviceSignal: 'split' });
  });
  it('falls back to cue-left / master-right on the main output in SPLIT mode', () => {
    expect(headphoneRouting('SPLIT', false).main).toBe('split');
    expect(headphoneRouting('STEREO', false)).toEqual({ main: 'master', device: false, deviceSignal: 'stereo' });
  });
});
