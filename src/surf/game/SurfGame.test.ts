import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpConfig } from '../config';
import type { SurferInput } from '../physics/input';
import { Environment } from '../render/Environment';
import { WaveMesh } from '../render/WaveMesh';
import { createSurfStore, type SurfStore } from '../state/store';

// --- Mocks: no WebGL, no Web Audio, no GLTF fetch in node. -------------------

const retroInstances: FakeRetro[] = [];
class FakeRetro {
  renderer = { info: { autoReset: true, reset: vi.fn(), render: { calls: 7, triangles: 1234 } } };
  internalResolution = { width: 800, height: 448 };
  setSize = vi.fn();
  render = vi.fn();
  dispose = vi.fn();
  constructor() {
    retroInstances.push(this);
  }
}
vi.mock('@/retro/RetroRenderer', () => ({ RetroRenderer: FakeRetro }));

const audioInstances: FakeAudio[] = [];
let audioStartResult: () => Promise<void> = () => Promise.resolve();
class FakeAudio {
  start = vi.fn(() => audioStartResult());
  pause = vi.fn();
  resume = vi.fn();
  update = vi.fn();
  onEvent = vi.fn();
  onBank = vi.fn();
  dispose = vi.fn();
  constructor() {
    audioInstances.push(this);
  }
}
vi.mock('../audio/SurfAudio', () => ({ SurfAudio: FakeAudio }));

vi.mock('../character/Character', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../character/Character')>();
  const { buildProceduralRig } = await import('../character/rig');
  return { ...orig, loadSurferRig: async (look: never) => ({ rig: buildProceduralRig(look), procedural: true }) };
});

const { SurfGame } = await import('./SurfGame');

// --- Browser globals the engine touches. ------------------------------------

let rafCb: ((t: number) => void) | null = null;
const cancelRaf = vi.fn();
let win: EventTarget & { __surf?: unknown };

