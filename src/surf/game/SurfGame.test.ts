import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpConfig, SURF_CONFIG } from '../config';
import type { SurferInput } from '../physics/input';
import { CameraRig } from '../camera/CameraRig';
import { Character } from '../character/Character';
import { Environment } from '../render/Environment';
import { Particles } from '../render/Particles';
import { WaveMesh } from '../render/WaveMesh';
import type { OceanLayout } from '../render/waveGeometry';
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

// The site-wide music player (Web Audio + <audio>): a spy, both as the default and when injected.
const fakeMusic = () => ({ setMuffleHz: vi.fn(), setDuck: vi.fn(), start: vi.fn(() => Promise.resolve()) });
let defaultMusic = fakeMusic();
vi.mock('@/site/music/MusicPlayer', () => ({ getMusicPlayer: () => defaultMusic }));

vi.mock('../character/Character', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../character/Character')>();
  const { buildProceduralRig } = await import('../character/rig');
  return { ...orig, loadSurferRig: async (look: never) => ({ rig: buildProceduralRig(look), procedural: true }) };
});

const { SurfGame } = await import('./SurfGame');

// --- Browser globals the engine touches. ------------------------------------

let rafCb: ((t: number) => void) | null = null;
/** requestAnimationFrame calls so far (a stopped loop stops asking). */
let rafRequests = 0;
const cancelRaf = vi.fn();
let win: EventTarget & { __surf?: unknown };

