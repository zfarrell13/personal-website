import * as THREE from 'three';
import type { DirectorState } from './ClubDirector';
import { mulberry32 } from './crowd';
import { disposeTree } from './room';

const HEAD_COLORS = ['#ff3b8a', '#3aa0ff', '#ffd23a', '#7b2ff7', '#35e06b', '#ff7a1a'];
const WASH_COLORS = ['#3cff6b', '#ff3b3b', '#3cff6b', '#ff3b3b'];
const LASER_COUNT = 8;
const CO2_COUNT = 240;
const HIDDEN_Y = -100;
/** Time constant (s) of the idle ↔ live blend of the moving heads. */
const LIVE_TAU = 0.6;
/** Beam cone opacity factor in the close-up (DJ's-eye) view, where the camera looks through the cones. */
const CLOSEUP_CONE_GAIN = 0.35;

/**
 * Moving heads (additive cones), colour wash, strobe, lasers and CO₂ jets — all
 * driven by the ClubDirector state and an explicit scene time. No per-frame
 * allocation: every buffer and material is created once in the constructor.
 */
export class Lights {
  readonly group = new THREE.Group();
  private readonly heads: THREE.Object3D[] = [];
  private readonly headMats: THREE.MeshBasicMaterial[] = [];
  private readonly lasers: THREE.Mesh[] = [];
  private readonly laserMat: THREE.MeshBasicMaterial;
  private readonly strobe: THREE.PointLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly wash: THREE.PointLight[] = [];
  private readonly co2: THREE.Points;
  private readonly co2Pos: THREE.BufferAttribute;
  private readonly co2Vel = new Float32Array(CO2_COUNT * 3);
  private readonly co2Life = new Float32Array(CO2_COUNT);
  private readonly rnd = mulberry32(11);
  /** −1 until the first update, so a Lights built mid-set doesn't fire a stale burst. */
  private lastDropCount = -1;
  private co2Active = false;
  /** 0 = idle chase, 1 = beat-synced sweep; eased so heads never snap when playback starts/stops. */
  private live = 0;
  private coneGain = 1;
  /** Last bar phase heard while playing (the director zeroes it when idle; the fade-out holds it). */
  private liveBar = 0;

  constructor() {
    this.group.name = 'lights';
    this.ambient = new THREE.HemisphereLight('#6a70ff', '#120818', 0.35);
    this.group.add(this.ambient);

    const coneGeo = new THREE.ConeGeometry(0.7, 6, 14, 1, true);
    coneGeo.translate(0, -3, 0); // apex at the pivot
    HEAD_COLORS.forEach((c, i) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(-3.75 + i * 1.5, 5.05, -0.5);
      const mat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      pivot.add(new THREE.Mesh(coneGeo, mat));
      this.heads.push(pivot);
      this.headMats.push(mat);
      this.group.add(pivot);
    });

    WASH_COLORS.forEach((c, i) => {
      const p = new THREE.PointLight(c, 0, 14);
      p.position.set(-6 + i * 4, 4, -4);
      this.wash.push(p);
      this.group.add(p);
    });

    this.laserMat = new THREE.MeshBasicMaterial({
      color: '#3cff6b',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const laserGeo = new THREE.BoxGeometry(0.02, 0.02, 12);
    laserGeo.translate(0, 0, -6); // fan out from the emitter towards the crowd
    for (let i = 0; i < LASER_COUNT; i++) {
      const beam = new THREE.Mesh(laserGeo, this.laserMat);
      beam.position.set(0, 4.6, 1.4);
      beam.visible = false;
      this.lasers.push(beam);
      this.group.add(beam);
    }

    this.strobe = new THREE.PointLight('#ffffff', 0, 30);
    this.strobe.position.set(0, 5, -3);
    this.group.add(this.strobe);

    const geo = new THREE.BufferGeometry();
    this.co2Pos = new THREE.BufferAttribute(new Float32Array(CO2_COUNT * 3).fill(HIDDEN_Y), 3);
    this.co2Pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.co2Pos);
    this.co2 = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: '#dfe8ff', size: 0.2, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.co2.frustumCulled = false;
    this.co2.visible = false;
    this.group.add(this.co2);
  }

  /**
   * Close-up (DJ's-eye) view: the camera sits under the truss and looks through the beams, so the
   * cones draw front faces only and fainter (otherwise they read as opaque slabs). `amount` (0 = room,
   * 1 = under the truss) follows the camera dolly: the opacity fades continuously, and the face mode
   * (which cannot blend) flips at the midpoint, where the cones are already half faded.
   */
  setCloseup(amount: number): void {
    const k = Math.min(1, Math.max(0, amount));
    this.coneGain = 1 + (CLOSEUP_CONE_GAIN - 1) * k;
    const side = k >= 0.5 ? THREE.FrontSide : THREE.DoubleSide;
    for (const m of this.headMats) {
      if (m.side !== side) {
        m.side = side;
        m.needsUpdate = true;
      }
    }
  }