beforeEach(() => {
  rafCb = null;
  retroInstances.length = 0;
  audioInstances.length = 0;
  audioStartResult = () => Promise.resolve();
  cancelRaf.mockClear();
  win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelRaf);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ version: 1, tracks: [] }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const canvas = { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement;

let clock = 0;
function frame(ms = 1000 / 60): void {
  clock += ms;
  rafCb!(clock);
}

async function playing(store: SurfStore = createSurfStore()) {
  const game = new SurfGame(canvas, store);
  await game.load();
  clock = performance.now();
  frame(); // establish the frame clock
  game.start('right');
  return { game, store };
}

const key = (type: 'keydown' | 'keyup', code: string) => {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code;
  e.repeat = false;
  win.dispatchEvent(e);
};

describe('SurfGame', () => {
  it('loads to the title and keeps rendering behind the menu', async () => {
    const store = createSurfStore();
    const game = new SurfGame(canvas, store);
    expect(store.getState().phase).toBe('loading');
    await game.load();
    expect(store.getState().phase).toBe('title');
    clock = performance.now();
    frame();
    frame();
    const retro = retroInstances[0]!;
    expect(retro.renderer.info.autoReset).toBe(false);
    expect(retro.render).toHaveBeenCalledTimes(2);
    expect(retro.renderer.info.reset).toHaveBeenCalledTimes(2);
    expect(win.__surf).toMatchObject({ frames: 2, phase: 'title', calls: 7, triangles: 1234, mode: 'riding' });
    game.dispose();
  });

  it('ticks input exactly once per physics step while playing, once per frame otherwise', async () => {
    const { game } = await playing();
    const tick = vi.spyOn(game.actions, 'tick');
    const step = vi.spyOn(game.surfer, 'step');
    frame(1000 / 60); // 2 steps at 120 Hz
    expect(step).toHaveBeenCalledTimes(2);
    expect(tick).toHaveBeenCalledTimes(2);
    game.pause();
    tick.mockClear();
    step.mockClear();
    frame(1000 / 60);
    expect(step).not.toHaveBeenCalled();
    expect(tick).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it('delivers a key press as an edge on exactly one physics tick', async () => {
    const { game } = await playing();
    const ollies: boolean[] = [];
    const orig = game.surfer.step.bind(game.surfer);
    vi.spyOn(game.surfer, 'step').mockImplementation((input: SurferInput, dt: number) => {
      ollies.push(input.ollie);
      orig(input, dt);
    });
    key('keydown', 'Space');
    frame(1000 / 30); // 4 steps
    expect(ollies).toEqual([true, false, false, false]);
    game.dispose();
  });

  it('Esc pauses (sim frozen) and Esc again resumes', async () => {
    const { game, store } = await playing();
    frame();
    key('keydown', 'Escape');
    frame();
    expect(store.getState().phase).toBe('paused');
    key('keyup', 'Escape');
    const t = game.surfer.state.time;
    for (let i = 0; i < 10; i++) frame();
    expect(game.surfer.state.time).toBe(t);
    key('keydown', 'Escape');
    frame();
    expect(store.getState().phase).toBe('playing');
    frame();
    expect(game.surfer.state.time).toBeGreaterThan(t);
    game.dispose();
  });

  it('survives non-finite and backwards frame times', async () => {
    const { game } = await playing();
    frame();
    const t = game.surfer.state.time;
    rafCb!(NaN);
    rafCb!(clock - 500);
    expect(game.surfer.state.time).toBe(t);
    clock -= 500;
    frame(1000 / 60);
    expect(game.surfer.state.time).toBeCloseTo(t + 2 / 120, 9);
    game.dispose();
  });

  it('holds the combo only for trick airs, the tube and floaters', async () => {
    const { game } = await playing();
    const s = game.surfer.state;
    const update = vi.spyOn(game.scoring, 'update');
    const setState = (patch: Partial<typeof s>) =>
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        Object.assign(s, patch);
        s.time += dt;
      });
    setState({ mode: 'airborne', launchKind: null, inTube: false, floating: false });
    frame(1000 / 120);
    expect(update).toHaveBeenLastCalledWith(s.time, false);
    setState({ mode: 'airborne', launchKind: 'crest' });
    frame(1000 / 120);
    expect(update).toHaveBeenLastCalledWith(s.time, true);
    setState({ mode: 'riding', launchKind: null, inTube: true });
    frame(1000 / 120);
    expect(update).toHaveBeenLastCalledWith(s.time, true);
    setState({ inTube: false, floating: true });
    frame(1000 / 120);
    expect(update).toHaveBeenLastCalledWith(s.time, true);
    game.dispose();
  });

  it('ends a wipeout run in the results with the underwater cut, and surfaces on the next drop-in', async () => {
    const underwater = vi.spyOn(Environment.prototype, 'setUnderwater');
    const { game, store } = await playing();
    const s = game.surfer.state;
    const step = vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
      s.mode = 'wipeout';
      s.wipeoutReason = 'swallowed';
      s.inTube = true;
      s.tubeTime = 1.8;
      s.time += dt;
    });
    underwater.mockClear();
    frame();
    expect(underwater).toHaveBeenLastCalledWith(true);
    expect(store.getState().underwater).toBe(true);
    expect(store.getState().phase).toBe('playing');
    for (let i = 0; i < 120; i++) frame();
    const st = store.getState();
    expect(st.phase).toBe('results');
    expect(st.tubeTime).toBe(0);
    expect(st.run).toMatchObject({ end: 'wipeout', wipeoutReason: 'swallowed', side: 'right' });
    step.mockRestore();
    game.start('right');
    expect(underwater).toHaveBeenLastCalledWith(false);
    expect(store.getState()).toMatchObject({ phase: 'playing', underwater: false, run: null });
    game.dispose();
  });

  it('writes the HUD at most 15 times a second and keeps every ticker item', async () => {
    const { game, store } = await playing();
    let writes = 0;
    const unsub = store.subscribe(() => writes++);
    for (let i = 0; i < 60; i++) frame();
    expect(writes).toBeGreaterThan(5);
    expect(writes).toBeLessThanOrEqual(16);
    game.scoring.award('Ollie', 100, game.surfer.state.time);
    game.scoring.award('Snap', 250, game.surfer.state.time);
    for (let i = 0; i < 6; i++) frame();
    expect(store.getState().ticker.map((t) => t.text)).toEqual(['Ollie', 'Snap']);
    unsub();
    game.dispose();
  });

  it('rebuilds the wave mesh when the config changes', async () => {
    const rebuild = vi.spyOn(WaveMesh.prototype, 'rebuild');
    const { game } = await playing();
    rebuild.mockClear();
    frame();
    expect(rebuild).not.toHaveBeenCalled();
    bumpConfig();
    game.configChanged();
    frame();
    expect(rebuild).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it('creates audio lazily on DROP IN and swallows a failed audio start', async () => {
    const store = createSurfStore();
    const game = new SurfGame(canvas, store);
    await game.load();
    expect(audioInstances).toHaveLength(0);
    audioStartResult = () => Promise.reject(new Error('context closed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    game.start('left');
    expect(audioInstances).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    expect(store.getState().side).toBe('left');
    game.dispose();
  });

  it('dispose stops the loop and releases listeners, audio and the renderer', async () => {
    const { game } = await playing();
    frame();
    const audio = audioInstances[0]!;
    game.dispose();
    expect(cancelRaf).toHaveBeenCalled();
    expect(audio.dispose).toHaveBeenCalled();
    expect(retroInstances[0]!.dispose).toHaveBeenCalled();
    expect(win.__surf).toBeUndefined();
    key('keydown', 'Space');
    game.actions.tick();
    expect(game.actions.isDown('ollie')).toBe(false);
  });

  it('dispose during load does not attach the character or leave the title phase', async () => {
    const store = createSurfStore();
    const game = new SurfGame(canvas, store);
    const p = game.load();
    game.dispose();
    await p;
    expect(store.getState().phase).toBe('loading');
  });
});
