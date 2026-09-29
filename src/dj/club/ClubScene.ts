import * as THREE from 'three';
import { RetroRenderer } from '@/retro/RetroRenderer';
import { retroMaterial } from '@/retro/retroMaterial';
import type { DeckId } from '../constants';
import { eqGain } from '../engine/mixer/MixerCore';
import { audibleBeat, type EngineTelemetry } from '../engine/telemetry';
import type { DjData } from '../store/djStore';
import { isOnAir } from '../ui/browse/browseLogic';
import { CameraRig, type PoseName } from './cameraRig';
import { ClubDirector, type DirectorInput } from './ClubDirector';
import { createCrowd, dancerGeometry, type Crowd } from './crowd';
import { applyBindings } from './gear/bindings';
import { loadGear, loadModelsManifest } from './gear/gearModel';
import { markTexturesDirty, type DeckCanvases, type GearParts } from './gear/proceduralGear';
import { LedWall } from './ledWall';
import { Lights } from './lights';
import { dominantColor } from './palette';
import { buildRoom, disposeTree } from './room';

export interface ClubDeps {
  telemetry: EngineTelemetry;
  getState: () => DjData;
  nowFrame: () => number;
  readSpectrum: (out: Uint8Array<ArrayBuffer>) => void;
  /** The DeckDisplay canvases (the 3D screens and jog displays mirror them). */
  canvases: readonly DeckCanvases[];
  artwork: (deck: DeckId) => HTMLImageElement | null;
}

/** Artwork is downsampled to this many pixels square before picking the LED wall colour. */
const PALETTE_PX = 16;
const BG = '#05040c';
/** The DJ figure is hidden while the camera is within this horizontal distance (m) of it. */
const DJ_HIDE_RADIUS = 0.9;
const DECKS = [0, 1] as const;

/** Director inputs from telemetry + mixer state (only on-air channels count). Exported for tests. */
export function directorInput(s: DjData, t: EngineTelemetry, beat: number, dt: number): DirectorInput {
  let playing = false;
  let filterSweep = 0;
  let lowCut = 0;
  for (const d of DECKS) {
    if (!isOnAir(d, t.decks[d], s.mixer)) continue;
    const ch = s.mixer.ch[d];
    playing = true;
    if (s.mixer.colorFxType === 'FILTER') filterSweep = Math.max(filterSweep, Math.abs(ch.color));
    lowCut = Math.max(lowCut, 1 - Math.min(1, eqGain(ch.low)));
  }
  return {
    dt,
    lowRms: t.levels.lowRms,
    playing,
    beat,
    filterSweep,
    lowCut,
    beatFxDepth: s.mixer.beatFx.on ? s.mixer.beatFx.depth : 0,
  };
}

/** Camera pose for the current view: close-up, the room, or zoomed on a deck whose BROWSE is open. */
export function poseFor(s: DjData): PoseName {
  if (s.ui.view === 'closeup') return 'closeup';
  if (s.decks[0].browseOpen) return 'browse0';
  if (s.decks[1].browseOpen) return 'browse1';
  return 'room';
}

