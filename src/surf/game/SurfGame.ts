import {
  ArrowHelper,
  AxesHelper,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Material,
  type Mesh,
} from 'three';
import { RetroRenderer } from '@/retro/RetroRenderer';
import { ActionState } from '@/shared/input/ActionState';
import { loadManifest, type TrackEntry } from '@/shared/tracks';
import { SurfAudio } from '../audio/SurfAudio';
import { CAMERA_FAR, CameraRig } from '../camera/CameraRig';
import { Character, loadSurferRig } from '../character/Character';
import { configVersion, SURF_CONFIG, SURFER_LOOK, type Side, type SurferLook } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT, readSurferInput, SURF_BINDINGS, type SurfAction, type SurferInput } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { Environment } from '../render/Environment';
import { Particles } from '../render/Particles';
import { WaveMesh } from '../render/WaveMesh';
import { Scoring } from '../scoring/Scoring';
import { pushTicker, ThrottledWriter, type Phase, type SurfStore, type TickerItem } from '../state/store';
import { impactDistance } from '../wave/impact';
import { sideSign } from '../wave/mirror';
import { PeelController } from '../wave/PeelController';
import { WaveShape } from '../wave/WaveShape';
import { Coach } from './coach';
import type { SurfDebugCamera, SurfDebugHook } from './debugHook';
import './debugHook';
import { FixedStepper } from './FixedStepper';

export interface SurfGameOptions {
  debug?: boolean;
  look?: SurferLook;
}

const END_DELAY = { wipeout: 1.6, kickedOut: 1.0 } as const;
/** Longest frame (s) fed to the stepper and to ambient animation. */
const MAX_FRAME = 0.25;
/** Particles integrate at most this much time per frame (s). */
const MAX_PARTICLE_DT = 0.1;

/**
 * Owns the loop: fixed 120 Hz simulation (surfer, scoring) with render
 * interpolation, plus rendering, audio and HUD store writes (≤ 15 Hz).
 */
