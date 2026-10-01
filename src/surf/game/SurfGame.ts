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
import { getMusicPlayer, type MusicPlayer } from '@/site/music/MusicPlayer';
import { SurfAudio } from '../audio/SurfAudio';
import { barrelDepth, tubeCutoffHz } from '../audio/synth';
import { CAMERA_FAR, CameraRig } from '../camera/CameraRig';
import { Character, loadSurferRig } from '../character/Character';
import { configVersion, SURF_CONFIG, SURFER_LOOK, type Side, type SurferLook } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT, readSurferInput, SURF_BINDINGS, type SurfAction, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
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
import { Coach, COACH_CONFIG } from './coach';
import { SectionDirector } from './SectionDirector';
import type { SurfDebugCamera, SurfDebugHook } from './debugHook';
import './debugHook';
import { FixedStepper } from './FixedStepper';

export interface SurfGameOptions {
  debug?: boolean;
  look?: SurferLook;
  /** The site-wide soundtrack the game muffles (tube) and ducks (pause). Default getMusicPlayer(); tests inject a spy. */
  music?: Pick<MusicPlayer, 'setMuffleHz' | 'setDuck' | 'start'>;
  /** Start in attract mode (see setAttract): the key listeners are never attached until play. */
  attract?: boolean;
  /** Attract mode's frame cap (see setAttractFps). Default 30. */
  attractFps?: number;
}

/** Music level under the pause menu. */
const PAUSE_DUCK = 0.35;
/** Low-pass cutoff with no muffle (open water). */
const OPEN_HZ = 20000;

const END_DELAY = { wipeout: 1.6, kickedOut: 1.0 } as const;
/** Longest frame (s) fed to the stepper and to ambient animation. */
const MAX_FRAME = 0.25;
/** Particles integrate at most this much time per frame (s). */
const MAX_PARTICLE_DT = 0.1;
/** Attract mode's default frame cap. */
const ATTRACT_FPS = 30;
/** Slack (ms) under the attract frame interval, so a display's frame that lands a little early still counts. */
const ATTRACT_FRAME_SLACK_MS = 4;
const attractMinFrameMs = (fps: number): number => 1000 / fps - ATTRACT_FRAME_SLACK_MS;

/**
 * Owns the loop: fixed 120 Hz simulation (surfer, scoring) with render
 * interpolation, plus rendering, audio and HUD store writes (≤ 15 Hz).
 */
