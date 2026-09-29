import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelemetry } from '../engine/telemetry';
import { initialDjData, type DjData } from '../store/djStore';
import type { GearParts } from './gear/proceduralGear';

const retro = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), setSize: vi.fn() }));
vi.mock('@/retro/RetroRenderer', () => ({
  RetroRenderer: class {
    render = retro.render;
    dispose = retro.dispose;
    setSize = retro.setSize;
  },
}));

const gearLoad = vi.hoisted(() => ({ resolve: null as ((g: GearParts) => void) | null }));
vi.mock('./gear/gearModel', () => ({
  loadModelsManifest: async () => ({ booth: null }),
  loadGear: () =>
    new Promise<GearParts>((res) => {
      gearLoad.resolve = res;
    }),
}));

const { ClubScene } = await import('./ClubScene');

const fakeGear = (): GearParts => ({ group: new THREE.Group(), bindings: [], textures: [], dispose: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeScene(state: DjData = initialDjData()) {
  const canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
  return new ClubScene(canvas, {
    telemetry: createTelemetry(),
    getState: () => state,
    nowFrame: () => 0,
    readSpectrum: () => {},
    canvases: [],
    artwork: () => null,
  });
}

describe('ClubScene', () => {
  beforeEach(() => {
    retro.render.mockClear();
    retro.dispose.mockClear();
    gearLoad.resolve = null;
  });

  it('dispose() is idempotent', () => {
    const club = makeScene();
    club.dispose();
    club.dispose();
    expect(retro.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes gear that finishes loading after the scene was disposed', async () => {
    const club = makeScene();
    await flush();
    expect(gearLoad.resolve).not.toBeNull();
    club.dispose();
    const gear = fakeGear();
    gearLoad.resolve!(gear);
    await flush();
    expect(gear.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps gear loaded while alive and disposes it with the scene', async () => {
    const club = makeScene();
    await flush();
    const gear = fakeGear();
    gearLoad.resolve!(gear);
    await flush();
    expect(gear.dispose).not.toHaveBeenCalled();
    club.dispose();
    expect(gear.dispose).toHaveBeenCalledTimes(1);
  });

  it('forceDrop() fires a drop the next frame sees', () => {
    const club = makeScene();
    const before = club.director.state.dropCount;
    club.forceDrop();
    club.update(1 / 60, 1);
    expect(club.director.state.dropCount).toBe(before + 1);
    expect(club.director.state.drop).toBeGreaterThan(0.9);
    club.dispose();
  });

  it('renders every 2nd frame in the settled close-up and every frame in the room view', () => {
    const s = initialDjData();
    const club = makeScene(s);
    for (let i = 0; i < 8; i++) club.update(1 / 60, i / 60);
    expect(retro.render).toHaveBeenCalledTimes(4);
    expect(club.frames).toBe(4);
    retro.render.mockClear();
    s.ui = { ...s.ui, view: 'room' };
    for (let i = 0; i < 8; i++) club.update(1 / 60, i / 60);
    expect(retro.render).toHaveBeenCalledTimes(8);
    club.dispose();
  });

  it('renders every frame while the camera dollies back to the close-up', () => {
    const s = initialDjData();
    s.ui = { ...s.ui, view: 'room' };
    const club = makeScene(s);
    for (let i = 0; i < 60; i++) club.update(1 / 60, i / 60);
    s.ui = { ...s.ui, view: 'closeup' };
    retro.render.mockClear();
    for (let i = 0; i < 40; i++) club.update(1 / 60, i / 60); // 0.67 s < 0.8 s dolly
    expect(retro.render).toHaveBeenCalledTimes(40);
    club.dispose();
  });
});