beforeEach(() => {
  rafCb = null;
  retroInstances.length = 0;
  audioInstances.length = 0;
  audioStartResult = () => Promise.resolve();
  defaultMusic = fakeMusic();
  cancelRaf.mockClear();
  win = new EventTarget();
  vi.stubGlobal('window', win);
  rafRequests = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafCb = cb;
    rafRequests++;
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

  it("latches the carve keys' screen meaning while one is held, so a camera swing never inverts a turn", async () => {
    const facing = vi.spyOn(CameraRig.prototype, 'keyFacing', 'get').mockReturnValue(1);
    const { game } = await playing(); // a RIGHT: → = +1 (toward the lip) while the camera looks down the line
    const carves: number[] = [];
    const orig = game.surfer.step.bind(game.surfer);
    vi.spyOn(game.surfer, 'step').mockImplementation((input: SurferInput, dt: number) => {
      carves.push(input.carve);
      orig(input, dt);
    });
    key('keydown', 'ArrowRight');
    frame();
    expect(carves.at(-1)).toBe(1);
    facing.mockReturnValue(-1); // the camera swings round behind a rider heading for the curl
    frame();
    frame();
    expect(carves.at(-1)).toBe(1); // still held: latched
    key('keyup', 'ArrowRight');
    frame();
    key('keydown', 'ArrowRight');
    frame();
    expect(carves.at(-1)).toBe(-1); // pressed afresh: follows the camera
    game.dispose();
  });

  it('letting go of a carve key always reaches the physics as carve 0 — with the latch flipped, mid-frame, or on blur', async () => {
    const facing = vi.spyOn(CameraRig.prototype, 'keyFacing', 'get').mockReturnValue(1);
    const { game } = await playing();
    const carves: number[] = [];
    const orig = game.surfer.step.bind(game.surfer);
    vi.spyOn(game.surfer, 'step').mockImplementation((input: SurferInput, dt: number) => {
      carves.push(input.carve);
      orig(input, dt);
    });
    // Held while the camera swings round (the key's meaning stays latched), then let go: carve 0.
    key('keydown', 'ArrowRight');
    frame();
    facing.mockReturnValue(-1);
    frame();
    expect(carves.at(-1)).toBe(1);
    key('keyup', 'ArrowRight');
    frame();
    expect(carves.at(-1)).toBe(0);
    // A press and release between two frames (mid-frame): one tick of carve, then 0.
    key('keydown', 'ArrowLeft');
    key('keyup', 'ArrowLeft');
    carves.length = 0;
    frame(1000 / 30);
    expect(carves[0]).not.toBe(0);
    expect(carves.slice(1).every((c) => c === 0)).toBe(true);
    // Held when the window loses focus (the key-up never arrives): released.
    key('keydown', 'ArrowRight');
    frame();
    expect(carves.at(-1)).not.toBe(0);
    window.dispatchEvent(new Event('blur'));
    frame();
    expect(carves.at(-1)).toBe(0);
    game.dispose();
  });

  it('resets the character (snapping its rate-limited board heading) at the start of every run', async () => {
    const reset = vi.spyOn(Character.prototype, 'reset');
    const { game } = await playing();
    expect(reset).toHaveBeenCalled();
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

  it('auto-pauses when the tab is hidden while playing; resume stays manual', async () => {
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    });
    vi.stubGlobal('document', doc);
    const { game, store } = await playing();
    frame();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(store.getState().phase).toBe('paused');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(store.getState().phase).toBe('paused');
    game.dispose();
    // The listener is gone after dispose: hiding no longer touches the (disposed) game.
    const pause = vi.spyOn(game, 'pause');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(pause).not.toHaveBeenCalled();
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

  it('quitting to the title after a wipeout surfaces the camera and resets the surfer', async () => {
    const { game, store } = await playing();
    const s = game.surfer.state;
    const step = vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
      s.mode = 'wipeout';
      s.wipeoutReason = 'swallowed';
      s.time += dt;
    });
    for (let i = 0; i < 120; i++) frame();
    expect(store.getState().phase).toBe('results');
    step.mockRestore();
    const rigUpdate = vi.spyOn(CameraRig.prototype, 'update');
    game.quitToTitle();
    frame();
    expect(store.getState()).toMatchObject({ phase: 'title', run: null, underwater: false });
    expect(game.surfer.state.mode).toBe('riding');
    expect(rigUpdate).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'right', false, expect.any(Number), expect.any(Number));
    game.dispose();
  });

  it('quitting from a paused wipeout also surfaces', async () => {
    const { game, store } = await playing();
    const s = game.surfer.state;
    vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
      s.mode = 'wipeout';
      s.time += dt;
    });
    frame();
    game.pause();
    const rigUpdate = vi.spyOn(CameraRig.prototype, 'update');
    game.quitToTitle();
    frame();
    expect(store.getState().underwater).toBe(false);
    expect(rigUpdate.mock.lastCall![3]).toBe(false);
    game.dispose();
  });

  it('pause (touch button / Esc) freezes the character animation', async () => {
    const charUpdate = vi.spyOn(Character.prototype, 'update');
    const { game, store } = await playing();
    game.pause();
    expect(store.getState().phase).toBe('paused');
    expect(audioInstances[0]!.pause).toHaveBeenCalled();
    charUpdate.mockClear();
    frame();
    expect(charUpdate).toHaveBeenCalledWith(game.surfer, expect.any(Number), 0);
    game.dispose();
  });

  it('keeps the debug gizmo markers at x = -D, 0, Ls after config edits', async () => {
    const { SURF_CONFIG } = await import('../config');
    const store = createSurfStore();
    const game = new SurfGame(canvas, store, { debug: true });
    const markers = () =>
      (game as unknown as { gizmo: { children: Array<{ type: string; position: { x: number } }> } }).gizmo.children
        .filter((c) => c.type === 'Line')
        .map((c) => c.position.x);
    const { tubeDepth, shoulderLength } = SURF_CONFIG.wave;
    expect(markers()).toEqual([-tubeDepth, 0, shoulderLength]);
    try {
      SURF_CONFIG.wave.tubeDepth = 7;
      SURF_CONFIG.wave.shoulderLength = 50;
      bumpConfig();
      game.configChanged();
      expect(markers()).toEqual([-7, 0, 50]);
    } finally {
      SURF_CONFIG.wave.tubeDepth = tubeDepth;
      SURF_CONFIG.wave.shoulderLength = shoulderLength;
      bumpConfig();
    }
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

  it('a roundhouse from the physics shows ROUNDHOUSE on the HUD ticker', async () => {
    const { game, store } = await playing();
    game.bus.emit({ type: 'roundhouse', time: game.surfer.state.time, degrees: 250, replacesSnap: false });
    for (let i = 0; i < 6; i++) frame();
    expect(store.getState().ticker.map((t) => [t.text, t.points])).toEqual([['Roundhouse', 500]]);
    game.dispose();
  });

  it('builds a lighter wave mesh on coarse-pointer (touch) devices only', () => {
    const saved = { ...SURF_CONFIG.mesh };
    try {
      const vertices = (coarse: boolean | null) => {
        Object.assign(SURF_CONFIG.mesh, saved);
        (win as unknown as { matchMedia?: unknown }).matchMedia =
          coarse === null ? undefined : (q: string) => ({ matches: coarse && q === '(pointer: coarse)' });
        const built = vi.spyOn(WaveMesh.prototype, 'rebuild');
        const game = new SurfGame(canvas, createSurfStore());
        const mesh = built.mock.contexts[0] as WaveMesh;
        const geo = mesh.ocean.geometry;
        const L = geo.userData as OceanLayout;
        const count = geo.getAttribute('position').count;
        built.mockRestore();
        game.dispose();
        // The ridden columns × profile rows the game asked for, inside the ocean grid's layout.
        expect(count).toBe(L.columns * L.rows);
        return { columns: L.simColumns, rows: L.profileSamples };
      };
      expect(vertices(true)).toEqual({ columns: 112, rows: 44 });
      expect(SURF_CONFIG.mesh).toEqual({ columns: 112, rows: 44 });
      expect(vertices(false)).toEqual({ columns: 160, rows: 64 });
      expect(vertices(null)).toEqual({ columns: 160, rows: 64 });
    } finally {
      Object.assign(SURF_CONFIG.mesh, saved);
      delete (win as unknown as { matchMedia?: unknown }).matchMedia;
    }
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

  describe('site music', () => {
    async function withMusic() {
      const music = fakeMusic();
      const store = createSurfStore();
      const game = new SurfGame(canvas, store, { music });
      await game.load();
      clock = performance.now();
      frame();
      return { game, store, music };
    }

    it('DROP IN starts the site player (it is a gesture) at full level; the default is getMusicPlayer()', async () => {
      const { game, music } = await withMusic();
      expect(music.start).not.toHaveBeenCalled();
      game.start('right');
      expect(music.start).toHaveBeenCalledTimes(1);
      expect(music.setDuck).toHaveBeenLastCalledWith(1);
      game.dispose();

      const { game: g2 } = await playing();
      expect(defaultMusic.start).toHaveBeenCalledTimes(1);
      g2.dispose();
    });

    it('the tube muffles the music with the same cutoff as the tube low-pass, and leaving opens it again', async () => {
      const { game, music } = await withMusic();
      game.start('right');
      const s = game.surfer.state;
      let inTube = true;
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.mode = 'riding';
        s.inTube = inTube;
        s.tubeDepth = 1;
        s.time += dt;
      });
      frame();
      expect(music.setMuffleHz.mock.lastCall![0]).toBeCloseTo(800, 6); // tubeCutoffHz(1)
      inTube = false;
      frame();
      expect(music.setMuffleHz).toHaveBeenLastCalledWith(20000);
      // A wipeout inside the barrel opens it too (no tubeExit).
      inTube = true;
      frame();
      expect(music.setMuffleHz.mock.lastCall![0]).toBeLessThan(20000);
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.mode = 'wipeout';
        s.time += dt;
      });
      frame();
      expect(music.setMuffleHz).toHaveBeenLastCalledWith(20000);
      game.dispose();
    });

    it('pause ducks the music to 0.35, resume restores it', async () => {
      const { game, music } = await withMusic();
      game.start('right');
      game.pause();
      expect(music.setDuck).toHaveBeenLastCalledWith(0.35);
      game.resume();
      expect(music.setDuck).toHaveBeenLastCalledWith(1);
      game.dispose();
    });

    it('quitting to the title and dispose open and un-duck the music', async () => {
      const { game, music } = await withMusic();
      game.start('right');
      const s = game.surfer.state;
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.mode = 'riding';
        s.inTube = true;
        s.tubeDepth = 1;
        s.time += dt;
      });
      frame();
      game.pause();
      music.setMuffleHz.mockClear();
      music.setDuck.mockClear();
      game.quitToTitle();
      expect(music.setMuffleHz).toHaveBeenLastCalledWith(20000);
      expect(music.setDuck).toHaveBeenLastCalledWith(1);
      music.setMuffleHz.mockClear();
      music.setDuck.mockClear();
      game.dispose();
      expect(music.setMuffleHz).toHaveBeenLastCalledWith(20000);
      expect(music.setDuck).toHaveBeenLastCalledWith(1);
    });
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

  it('a fast section speeds up the peel, flashes the HUD and pays SECTION MADE when the rider is past its peak at the pitch and rides out the surge', async () => {
    const saved = { ...SURF_CONFIG.sections };
    Object.assign(SURF_CONFIG.sections, { minGap: 0.1, maxGap: 0.1, minRace: 0.3, maxRace: 0.3, minBoost: 0.4, maxBoost: 0.4, ramp: 0.1 });
    try {
      const { game, store } = await playing();
      const s = game.surfer.state;
      const peels: number[] = [];
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.mode = 'riding';
        s.time += dt;
        peels.push(game.surfer.peelSpeed);
      });
      const events: string[] = [];
      const pitches: boolean[] = [];
      game.bus.onAny((e) => events.push(e.type));
      game.bus.on('peakPitch', (e) => pitches.push(e.made));
      for (let i = 0; i < 12; i++) frame(); // 0.2 s: the section is on
      for (let i = 0; i < 4; i++) frame(); // let the throttled HUD writer flush
      expect(store.getState().fastSection).toBe(true);
      expect(Math.max(...peels)).toBeCloseTo(SURF_CONFIG.wave.peelSpeed * 1.4, 6);
      for (let i = 0; i < 45; i++) frame(); // past the pitch (0.4 s), its surge (≥ 0.4 s) and the ramp down
      expect(events).toContain('fastSection');
      // The rider (held at the drop-in) is past the peak at the pitch: the section closes behind them.
      expect(events).toContain('peakPitch');
      expect(events).toContain('sectionMade');
      expect(pitches).toEqual([true]);
      expect(store.getState().ticker.map((t) => t.text)).toContain('Section Made');
      game.dispose();
    } finally {
      Object.assign(SURF_CONFIG.sections, saved);
    }
  });

  it('no SECTION MADE when the rider wipes out during the section', async () => {
    const saved = { ...SURF_CONFIG.sections };
    Object.assign(SURF_CONFIG.sections, { minGap: 0.1, maxGap: 0.1, minRace: 0.3, maxRace: 0.3, ramp: 0.1 });
    try {
      const { game } = await playing();
      const s = game.surfer.state;
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.time += dt;
        if (s.time > 0.25) s.mode = 'wipeout';
      });
      const events: string[] = [];
      game.bus.onAny((e) => events.push(e.type));
      for (let i = 0; i < 40; i++) frame();
      expect(events).toContain('fastSection');
      expect(events).not.toContain('sectionMade');
      game.dispose();
    } finally {
      Object.assign(SURF_CONFIG.sections, saved);
    }
  });

  it('once the rider is no longer live (wipeout delay) there is no fastSection event, HUD flag or hook.fast; hook.seed is exposed', async () => {
    const saved = { ...SURF_CONFIG.sections };
    Object.assign(SURF_CONFIG.sections, { minGap: 1, maxGap: 1, minRace: 0.6, maxRace: 0.6, ramp: 0.1 });
    try {
      const { game, store } = await playing();
      const s = game.surfer.state;
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.time += dt;
        s.mode = 'wipeout';
      });
      const events: string[] = [];
      game.bus.onAny((e) => events.push(e.type));
      let fastHook = false;
      for (let i = 0; i < 150; i++) {
        frame();
        fastHook ||= (win.__surf as { fast: boolean }).fast;
      }
      expect(events).not.toContain('fastSection');
      expect(store.getState().fastSection).toBe(false);
      expect(fastHook).toBe(false);
      expect((win.__surf as { seed: number }).seed).toEqual(expect.any(Number));
      game.dispose();
    } finally {
      Object.assign(SURF_CONFIG.sections, saved);
    }
  });

  it('coach: a no-input ride prompts ▲ PUMP on the HUD and hook, counts pumps, and clears on results; GUIDE off never prompts', async () => {
    const { game, store } = await playing();
    for (let i = 0; i < 60 * 4 && !store.getState().pumpPrompt; i++) frame();
    expect(store.getState().pumpPrompt).toBe(true);
    expect(win.__surf).toMatchObject({ coach: { show: true } });
    // An ↑ pump reaches the coach through the event bus and the HUD.
    key('keydown', 'ArrowUp');
    frame();
    key('keyup', 'ArrowUp');
    for (let i = 0; i < 4; i++) frame();
    expect(store.getState().pumpCount).toBe(1);
    // Pause freezes the coach with the sim.
    game.pause();
    const phase = game.coach.state.beatPhase;
    for (let i = 0; i < 20; i++) frame();
    expect(game.coach.state.beatPhase).toBe(phase);
    game.resume();
    for (let i = 0; i < 60 * 12 && store.getState().phase !== 'results'; i++) frame();
    expect(store.getState()).toMatchObject({ phase: 'results', pumpPrompt: false });

    store.setState({ guide: false });
    game.start('right');
    for (let i = 0; i < 60 * 12 && store.getState().phase === 'playing'; i++) {
      frame();
      expect(store.getState().pumpPrompt).toBe(false);
    }
    expect(store.getState().phase).toBe('results');
    game.dispose();
  });

  it('dispose during load does not attach the character or leave the title phase', async () => {
    const store = createSurfStore();
    const game = new SurfGame(canvas, store);
    const p = game.load();
    game.dispose();
    await p;
    expect(store.getState().phase).toBe('loading');
  });

  it('attract mode quits a run to the title, ignores input and DROP IN, and keeps rendering the title', async () => {
    const { game, store } = await playing();
    frame();
    game.setAttract(true);
    expect(store.getState().phase).toBe('title');
    const retro = retroInstances[0]!;
    const renders = retro.render.mock.calls.length;
    const tick = vi.spyOn(game.actions, 'tick');
    const press = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
    win.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false); // the page keeps its keys
    frame(1000 / 30);
    frame(1000 / 30);
    expect(tick).not.toHaveBeenCalled();
    expect(retro.render.mock.calls.length).toBe(renders + 2);
    game.start('left');
    expect(store.getState().phase).toBe('title');
    game.setAttract(false);
    frame();
    expect(tick).toHaveBeenCalledTimes(1);
    const again = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
    win.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true); // play mode: the game has its keys back
    game.start('left');
    expect(store.getState().phase).toBe('playing');
    game.dispose();
  });

  it('attract mode releases the site music when it quits a run: full level, no tube muffle', async () => {
    const { game } = await playing();
    frame();
    defaultMusic.setDuck.mockClear();
    defaultMusic.setMuffleHz.mockClear();
    game.setAttract(true);
    expect(defaultMusic.setDuck).toHaveBeenLastCalledWith(1);
    expect(defaultMusic.setMuffleHz).toHaveBeenLastCalledWith(20000);
    game.dispose();
  });

  it('created in attract mode, the game never takes the keys until play', async () => {
    const game = new SurfGame(canvas, createSurfStore(), { attract: true });
    await game.load();
    const press = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
    win.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    game.setAttract(false);
    const again = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
    win.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
    game.dispose();
  });

  it('the spray follows the mode: attract particles behind a site page, the play look on /surf', async () => {
    const spy = vi.spyOn(Particles.prototype, 'setAttract');
    const played = new SurfGame(canvas, createSurfStore());
    expect(spy.mock.calls).toEqual([[false]]); // play mode: the play look from the start
    played.dispose();
    spy.mockClear();
    const game = new SurfGame(canvas, createSurfStore(), { attract: true });
    await game.load();
    game.setAttract(false);
    game.setAttract(true);
    expect(spy.mock.calls).toEqual([[true], [false], [true]]);
    game.dispose();
    spy.mockRestore();
  });

  it('attract mode draws at ~30 fps (every other 60 Hz frame); play mode draws every frame', async () => {
    const game = new SurfGame(canvas, createSurfStore(), { attract: true });
    await game.load();
    clock = performance.now();
    frame();
    const retro = retroInstances[0]!;
    const drawn = retro.render.mock.calls.length;
    for (let i = 0; i < 10; i++) frame(1000 / 60);
    expect(retro.render.mock.calls.length).toBe(drawn + 5);
    for (let i = 0; i < 12; i++) frame(1000 / 120);
    expect(retro.render.mock.calls.length).toBe(drawn + 8); // 120 Hz: every 4th
    game.setAttract(false);
    const before = retro.render.mock.calls.length;
    for (let i = 0; i < 10; i++) frame(1000 / 60);
    expect(retro.render.mock.calls.length).toBe(before + 10);
    game.dispose();
  });

  it('the attract cap is settable: 12 fps draws every 5th 60 Hz frame; back to 30 draws every other', async () => {
    const game = new SurfGame(canvas, createSurfStore(), { attract: true, attractFps: 12 });
    await game.load();
    clock = performance.now();
    frame();
    const retro = retroInstances[0]!;
    let drawn = retro.render.mock.calls.length;
    for (let i = 0; i < 20; i++) frame(1000 / 60);
    expect(retro.render.mock.calls.length).toBe(drawn + 4);
    for (let i = 0; i < 20; i++) frame(1000 / 120);
    expect(retro.render.mock.calls.length).toBe(drawn + 6); // 120 Hz: every 10th
    game.setAttractFps(30);
    drawn = retro.render.mock.calls.length;
    for (let i = 0; i < 10; i++) frame(1000 / 60);
    expect(retro.render.mock.calls.length).toBe(drawn + 5);
    game.setAttract(false); // play mode ignores the cap
    drawn = retro.render.mock.calls.length;
    game.setAttractFps(12);
    for (let i = 0; i < 10; i++) frame(1000 / 60);
    expect(retro.render.mock.calls.length).toBe(drawn + 10);
    game.dispose();
  });

  it('attract mode from a paused run or the results also lands on the title', async () => {
    const { game, store } = await playing();
    game.pause();
    game.setAttract(true);
    expect(store.getState().phase).toBe('title');
    game.dispose();
  });

  it('frozen (reduced motion) in attract: renders one frame and stops the loop; play mode keeps running', async () => {
    const store = createSurfStore();
    const game = new SurfGame(canvas, store);
    await game.load();
    clock = performance.now();
    frame();
    const retro = retroInstances[0]!;
    game.setFrozen(true); // play mode: unaffected
    const before = rafRequests;
    frame();
    frame();
    expect(rafRequests).toBe(before + 2);
    game.setAttract(true);
    const renders = retro.render.mock.calls.length;
    const asked = rafRequests;
    frame(); // the one frozen frame
    expect(retro.render.mock.calls.length).toBe(renders + 1);
    expect(rafRequests).toBe(asked); // loop stopped
    game.setFrozen(false); // motion allowed again: the loop restarts
    expect(rafRequests).toBe(asked + 1);
    frame();
    expect(rafRequests).toBe(asked + 2);
    game.setFrozen(true);
    frame();
    const stopped = rafRequests;
    game.setAttract(false); // back to play: the loop runs even though frozen is set
    expect(rafRequests).toBe(stopped + 1);
    game.dispose();
  });
});