/** The PS2 club: room, crowd, lights, LED wall and the 3D booth, rendered through RetroRenderer. */
export class ClubScene {
  readonly director = new ClubDirector();
  private readonly retro: RetroRenderer;
  private readonly scene = new THREE.Scene();
  /** far just past the fog end (22) so nothing pops at the far plane. */
  private readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 25);
  private readonly rig: CameraRig;
  private readonly room: THREE.Group;
  private readonly crowd: Crowd;
  private readonly lights = new Lights();
  private readonly wall = new LedWall();
  private readonly dj: THREE.Mesh;
  private gear: GearParts | null = null;
  private paletteFor: HTMLImageElement | null = null;
  private paletteCtx: CanvasRenderingContext2D | null = null;
  private disposed = false;
  frames = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly deps: ClubDeps,
  ) {
    this.retro = new RetroRenderer(canvas, { trail: 0.2 });
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 8, 22);
    this.room = buildRoom();
    this.crowd = createCrowd();
    this.scene.add(this.room, this.crowd.mesh, this.lights.group, this.wall.mesh);
    this.dj = new THREE.Mesh(dancerGeometry(), retroMaterial(new THREE.MeshLambertMaterial({ color: '#c9a27a', flatShading: true })));
    this.dj.name = 'dj';
    this.dj.position.set(0, 0.4, 0.6);
    this.dj.scale.setScalar(0.85);
    this.dj.rotation.y = Math.PI;
    this.scene.add(this.dj);
    this.rig = new CameraRig(this.camera);
    void loadModelsManifest()
      .then((m) => loadGear(deps.canvases, m))
      .then((gear) => {
        if (this.disposed) {
          gear.dispose();
          return;
        }
        this.gear = gear;
        this.scene.add(gear.group);
      });
  }

  resize(w: number, h: number): void {
    this.retro.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Fires a drop now (debug / visual checks): strobe burst, hands up, CO₂. */
  forceDrop(): void {
    this.director.state.drop = 1;
    this.director.state.dropCount++;
  }

  private updatePalette(t: EngineTelemetry): void {
    const img = t.master === -1 ? null : this.deps.artwork(t.master);
    if (!img || img === this.paletteFor || !img.complete || img.naturalWidth === 0) return;
    this.paletteFor = img;
    if (!this.paletteCtx) {
      const c = document.createElement('canvas');
      c.width = c.height = PALETTE_PX;
      this.paletteCtx = c.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.paletteCtx;
    if (!ctx) return;
    try {
      ctx.clearRect(0, 0, PALETTE_PX, PALETTE_PX);
      ctx.drawImage(img, 0, 0, PALETTE_PX, PALETTE_PX);
      this.wall.setPalette(dominantColor(ctx.getImageData(0, 0, PALETTE_PX, PALETTE_PX).data));
    } catch {
      // tainted/undecodable image: keep the current palette
    }
  }

  /**
   * One frame. Must run after the DeckDisplay canvases were redrawn this frame (the booth's
   * frame callback is registered first), so the screen/jog textures upload fresh pixels.
   */
  update(dt: number, now: number): void {
    const s = this.deps.getState();
    const t = this.deps.telemetry;
    const beat = t.master === -1 ? 0 : audibleBeat(t, t.master, this.deps.nowFrame());
    const d = this.director.update(directorInput(s, t, beat, dt));
    const u = this.crowd.uniforms;
    // hold the last beat phase when playback stops: the bounce eases out with the energy instead of snapping
    if (!d.idle) u.uBeatPhase.value = d.beatPhase;
    u.uEnergy.value = d.energy;
    u.uDrop.value = d.drop;
    u.uTime.value = now;
    this.dj.position.y = 0.4 + (d.idle ? 0 : Math.abs(Math.sin(Math.PI * d.beatPhase)) * 0.04);
    const pose = poseFor(s);
    // close-up and BROWSE poses sit under the truss, looking through the beams
    this.lights.setCloseup(pose !== 'room');
    this.lights.update(d, now, dt);
    this.deps.readSpectrum(this.wall.spectrum as Uint8Array<ArrayBuffer>);
    this.wall.update(now, beat, d.energy, d.drop, d.idle);
    this.updatePalette(t);

    this.rig.setTarget(pose);
    this.rig.update(dt);
    // The close-up camera is the DJ's own eyes: hide the DJ whenever the camera is inside/near them.
    const cam = this.camera.position;
    this.dj.visible = Math.hypot(cam.x - this.dj.position.x, cam.z - this.dj.position.z) > DJ_HIDE_RADIUS;
    // The 3D gear is only visible from the room: skip bindings and texture uploads in close-up.
    if (s.ui.view === 'room' && this.gear) {
      applyBindings(this.gear.bindings, s, t);
      markTexturesDirty(this.gear.textures);
    }
    this.retro.render(this.scene, this.camera);
    this.frames++;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gear?.dispose();
    this.gear = null;
    this.lights.dispose();
    this.wall.dispose();
    this.crowd.dispose();
    disposeTree(this.room); // includes the room's shared materials
    this.dj.geometry.dispose();
    (this.dj.material as THREE.Material).dispose();
    this.retro.dispose();
  }
}