export class SurfGame {
  readonly bus = new EventBus<SurfEvent>();
  readonly wave = new WaveShape(SURF_CONFIG.wave);
  readonly surfer = new Surfer(this.wave, SURF_CONFIG.physics, this.bus);
  /** Peel speed over the run (base Vp + seeded fast sections). */
  readonly peel = new PeelController(SURF_CONFIG.wave, SURF_CONFIG.sections, SURF_CONFIG.peak);
  readonly scoring: Scoring;
  /** In-game coach: the "▲ PUMP!" prompt when the rider is losing ground to the curl. */
  readonly coach = new Coach();
  readonly actions = new ActionState<SurfAction>(SURF_BINDINGS);
  private readonly retro: RetroRenderer;
  private readonly scene = new Scene();
  /** The scene is drawn underwater (the wipeout, or the rig's early swallow cut). */
  private viewUnderwater = false;
  /** The camera lens the particle sizes were last scaled for. */
  private scaledFov = SURF_CONFIG.camera.fov;
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
  private readonly hook: SurfDebugHook = { frames: 0, phase: 'loading', score: 0, mode: 'riding', x: 0, calls: 0, triangles: 0, fps: 60, peel: 0, fast: false, seed: 0, shot: 'chase', pose: 'stance', coach: this.coach.state, peak: { phase: 'none', x: 0, amp: 0, xPitch: 0, made: null } };
  private readonly look: SurferLook;
  private character: Character | null = null;
  private audio: SurfAudio | null = null;
  private readonly music: Pick<MusicPlayer, 'setMuffleHz' | 'setDuck' | 'start'>;
  private side: Side = 'right';
  private phase: Phase = 'loading';
  private ticker: TickerItem[] = [];
  private tickerId = 0;
  /** Frame distance along the reef (floating origin), m. */
  private travel = 0;
  /** `travel` at the start of the last sim step (the scenery blends it like the rider). */
  private prevTravel = 0;
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
  /** Fast sections and their peaks around the surfer's step (race, pitch, closeout, SECTION MADE / AIR). */
  readonly sections = new SectionDirector(this.peel, this.wave, this.surfer, this.bus, SURF_CONFIG.peak);
  /** Frame shift (m along x) of the pitch's surge not yet applied to the camera. */
  private surgeShift = 0;
  /** ?debug autopilot (window.__surfBot) and the pump rhythm it was made for. */
  private bot: ((dt: number) => SurferInput) | null = null;
  private botPump = NaN;
  /** Carve keys' screen meaning (see CameraRig.keyFacing), latched while a carve key is held. */
  private keyFacing: 1 | -1 = 1;
  private endAt = -1;
  private raf = 0;
  /** A frame is requested (the loop is running). */
  private looping = false;
  /** Attract mode: the stage behind a site page. Title camera only, no input, no runs. */
  private attract = false;
  /** Reduced motion: in attract mode, one still frame instead of a loop. */
  private frozen = false;
  /** Attract mode draws a frame only once this much time (ms) has passed since the last (the fps cap). */
  private attractMinFrameMs = attractMinFrameMs(ATTRACT_FPS);
  private last: number | null = null;
  private frames = 0;
  private fps = 60;
  private disposed = false;
  private configSeen = configVersion();
  private gizmo: Group | null = null;
  private normalArrow: ArrowHelper | null = null;
  private readonly gizmoMarkers: Line[] = [];
  private readonly cleanups: Array<() => void> = [];
  /** Removes the game's key listeners (they preventDefault the bound keys); null while detached (attract). */
  private detachKeys: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: SurfStore,
    opts: SurfGameOptions = {},
  ) {
    this.look = opts.look ?? SURFER_LOOK;
    this.music = opts.music ?? getMusicPlayer();
    this.attract = opts.attract ?? false;
    if (opts.attractFps !== undefined) this.setAttractFps(opts.attractFps);
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
    this.particles.setAttract(this.attract);
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
      this.bus.on('sectionMade', (e) => this.coach.hush(e.time, COACH_CONFIG.madeGrace)),
      () => this.sections.dispose(),
      this.bus.onAny((e) => this.audio?.onEvent(e)),
      () => this.detachKeys?.(),
    );
    if (!this.attract) this.detachKeys = this.actions.attach(window);
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
    this.rig.setTitle(true); // loading, then the title: the title / attract shot
    this.rig.snap(this.surfer.state, this.side);
    this.wake();
  }

  /** Loads the character model, then shows the title. */
  async load(): Promise<void> {
    const { rig } = await loadSurferRig(this.look);
    const character = new Character(rig, this.look);
    if (this.disposed) {
      character.dispose();
      return;
    }
    this.character = character;
    this.frame.add(character.root);
    // The title shows whatever way the frame currently faces (canonical = a LEFT): stay regular there too.
    character.setSide(this.frame.scale.x < 0 ? 'right' : 'left');
    this.setPhase('title');
    this.wake(); // a frozen stage redraws its still with the rider in it
  }

  /** DROP IN (must be called from a user gesture: it starts the effects audio and the site music). */
  start(side: Side): void {
    if (this.disposed || this.attract || this.phase === 'loading' || this.phase === 'playing') return;
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
    this.music.setDuck(1);
    this.writer.flush(performance.now());
    this.store.setState({ side, run: null, underwater: false, fastSection: false, score: 0, pot: 0, multiplier: 0, tubeTime: 0, speedKmh: 0, ticker: [], pumpPrompt: false, pumpCount: 0 });
    this.setPhase('playing');
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.audio?.pause();
    this.music.setDuck(PAUSE_DUCK);
    this.setPhase('paused');
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.stepper.reset();
    this.actions.reset();
    // A crouch held into the pause is dropped (the keys were all let go): no pop on resume.
    this.surfer.cancelOllie();
    this.audio?.resume();
    this.music.setDuck(1);
    this.setPhase('playing');
  }

  quitToTitle(): void {
    if (this.phase === 'loading' || this.phase === 'title') return;
    this.audio?.pause();
    this.releaseMusic();
    // The title shows a fresh wave: no underwater camera or tumbling rider left from a wipeout.
    this.resetView();
    this.writer.flush(performance.now());
    this.coach.reset(false);
    this.store.setState({ run: null, underwater: false, fastSection: false, pumpPrompt: false });
    this.setPhase('title');
  }

  /**
   * Attract mode (the stage behind a site page): any run quits to the title, input is ignored and DROP IN
   * refused; the title camera keeps rendering. Off: back to the playable title.
   */
  setAttract(on: boolean): void {
    if (this.disposed || on === this.attract) return;
    if (on) this.quitToTitle();
    this.attract = on;
    this.particles.setAttract(on);
    this.actions.reset();
    // Detached, the page keeps its keys: Space scrolls, arrows move, Enter follows a link.
    this.detachKeys?.();
    this.detachKeys = on ? null : this.actions.attach(window);
    this.wake();
  }

  /** Attract mode's frame cap (fps, > 0): the site draws the title menu's backdrop faster than a section's. */
  setAttractFps(fps: number): void {
    if (!(fps > 0)) return;
    this.attractMinFrameMs = attractMinFrameMs(fps);
  }

  /** Reduced motion: in attract mode the stage draws one frame and stops. Play mode is unaffected. */
  setFrozen(on: boolean): void {
    if (this.disposed || on === this.frozen) return;
    this.frozen = on;
    this.wake();
  }

  /** Starts the loop if it is stopped (a frozen stage, or at construction); the first frame has dt = 0. */
  private wake(): void {
    if (this.disposed || this.looping) return;
    this.looping = true;
    this.last = null;
    this.raf = requestAnimationFrame(this.loop);
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
    // Inside the DROP IN gesture: the site player can unlock and play synchronously (idempotent if it already plays).
    try {
      this.music.start().catch((e: unknown) => console.warn('Music failed to start', e));
    } catch (e) {
      console.warn('Music unavailable; surfing without it.', e);
    }
    try {
      this.audio ??= new SurfAudio();
    } catch (e) {
      console.warn('Web Audio unavailable; surfing without sound.', e);
      return;
    }
    this.audio.start().catch((e: unknown) => console.warn('Audio failed to start', e));
  }

  /** The site music leaves the game as it found it: open (no tube muffle) and at full level. */
  private releaseMusic(): void {
    this.music.setMuffleHz(OPEN_HZ);
    this.music.setDuck(1);
  }

  /** Surfer back at the drop-in, camera snapped behind, above water, no end-of-run timer. */
  private resetView(): void {
    // A fresh seeded fast-section schedule per run; the peel is back at base speed.
    this.seed = (Date.now() ^ Math.imul(++this.runs, 0x9e3779b9)) >>> 0;
    this.peel.reset(this.seed);
    this.sections.reset();
    this.surgeShift = 0;
    this.bot = null;
    this.surfer.reset();
    this.character?.reset();
    this.rig.snap(this.surfer.state, this.side);
    this.env.setUnderwater(false);
    this.viewUnderwater = false;
    this.particles.clear();
    this.particles.setBubbles(false);
    this.travel = 0;
    this.prevTravel = 0;
    this.endAt = -1;
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.rig.setTitle(phase === 'title' || phase === 'loading');
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
    this.wake(); // a frozen stage redraws at the new size
  }

  private readonly loop = (now: number): void => {
    // Frozen in attract: this frame is drawn, and no next one is asked for (wake() restarts it).
    this.looping = !(this.attract && this.frozen);
    if (this.looping) this.raf = requestAnimationFrame(this.loop);
    // Attract (a dimmed backdrop) is capped (setAttractFps): skipped frames leave the clock alone, so dt accumulates.
    if (this.attract && !this.frozen && this.last !== null && Number.isFinite(now) && now - this.last < this.attractMinFrameMs) return;
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
    } else if (this.attract) {
      this.frameSimDt = dt; // the title water keeps moving; keys belong to the page
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
    if (this.gizmo) this.autopilot(dt);
    this.prevTravel = this.travel;
    const surge = this.sections.step(this.input, dt);
    this.surgeShift += surge;
    this.coach.shift(surge);
    this.coach.update(s, this.sections.race);
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

  /** ?debug: window.__surfBot steers and pumps (the keys' ollie / stall still apply). */
  private autopilot(dt: number): void {
    const want = window.__surfBot;
    if (!want) return;
    if (!this.bot || this.botPump !== want.pumpEvery) {
      this.bot = lineBot(this.surfer, this.wave, { pumpEvery: want.pumpEvery });
      this.botPump = want.pumpEvery;
    }
    const b = this.bot(dt);
    this.input.carve = b.carve;
    this.input.spin = 0;
    this.input.pump = b.pump;
  }

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
    // The pitch's surge moves the whole frame past the rider at up to ~40 m/s: the camera moves with
    // the frame (as the rider does), so its springs don't trail behind the shift.
    if (this.surgeShift !== 0) {
      this.rig.shiftAlongWave(this.surgeShift, this.side);
      this.surgeShift = 0;
    }
    // Paused, the camera holds still too (its tube-hold timer must not run out under the pause menu).
    if (this.phase !== 'paused') this.rig.update(s, this.renderP, this.side, underwater, dt, this.waterTime);
    // The rig cuts underwater a moment before the swallow when the closing barrel leaves it no tube
    // pose: the scene (fog, sky) goes under with it.
    const viewUnderwater = underwater || this.rig.shot === 'underwater';
    if (viewUnderwater !== this.viewUnderwater) {
      this.viewUnderwater = viewUnderwater;
      this.env.setUnderwater(viewUnderwater);
    }
    // The tube view's wider lens: particle sizes follow the projection.
    if (this.camera.fov !== this.scaledFov) {
      this.scaledFov = this.camera.fov;
      this.particles.setScale(this.camera, this.retro.internalResolution.height);
    }
    if (this.gizmo && window.__surfCam) this.applyDebugCamera(window.__surfCam);
    // The scenery scrolls with `travel` blended between the last two steps, like the rider (the surge
    // moves it up to ~0.4 m a step).
    const travel = this.phase === 'playing' ? this.prevTravel + (this.travel - this.prevTravel) * alpha : this.travel;
    this.env.update(Number.isFinite(now) ? now / 1000 : 0, travel, sideSign(this.side));
    this.particles.tubeView = this.rig.shot === 'tube';
    this.particles.peakPitching = this.peel.peak.phase === 'pitching';
    this.particles.update(Math.min(MAX_PARTICLE_DT, this.frameSimDt), this.phase === 'playing');
    // The peak, interpolated like the rider (the surge moves it fast).
    const pk = this.wave.peak;
    const prev = this.sections.prevPeak;
    this.waveMesh.update(this.waterTime, this.waterTravel, prev.x + (pk.x - prev.x) * alpha, prev.amp + (pk.amp - prev.amp) * alpha, pk.width);
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
      // The same cutoff SurfAudio puts on its tube low-pass.
      this.music.setMuffleHz(tubeCutoffHz(barrelDepth(s)));
      this.writer.push({
        score: this.scoring.score,
        pot: this.scoring.pot,
        multiplier: this.scoring.multiplier,
        // A wipeout inside the barrel never exits it: stop the TUBE timer with the ride.
        // …and once the view has cut underwater for the swallow (a moment early), the banner goes with it.
        tubeTime: (s.mode === 'riding' || s.mode === 'airborne') && !this.viewUnderwater ? s.tubeTime : 0,
        speedKmh: Math.round(speed * 3.6),
        fastSection: this.peel.active && (s.mode === 'riding' || s.mode === 'airborne'),
        pumpPrompt: this.coach.state.show,
        pumpTube: this.coach.state.tube,
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
    hook.pose = this.character?.dominantPose() ?? 'stance';
    const peak = this.peel.peak;
    hook.peak.phase = peak.phase;
    hook.peak.x = peak.x;
    hook.peak.amp = peak.amp;
    hook.peak.xPitch = peak.xPitch;
    hook.peak.made = this.sections.made;
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
    this.looping = false;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((c) => c());
    this.bus.clear();
    this.audio?.dispose();
    this.releaseMusic();
    this.character?.dispose();
    this.particles.dispose();
    this.waveMesh.dispose();
    this.env.dispose();
    this.disposeGizmo();
    this.retro.dispose();
    if (window.__surf) delete window.__surf;
  }
}
