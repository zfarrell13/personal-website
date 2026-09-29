import { describe, expect, it } from 'vitest';
import { createTelemetry } from '../engine/telemetry';
import { initialDjData } from '../store/djStore';
import { createDirectorInput, directorInput, djVisible, poseFor } from './ClubScene';

describe('directorInput', () => {
  it('reads filter sweeps and low cuts from on-air channels only', () => {
    const s = initialDjData();
    const t = createTelemetry();
    Object.assign(t.decks[0], { loaded: true, state: 'PLAYING' });
    s.mixer.ch[0] = { ...s.mixer.ch[0], fader: 1, color: -0.8, low: 0 };
    s.mixer.ch[1] = { ...s.mixer.ch[1], fader: 0, color: 1, low: 0.5 };
    t.levels.lowRms = 0.2;
    const i = directorInput(s, t, 3.5, 1 / 60);
    expect(i.playing).toBe(true);
    expect(i.filterSweep).toBeCloseTo(0.8, 9);
    expect(i.lowCut).toBe(1);
    expect(i.lowRms).toBe(0.2);
    expect(i.beatFxDepth).toBe(0);
  });
  it('writes into the reused output object (no per-frame allocation)', () => {
    const out = createDirectorInput();
    const s = initialDjData();
    const t = createTelemetry();
    Object.assign(t.decks[0], { loaded: true, state: 'PLAYING' });
    s.mixer.ch[0] = { ...s.mixer.ch[0], fader: 1 };
    expect(directorInput(s, t, 2, 1 / 30, out)).toBe(out);
    expect(out).toMatchObject({ playing: true, beat: 2, dt: 1 / 30 });
    expect(directorInput(initialDjData(), createTelemetry(), 0, 1 / 60, out)).toBe(out);
    expect(out.playing).toBe(false);
  });
  it('is idle when nothing is on air', () => {
    const i = directorInput(initialDjData(), createTelemetry(), 0, 1 / 60);
    expect(i.playing).toBe(false);
    expect(i.filterSweep).toBe(0);
  });
});

describe('poseFor', () => {
  it('close-up, room, or zoomed on the deck whose BROWSE is open (room view only)', () => {
    const s = initialDjData();
    expect(poseFor(s)).toBe('closeup');
    s.decks[1] = { ...s.decks[1], browseOpen: true };
    expect(poseFor(s)).toBe('closeup');
    s.ui = { ...s.ui, view: 'room' };
    expect(poseFor(s)).toBe('browse1');
    s.decks[0] = { ...s.decks[0], browseOpen: true };
    expect(poseFor(s)).toBe('browse0');
    s.decks[0] = { ...s.decks[0], browseOpen: false };
    s.decks[1] = { ...s.decks[1], browseOpen: false };
    expect(poseFor(s)).toBe('room');
  });
});

describe('djVisible', () => {
  const dj = { x: 0, z: 0.6 };
  it('hides the DJ in the close-up (camera at their eyes) and in the BROWSE zoom', () => {
    expect(djVisible('closeup', { x: 0, z: 0.9 }, dj)).toBe(false);
    expect(djVisible('browse0', { x: -0.36, z: -1.1 }, dj)).toBe(false);
    expect(djVisible('browse1', { x: 0.36, z: -1.1 }, dj)).toBe(false);
  });
  it('shows the DJ from the room', () => {
    expect(djVisible('room', { x: 0, z: -7.4 }, dj)).toBe(true);
    // still hidden while the camera is leaving the DJ's eyes
    expect(djVisible('room', { x: 0, z: 0.8 }, dj)).toBe(false);
  });
});