export class SurfGame {
  readonly bus = new EventBus<SurfEvent>();
  readonly wave = new WaveShape(SURF_CONFIG.wave);
  readonly surfer = new Surfer(this.wave, SURF_CONFIG.physics, this.bus);
  /** Peel speed over the run (base Vp + seeded fast sections). */
  readonly peel = new PeelController(SURF_CONFIG.wave, SURF_CONFIG.sections);
  readonly scoring: Scoring;
  /** In-game coach: the "▲ PUMP!" prompt when the rider is losing ground to the curl. */
  readonly coach = new Coach();
  readonly actions = new ActionState<SurfAction>(SURF_BINDINGS);
  private readonly retro: RetroRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(SURF_CONFIG.camera.fov, 1, 0.1, CAMERA_FAR);
  /** The wave frame, mirrored for a LEFT via scale.x. */
  private readonly frame = new Group();
  private readonly waveMesh: WaveMesh;
  private readonly particles: Particles;
  private readonly env: Environment;
  private readonly rig: CameraRig;
  private readonly stepper = new FixedStepper(1 / SURF_CONFIG.physics.hz, MAX_FRAME);
  private readonly writer: ThrottledWriter;
  private readonly input: SurferInput = { ...NO_INPUT };
  private readonly renderP = new Vector3();
  private readonly debugLook = new Vector3();
  /** The one debug-hook object, mutated each frame (no per-frame allocation). */
  private readonly hook: SurfDebugHook = { frames: 0, phase: 'loading', score: 0, mode: 'riding', x: 0, calls: 0, triangles: 0, fps: 60, peel: 0, fast: false, seed: 0, shot: 'chase', coach: this.coach.state };
  private readonly look: SurferLook;
  private character: Character | null = null;
  private audio: SurfAudio | null = null;
  private tracks: TrackEntry[] = [];
  private side: Side = 'right';
  private phase: Phase = 'loading';
  private ticker: TickerItem[] = [];
  private tickerId = 0;
  private nowPlayingKey = 0;
  /** Frame distance along the reef (floating origin), m. */
  private travel = 0;
  /** Simulation time stepped during the current frame (s). */
  private frameSimDt = 0;
  /** Water/particle clock: advances with the sim while playing, freezes on pause. */
  private waterTime = 0;
  /** Foam scroll distance (m): advances at the live peel speed with the water clock (freezes on pause). */
  private waterTravel = 0;
  /** Runs started (mixed into each run's fast-section seed). */
  private runs = 0;
  /** The current run's fast-section seed (exposed on the debug hook for replays). */
  private seed = 0;
  /** Carve keys' screen meaning (see CameraRig.keyFacing), latched while a carve key is held. */
  private keyFacing: 1 | -1 = 1;
  private endAt = -1;
  private raf = 0;
  private last: number | null = null;
  private frames = 0;
  private fps = 60;
  private disposed = false;
  private configSeen = configVersion();
  private gizmo: Group | null = null;
  private normalArrow: ArrowHelper | null = null;
  private readonly gizmoMarkers: Line[] = [];
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: SurfStore,
    opts: SurfGameOptions = {},
  ) {
    this.look = opts.look ?? SURFER_LOOK;
    this.writer = new ThrottledWriter(store, 15);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
    if (coarse) {
      // Phones: fewer wave vertices keeps the ≥ 30 fps budget (desktop stays 160 × 64).
      SURF_CONFIG.mesh.columns = 112;
      SURF_CONFIG.mesh.rows = 44;
    }
    this.retro = new RetroRenderer(canvas);
    this.retro.renderer.info.autoReset = false;
    this.scene.add(this.frame);
    this.waveMesh = new WaveMesh(this.wave, SURF_CONFIG.mesh);
    this.frame.add(this.waveMesh.group);
    this.particles = new Particles(this.wave, this.bus, this.surfer.state);
    this.frame.add(this.particles.points);
    // Environment sets the fog/background and adds the camera to the scene.
    this.env = new Environment(this.scene, this.camera);
    this.frame.add(this.env.frameStuff);
    this.rig = new CameraRig(this.camera, SURF_CONFIG.camera, this.wave);
    this.scoring = new Scoring(SURF_CONFIG.scoring, {
      onAward: (a) => this.pushTicker(a.repeated ? `${a.name} (repeat)` : a.name, a.points),
      onBank: (b) => {
        this.pushTicker(b.multiplier > 1 ? `COMBO ×${b.multiplier}` : 'BANKED', b.points);
        this.audio?.onBank(b.points, b.multiplier);
      },
      onLost: (pot) => this.pushTicker('COMBO LOST', -pot),
    });
    this.cleanups.push(
      this.scoring.attach(this.bus),
      this.bus.on('landed', () => this.character?.onLanded()),
      this.bus.on('pump', (e) => this.coach.onPump(e.time)),
      this.bus.onAny((e) => this.audio?.onEvent(e)),
      this.actions.attach(window),
    );
    if (typeof document !== 'undefined') {
      // A hidden tab stops requestAnimationFrame; pause so the ride doesn't resume mid-air. Resume is manual.
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') this.pause();
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    if (opts.debug) this.buildGizmo();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.cleanups.push(() => ro.disconnect());
    this.resize();
    this.surfer.reset();
    this.rig.snap(this.surfer.state, this.side);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Loads the character model and the track manifest, then shows the title. */
  async load(): Promise<void> {
    const [{ rig }, manifest] = await Promise.all([
      loadSurferRig(this.look),
      loadManifest().catch((e: unknown) => {
        console.warn('No track manifest; surfing without music.', e);
        return { version: 1 as const, tracks: [] };
      }),
    ]);
    const character = new Character(rig, this.look);
    if (this.disposed) {
      character.dispose();
      return;
    }
    this.tracks = manifest.tracks;
    this.character = character;
    this.frame.add(character.root);
    // The title shows whatever way the frame currently faces (canonical = a LEFT): stay regular there too.
    character.setSide(this.frame.scale.x < 0 ? 'right' : 'left');
    this.setPhase('title');
  }

  /** DROP IN (must be called from a user gesture: it starts audio). */
  start(side: Side): void {
    if (this.disposed || this.phase === 'loading' || this.phase === 'playing') return;
    this.side = side;
    this.frame.scale.x = sideSign(side);
    this.character?.setSide(side);
    this.resetView();
    this.scoring.reset();
    this.ticker = [];
    this.coach.reset(this.store.getState().guide);
    this.stepper.reset();
    this.actions.reset();
    this.startAudio();
    this.writer.flush(performance.now());
    this.store.setState({ side, run: null, underwater: false, fastSection: false, score: 0, pot: 0, multiplier: 0, tubeTime: 0, speedKmh: 0, ticker: [], pumpPrompt: false, pumpCount: 0 });
    this.setPhase('playing');
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.audio?.pause();
    this.setPhase('paused');
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.stepper.reset();
    this.actions.reset();
    this.audio?.resume();
    this.setPhase('playing');
  }

  quitToTitle(): void {
    if (this.phase === 'loading' || this.phase === 'title') return;
    this.audio?.pause();
    // The title shows a fresh wave: no underwater camera or tumbling rider left from a wipeout.
    this.resetView();
    this.writer.flush(performance.now());
    this.coach.reset(false);
    this.store.setState({ run: null, underwater: false, fastSection: false, pumpPrompt: false });
    this.setPhase('title');
  }

  setGizmo(visible: boolean): void {
    if (this.gizmo) this.gizmo.visible = visible;
  }

  /** Called by the debug panel after it edits SURF_CONFIG and bumps the config version. */
  configChanged(): void {
    this.syncConfig();
  }

  private syncConfig(): void {
    const v = configVersion();
    if (v === this.configSeen) return;
    this.configSeen = v;
    this.waveMesh.rebuild();
    this.placeGizmoMarkers();
  }

  private startAudio(): void {
    try {
      this.audio ??= new SurfAudio((t) => this.store.setState({ nowPlaying: { key: ++this.nowPlayingKey, title: t.title, artist: t.artist } }));
    } catch (e) {
      console.warn('Web Audio unavailable; surfing without sound.', e);
      return;
    }
    this.audio.start(this.tracks).catch((e: unknown) => console.warn('Audio failed to start', e));
  }

  /** Surfer back at the drop-in, camera snapped behind, above water, no end-of-run timer. */
  private resetView(): void {
    // A fresh seeded fast-section schedule per run; the peel is back at base speed.
    this.seed = (Date.now() ^ Math.imul(++this.runs, 0x9e3779b9)) >>> 0;
    this.peel.reset(this.seed);
    this.surfer.reset();
    this.character?.reset();
    this.rig.snap(this.surfer.state, this.side);
    this.env.setUnderwater(false);
    this.particles.clear();
    this.particles.setBubbles(false);
    this.travel = 0;
    this.endAt = -1;
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.writer.flush(performance.now());
    this.store.setState({ phase });
  }

  private pushTicker(text: string, points: number): void {
    // Built from our own copy: the writer's pending patch replaces `ticker` wholesale.
    this.ticker = pushTicker(this.ticker, { id: ++this.tickerId, text, points });
    this.writer.push({ ticker: this.ticker });
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.retro.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.particles.setScale(this.camera, this.retro.internalResolution.height);
  }

  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = 0;
    if (Number.isFinite(now)) {
      if (this.last !== null) {
        const raw = (now - this.last) / 1000;
        dt = raw > 0 ? Math.min(MAX_FRAME, raw) : 0;
      }
      this.last = now;
    }
    if (dt > 0) this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;

    let alpha = 1;
    this.frameSimDt = 0;
    if (this.phase === 'playing') {
      // Input is ticked inside each physics step (edges are per tick).
      alpha = this.stepper.advance(dt, this.step);
    } else {
      this.actions.tick();
      if (this.phase === 'paused' && this.actions.pressedThisFrame('pause')) this.resume();
      // Behind the title/results the water keeps moving; a pause freezes it.
      else if (this.phase !== 'paused') this.frameSimDt = dt;
    }
    this.waterTime += this.frameSimDt;
    this.waterTravel += this.frameSimDt * this.peel.speed;
    this.syncConfig();
    this.render(now, dt, alpha);
    this.publish(now);
  };

  private readonly step = (dt: number): void => {
    if (this.phase !== 'playing') return;
    this.actions.tick();
    if (this.actions.pressedThisFrame('pause')) {
      this.pause();
      return;
    }
    const s = this.surfer.state;
    // The keys' screen meaning follows the camera, but is latched while a carve key is held: a camera
    // swinging round mid-cutback never inverts the turn in progress.
    if (!this.actions.isDown('carveLeft') && !this.actions.isDown('carveRight')) this.keyFacing = this.rig.keyFacing;
    readSurferInput(this.actions, this.side, this.input, this.keyFacing);
    const section = this.peel.update(s.time + dt);
    this.surfer.setPeelSpeed(this.peel.speed);
    this.surfer.step(this.input, dt);
    this.coach.update(s);
    // Only a live ride (riding / airborne) announces a section or makes one: none after a wipeout / kick-out.
    const live = s.mode === 'riding' || s.mode === 'airborne';
    if (section === 'start' && live) this.bus.emit({ type: 'fastSection', time: s.time, boost: this.peel.boost });
    else if (section === 'end' && live) this.bus.emit({ type: 'sectionMade', time: s.time });
    this.frameSimDt += dt;
    this.scoring.update(s.time, (s.mode === 'airborne' && s.launchKind !== null) || s.inTube || s.floating);
    this.travel += this.peel.speed * dt;
    if ((s.mode === 'wipeout' || s.mode === 'kickedOut') && this.endAt < 0) {
      this.endAt = s.time;
      if (s.mode === 'wipeout') {
        this.env.setUnderwater(true);
        this.particles.setBubbles(true, s.p);
        this.store.setState({ underwater: true });
      }
    }
    if (this.endAt >= 0 && s.time - this.endAt > END_DELAY[s.mode === 'wipeout' ? 'wipeout' : 'kickedOut']) this.endRun();
  };

  private endRun(): void {
    const s = this.surfer.state;
    this.scoring.bank();
    this.writer.flush(performance.now());
    this.store.setState({
      score: this.scoring.score,
      pot: 0,
      multiplier: 0,
      tubeTime: 0,
      pumpPrompt: false,
      run: {
        score: this.scoring.score,
        side: this.side,
        end: s.mode === 'wipeout' ? 'wipeout' : 'kickedOut',
        wipeoutReason: s.wipeoutReason,
        bestCombo: this.scoring.bestCombo,
        longestTube: this.scoring.longestTube,
        tricks: this.scoring.tricksLanded,
        durationSec: this.endAt,
      },
    });
    this.setPhase('results');
  }

  private render(now: number, dt: number, alpha: number): void {
    // `dt` (real frame time) drives the camera springs; the sim clock drives everything that pauses.
    const s = this.surfer.state;
    const underwater = s.mode === 'wipeout' && this.endAt >= 0;
    // Frame coordinates: the rig mirrors once for the side.
    this.renderP.lerpVectors(this.surfer.prevP, s.p, alpha);
    // Sim dt: a pause freezes the rider's pose springs too.
    this.character?.update(this.surfer, alpha, this.frameSimDt);
    this.rig.update(s, this.renderP, this.side, underwater, dt, this.waterTime);
    if (this.gizmo && window.__surfCam) this.applyDebugCamera(window.__surfCam);
    this.env.update(Number.isFinite(now) ? now / 1000 : 0, this.travel, sideSign(this.side));
    this.particles.tubeView = this.rig.shot === 'tube';
    this.particles.update(Math.min(MAX_PARTICLE_DT, this.frameSimDt), this.phase === 'playing');
    this.waveMesh.update(this.waterTime, this.waterTravel);
    if (this.normalArrow) {
      this.normalArrow.position.copy(this.renderP);
      this.normalArrow.setDirection(s.normal);
    }
    this.retro.renderer.info.reset();
    this.retro.render(this.scene, this.camera);
    this.frames++;
  }

  private publish(now: number): void {
    const s = this.surfer.state;
    if (this.phase === 'playing') {
      const speed = this.surfer.worldSpeed(this.peel.speed);
      this.audio?.update(s, speed, { distance: impactDistance(s.p.x, this.wave.params.tubeDepth), fast: this.peel.level });
      this.writer.push({
        score: this.scoring.score,
        pot: this.scoring.pot,
        multiplier: this.scoring.multiplier,
        // A wipeout inside the barrel never exits it: stop the TUBE timer with the ride.
        tubeTime: s.mode === 'riding' || s.mode === 'airborne' ? s.tubeTime : 0,
        speedKmh: Math.round(speed * 3.6),
        fastSection: this.peel.active && (s.mode === 'riding' || s.mode === 'airborne'),
        pumpPrompt: this.coach.state.show,
        pumpCount: this.coach.state.pumps,
      });
    }
    if (Number.isFinite(now)) this.writer.tick(now);
    const info = this.retro.renderer.info.render;
    const hook = this.hook;
    hook.frames = this.frames;
    hook.phase = this.phase;
    hook.score = this.scoring.score;
    hook.mode = s.mode;
    hook.x = s.param.x;
    hook.calls = info.calls;
    hook.triangles = info.triangles;
    hook.fps = Math.round(this.fps);
    hook.peel = this.peel.speed;
    hook.fast = this.peel.active && (s.mode === 'riding' || s.mode === 'airborne');
    hook.seed = this.seed;
    hook.shot = this.rig.shot;
    window.__surf = hook;
  }

  /** ?debug free camera: wave-frame coordinates, mirrored with the frame like everything else. */
  private applyDebugCamera(cam: SurfDebugCamera): void {
    this.frame.updateMatrixWorld();
    this.camera.position.fromArray(cam.pos).applyMatrix4(this.frame.matrixWorld);
    this.camera.lookAt(this.debugLook.fromArray(cam.look).applyMatrix4(this.frame.matrixWorld));
  }

  private buildGizmo(): void {
    const g = new Group();
    g.add(new AxesHelper(3));
    for (const color of ['#ff4040', '#ffe040', '#40ff80']) {
      const geo = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 5, 0)]);
      const line = new Line(geo, new LineBasicMaterial({ color, depthTest: false }));
      this.gizmoMarkers.push(line);
      g.add(line);
    }
    this.normalArrow = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 1.2, '#ff00ff');
    g.add(this.normalArrow);
    this.gizmo = g;
    this.frame.add(g);
    this.placeGizmoMarkers();
  }

  /** Red / yellow / green markers at x = −D, 0, Ls (tracks live config edits). */
  private placeGizmoMarkers(): void {
    const { tubeDepth, shoulderLength } = this.wave.params;
    [-tubeDepth, 0, shoulderLength].forEach((x, i) => this.gizmoMarkers[i]?.position.setX(x));
  }

  private disposeGizmo(): void {
    this.gizmo?.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((c) => c());
    this.bus.clear();
    this.audio?.dispose();
    this.character?.dispose();
    this.particles.dispose();
    this.waveMesh.dispose();
    this.env.dispose();
    this.disposeGizmo();
    this.retro.dispose();
    if (window.__surf) delete window.__surf;
  }
}