  /** `time` is scene time in seconds (drives idle chases); `dt` advances the CO₂ particles. */
  update(s: DirectorState, time: number, dt: number): void {
    this.live += ((s.idle ? 0 : 1) - this.live) * (1 - Math.exp(-Math.max(0, dt) / LIVE_TAU));
    const k = this.live;
    const idleBar = time * 0.05;
    if (!s.idle) this.liveBar = s.barPhase;
    const liveBar = this.liveBar;
    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i]!;
      const idleZ = Math.sin(2 * Math.PI * idleBar + i * 0.9) * 0.35;
      const liveZ = Math.sin(2 * Math.PI * liveBar + i * 0.9) * 0.65;
      h.rotation.z = idleZ + (liveZ - idleZ) * k;
      // +x tilt swings the downward cone towards −z, i.e. over the dance floor (not back at the booth)
      const idleX = 0.35 + 0.2 * Math.cos(2 * Math.PI * idleBar * 2 + i);
      const liveX = 0.35 + 0.2 * Math.cos(2 * Math.PI * liveBar * 2 + i);
      h.rotation.x = idleX + (liveX - idleX) * k;
      const idleOp = 0.06 + 0.04 * Math.sin(time + i);
      const liveOp = 0.06 + 0.14 * s.energy;
      this.headMats[i]!.opacity = (idleOp + (liveOp - idleOp) * k) * this.coneGain;
    }
    for (let i = 0; i < this.wash.length; i++) {
      this.wash[i]!.intensity = (s.idle ? 2 : 4 + 20 * s.energy) * (0.6 + 0.4 * Math.sin(time * 0.7 + i));
    }
    this.ambient.intensity = 0.25 + 0.3 * s.energy;
    this.strobe.intensity = s.strobe * 120;
    this.laserMat.opacity = s.laser * 0.8;
    const lasersOn = s.laser > 0.01;
    for (let i = 0; i < this.lasers.length; i++) {
      const l = this.lasers[i]!;
      l.visible = lasersOn;
      l.rotation.y = (i - (LASER_COUNT - 1) / 2) * 0.12 + Math.sin(time * 1.5 + i) * 0.1 * s.laser;
      l.rotation.x = -0.25 + Math.sin(time * 2 + i * 0.5) * 0.08;
    }
    this.updateCo2(s.dropCount, dt);
  }

  /** CO₂ jets: a burst from two floor emitters in front of the booth on each new drop. */
  private updateCo2(dropCount: number, dt: number): void {
    const arr = this.co2Pos.array as Float32Array;
    const vel = this.co2Vel;
    const life = this.co2Life;
    if (this.lastDropCount < 0) this.lastDropCount = dropCount;
    if (dropCount !== this.lastDropCount) {
      this.lastDropCount = dropCount;
      this.co2Active = true;
      for (let i = 0; i < CO2_COUNT; i++) {
        const side = i % 2 ? 1 : -1;
        arr[i * 3] = side * 2.2 + (this.rnd() - 0.5) * 0.2;
        arr[i * 3 + 1] = 0.4;
        arr[i * 3 + 2] = -1.4 + (this.rnd() - 0.5) * 0.2;
        vel[i * 3] = (this.rnd() - 0.5) * 0.6;
        vel[i * 3 + 1] = 5 + this.rnd() * 3;
        vel[i * 3 + 2] = (this.rnd() - 0.5) * 0.6;
        life[i] = 0.8 + this.rnd() * 0.8;
      }
    }
    if (!this.co2Active) return;
    let alive = 0;
    const damp = Math.pow(0.97, dt * 60); // frame-rate independent drag
    for (let i = 0; i < CO2_COUNT; i++) {
      if (life[i]! <= 0) {
        arr[i * 3 + 1] = HIDDEN_Y;
        continue;
      }
      alive++;
      life[i] = life[i]! - dt;
      arr[i * 3] = arr[i * 3]! + vel[i * 3]! * dt;
      arr[i * 3 + 1] = arr[i * 3 + 1]! + vel[i * 3 + 1]! * dt;
      arr[i * 3 + 2] = arr[i * 3 + 2]! + vel[i * 3 + 2]! * dt;
      vel[i * 3 + 1] = vel[i * 3 + 1]! * damp;
    }
    this.co2Active = alive > 0;
    this.co2.visible = this.co2Active;
    this.co2Pos.needsUpdate = true;
  }

  dispose(): void {
    disposeTree(this.group);
    for (const l of [...this.wash, this.strobe, this.ambient]) l.dispose();
  }
}
