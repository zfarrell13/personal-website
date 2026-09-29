import { Vector3 } from 'three';
import { configVersion, type PhysicsParams } from '../config';
import { clamp, DEG, smoothstep, wrapAngle } from '../math/scalar';
import type { WaveParam, WaveShape } from '../wave/WaveShape';
import type { EventBus, GrabKind, GrabRecord, LaunchKind, SurfEvent, WipeoutReason } from './events';
import type { SurferInput } from './input';

export type SurferMode = 'riding' | 'airborne' | 'wipeout' | 'kickedOut';

export interface SurferState {
  mode: SurferMode;
  /** Simulation time (s) since the drop-in. */
  time: number;
  /** Position and velocity in the wave frame. */
  p: Vector3;
  v: Vector3;
  /** Surface params of the contact point (riding) or of the air's anchor point on the face (airborne). */
  param: WaveParam;
  /** Contact normal (riding; upright on a floater) / the anchor's up-facing normal (airborne). */
  normal: Vector3;
  /** Unit board direction. Riding: follows v. Airborne: horizontal takeoff direction (spin is `airYaw`). */
  heading: Vector3;
  airYaw: number;
  airTime: number;
  launchKind: LaunchKind | null;
  grab: GrabKind | null;
  carve: number;
  stalling: boolean;
  /** Signed yaw rate (rad/s) from carving (riding) or spinning (airborne). */
  turnRate: number;
  inTube: boolean;
  tubeTime: number;
  /** 0 at the curl, 1 at the back of the tube. */
  tubeDepth: number;
  floating: boolean;
  floatTime: number;
  sincePump: number;
  /** Toggled by every Revert (riding switch/fakie). */
  stanceFlipped: boolean;
  wipeoutReason: WipeoutReason | null;
}

const CREST_EPS = 0.004;
/** The rideable face ends where the surface normal's y drops below this (face going vertical / overhanging). */
const FACE_MIN_NY = 0.2;
/** A floater mount always has enough pop to rise this far (m) past the top of the lip. */
const MOUNT_CLEARANCE = 0.1;
/**
 * The face end is discontinuous in x (a steep band opening below an upper ledge). Any sudden move of
 * the air anchor goes into a blend offset that fades at no more than this speed (m/s), so the rider
 * never teleports.
 */
const BLEND_SPEED = 3;
/** Riding: if clamping to the face end would move the rider this much (m) beyond |v|·dt, drop off instead. */
const DROP_SLACK = 0.02;
const WORLD_UP = new Vector3(0, 1, 0);
/** The turn sense flips only once the board's line is this far off straight up / down the face (sine of the angle). */
const TURN_SENSE_HYSTERESIS = 0.2;
const DROP_IN = { x: 3.5, t: 0.5, along: 2, down: 4 };

/**
 * What an air is anchored to. 'jump' = ollie / crest air (judged landing); 'mount' = climbing onto
 * the lip top at the start of a floater; 'dismount' = dropping from the lip back onto the face.
 * Mount and dismount are silent: no launched / landed events, spin and grab inputs ignored.
 * A mount rides up the wall onto the lip: it touches down when it reaches the lip top (rising).
 * 'drop' = silently falling off an upper ledge of the face whose end dropped away under the rider.
 */
type AirKind = 'jump' | 'mount' | 'dismount' | 'drop';

/**
 * Wave-anchored air: p = S(x, tAnchor) + axis·h + residual·w + blend, where x integrates the lateral
 * speed, axis is the take-off anchor's up normal (tilted halfway to world up for a crest air), h is a
 * 1-D ballistic height, the residual (the launch point's offset from the anchor line) fades out
 * linearly by touchdown and the blend absorbs anchor jumps, fading at ≤ BLEND_SPEED. Touchdown is
 * h ≤ 0 on the way down with the blend gone, which is exactly the surface point S(x, tAnchor).
 */
interface AirPath {
  kind: AirKind;
  /** Anchor t at launch (face air: never above the face end at the current x). */
  tAnchor: number;
  h0: number;
  vUp: number;
  /** dx/dt carried through the air. */
  vx: number;
  /** Face-frame velocity at launch (along e1, up the face), restored on landing. */
  va: number;
  vu: number;
  residual: Vector3;
  /** Time to touchdown; the residual is gone by then. */
  flightTime: number;
  blend: Vector3;
}

/**
 * The surfer state machine (riding | airborne | wipeout | kickedOut), stepped at
 * a fixed rate. Pure TypeScript — no rendering — so it runs headless in tests.
 */
export class Surfer {
  readonly state: SurferState;
  /** State at the start of the last step, for render interpolation. */
  readonly prevP = new Vector3();
  readonly prevHeading = new Vector3(1, 0, 0);

  private readonly sx = new Vector3();
  private readonly st = new Vector3();
  private readonly e1 = new Vector3();
  private readonly eUp = new Vector3();
  private readonly acc = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly outward = new Vector3();
  private readonly scratch = new Vector3();
  private readonly anchorP = new Vector3();
  private readonly up = new Vector3();
  private readonly axis = new Vector3();
  private readonly water = new Vector3();
  private readonly rel = new Vector3();
  private anchorT = 0;
  /** Current peel speed (m/s): the water moves at −vp along x in the wave frame. */
  private vp = 0;
  /** Carve yaw rate (rad/s), easing toward the input's target. */
  private yawRate = 0;
  /** +1 while the board runs toward +x (the shoulder), −1 toward the curl; see TURN_SENSE_HYSTERESIS. */
  private turnSense = 1;
  private crestMemo = { x: NaN, version: -1, t: 0, y: 0 };
  private readonly path: AirPath = {
    kind: 'jump',
    tAnchor: 0,
    h0: 0,
    vUp: 0,
    vx: 0,
    va: 0,
    vu: 0,
    residual: new Vector3(),
    flightTime: 0,
    blend: new Vector3(),
  };
  /** Seconds spent on top of the lip by the floater being dismounted. */
  private floatDuration = 0;
  private readonly crestHeading = new Vector3();
  private atCrest = false;
  private crestTime = -Infinity;
  private snapArmed = false;
  /** In the top band of the face (y ≥ snapTopFrac × crest height). */
  private nearTop = false;
  /** Entered the top band; the snap arms at the apex of the climb. */
  private topPending = false;
  private tubeStart = 0;
  private floatStart = 0;
  private slowTime = 0;
  private carveAccum = 0;
  private carveDir = 0;
  private grabStart = 0;
  private lastGrabTime = -Infinity;
  private grabs: GrabRecord[] = [];

  constructor(
    readonly wave: WaveShape,
    readonly cfg: PhysicsParams,
    readonly bus: EventBus<SurfEvent>,
  ) {
    this.state = {
      mode: 'riding',
      time: 0,
      p: new Vector3(),
      v: new Vector3(),
      param: { x: DROP_IN.x, t: DROP_IN.t },
      normal: new Vector3(0, 1, 0),
      heading: new Vector3(1, 0, 0),
      airYaw: 0,
      airTime: 0,
      launchKind: null,
      grab: null,
      carve: 0,
      stalling: false,
      turnRate: 0,
      inTube: false,
      tubeTime: 0,
      tubeDepth: 0,
      floating: false,
      floatTime: 0,
      sincePump: 10,
      stanceFlipped: false,
      wipeoutReason: null,
    };
    this.reset();
  }

  /** "DROP IN": already up and dropping down the face near the pocket. */
  reset(x = DROP_IN.x, t = DROP_IN.t): void {
    const s = this.state;
    Object.assign(s, {
      mode: 'riding',
      time: 0,
      airYaw: 0,
      airTime: 0,
      launchKind: null,
      grab: null,
      carve: 0,
      stalling: false,
      turnRate: 0,
      inTube: false,
      tubeTime: 0,
      tubeDepth: 0,
      floating: false,
      floatTime: 0,
      sincePump: 10,
      stanceFlipped: false,
      wipeoutReason: null,
    } satisfies Partial<SurferState>);
    s.param.x = x;
    this.vp = this.wave.params.peelSpeed;
    this.yawRate = 0;
    this.turnSense = 1;
    this.crestMemo.x = NaN;
    // Riding starts on the rideable face (never on the vertical / overhanging part).
    t = this.faceEnd(x, Math.min(t, this.crestAt(x).t - CREST_EPS));
    s.param.t = t;
    this.frameAt(x, t);
    this.wave.profile(x, t, s.p);
    s.v.copy(this.e1).multiplyScalar(DROP_IN.along).addScaledVector(this.eUp, -DROP_IN.down);
    this.headingFromMotion(s.heading);
    this.prevP.copy(s.p);
    this.prevHeading.copy(s.heading);
    this.atCrest = false;
    this.snapArmed = false;
    this.nearTop = false;
    this.topPending = false;
    this.slowTime = 0;
    this.carveAccum = 0;
    this.carveDir = 0;
    this.lastGrabTime = -Infinity;
    this.grabs = [];
  }

  /** Speed relative to the (stationary) world water, m/s — what the HUD shows. */
  worldSpeed(peelSpeed: number): number {
    const v = this.state.v;
    return Math.hypot(v.x + peelSpeed, v.y, v.z);
  }

  /** Current peel speed (m/s). */
  get peelSpeed(): number {
    return this.vp;
  }

  /**
   * Change the peel speed. The wave frame moves at the peel speed, so a faster peel shifts every
   * frame velocity by −Δ along x (the rider's world velocity is unchanged): the curl gains on them.
   */
  setPeelSpeed(vp: number): void {
    const d = vp - this.vp;
    if (d === 0) return;
    this.vp = vp;
    const s = this.state;
    if (s.mode === 'riding') {
      s.v.x -= d;
      s.v.addScaledVector(s.normal, -s.v.dot(s.normal));
    } else if (s.mode === 'airborne') {
      this.path.vx -= d;
      this.path.va -= d;
      s.v.x -= d;
    }
  }

  step(input: SurferInput, dt: number): void {
    const s = this.state;
    this.prevP.copy(s.p);
    this.prevHeading.copy(s.heading);
    s.time += dt;
    if (s.mode === 'riding') this.ride(input, dt);
    else if (s.mode === 'airborne') this.air(input, dt);
  }

  /**
   * The board points along its motion through the water: the world velocity v + vp·x̂ (the wave frame
   * only translates, so world directions are frame directions). Kept when that is too slow to tell.
   * (Airborne, setPeelSpeed shifts the path's x-velocity by −Δ, which assumes the launch tangent ≈ x̂.)
   */
  private headingFromMotion(out: Vector3, horizontal = false): void {
    const v = this.state.v;
    const x = v.x + this.vp;
    const y = horizontal ? 0 : v.y;
    const len = Math.hypot(x, y, v.z);
    if (len > this.cfg.minSpeed) out.set(x / len, y / len, v.z / len);
    else if (horizontal) out.set(out.x, 0, out.z).normalize();
  }

  /** Crest param and height at column x, memoized (crestT is expensive). */
  private crestAt(x: number): { x: number; t: number; y: number } {
    const m = this.crestMemo;
    const version = configVersion();
    if (m.x !== x || m.version !== version) {
      m.x = x;
      m.version = version;
      m.t = this.wave.crestT(x);
      m.y = this.wave.profile(x, m.t, this.scratch).y;
    }
    return m;
  }

  private normalY(x: number, t: number): number {
    return this.wave.normal(x, t, this.scratch).y;
  }

  /**
   * Largest t ≤ tMax at column x whose surface normal still has n.y ≥ FACE_MIN_NY:
   * the end of the rideable face (before it turns vertical or overhangs).
   */
  private faceEnd(x: number, tMax: number): number {
    if (this.normalY(x, tMax) >= FACE_MIN_NY) return tMax;
    let hi = tMax;
    let lo = tMax;
    while (lo > 0 && this.normalY(x, lo) < FACE_MIN_NY) {
      hi = lo;
      lo = Math.max(0, lo - 0.02);
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (this.normalY(x, mid) >= FACE_MIN_NY) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Fill e1 (along +x), eUp (up the face) and state.normal at (x, t). */
  private frameAt(x: number, t: number): void {
    this.wave.tangents(x, t, this.sx, this.st);
    this.state.normal.crossVectors(this.sx, this.st).normalize();
    this.e1.copy(this.sx).normalize();
    // A floater rides on top of the lip, where the t-oriented normal points down: keep the frame upright.
    if (this.state.floating && this.state.normal.y < 0) this.state.normal.negate();
    this.eUp.crossVectors(this.state.normal, this.e1).normalize();
  }

  private emit(e: SurfEvent): void {
    this.bus.emit(e);
  }

  private ride(input: SurferInput, dt: number): void {
    const s = this.state;
    const c = this.cfg;
    const w = this.wave;
    const n = s.normal;
    this.frameAt(s.param.x, s.param.t);
    s.carve = input.carve;
    s.stalling = input.stall && !s.floating;

    if (input.ollie && !s.floating) {
      // Ollie: +ollieImpulse along the surface normal (on top of any speed already leaving it).
      const vUp = c.ollieImpulse + Math.max(0, s.v.dot(n));
      this.enterAir('ollie');
      this.beginAir('jump', s.param.t, vUp);
      return;
    }

    // --- forces in the tangent plane. The water moves at −vp along x in the wave frame; the board
    // runs through it with rel = v − water, which is its world velocity (and its heading). ---
    // The water slides along the surface at constant t (e1), never up or down the face: projecting
    // −vp·x̂ instead would give it an up-face part wherever the face is skewed in x (a hidden lift).
    // (worldSpeed / the heading use x̂ for the frame translation: they differ from e1 only by the
    // tangent's tilt, which is small on the open face; the rail, drag and carve all use rel.)
    const water = this.water.copy(this.e1).multiplyScalar(-this.vp);
    const rel = this.rel.subVectors(s.v, water);
    const a = this.acc.set(0, -c.gravity, 0);
    a.addScaledVector(n, -a.dot(n));
    const speed0 = rel.length();
    if (!s.floating && speed0 > 1e-3) {
      // Rail grip: the rail holds the part of gravity across the board's line (fully from gripSpeed
      // up); the part along the line turns height into speed and back, the slip lets it sag.
      const grip = c.railGrip * clamp((speed0 - c.minSpeed) / (c.gripSpeed - c.minSpeed), 0, 1);
      const line = this.tmp2.copy(rel).multiplyScalar(1 / speed0);
      const along = a.dot(line);
      a.multiplyScalar(1 - grip).addScaledVector(line, along * grip);
    }
    const steep = w.steepness(s.param.x, s.param.t);
    a.addScaledVector(this.e1, c.drive * steep);
    const dragK = c.drag * (s.stalling ? c.stallDragMultiplier : 1);
    a.addScaledVector(rel, -dragK * speed0);
    if (input.carve !== 0 && speed0 > 1e-3) a.addScaledVector(rel, (-c.carveBleed * Math.abs(input.carve)) / speed0);
    s.v.addScaledVector(a, dt);
    rel.subVectors(s.v, water);

    // --- carve: rotate the board's line about the normal; toward the lip = +carve. The yaw rate
    // eases toward carve × carveRate / (1 + speed / carveHalfSpeed) with lag carveLag (a weighty
    // rail); the turn radius speed / rate grows with speed. ---
    const sp = rel.length();
    // Which way along the wave the board runs sets the turn sense (+carve = toward the lip either way).
    // It only flips once the board clearly points the other way: pointing straight up or down the
    // face, a flip every tick would cancel the eased yaw rate and pin the board there.
    const along = rel.dot(this.e1);
    if (Math.abs(along) > TURN_SENSE_HYSTERESIS * sp) this.turnSense = along > 0 ? 1 : -1;
    const target = input.carve * (c.carveRate / (1 + sp / c.carveHalfSpeed)) * this.turnSense;
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt / c.carveLag));
    const ang = this.yawRate * dt;
    if (ang !== 0) rel.applyAxisAngle(n, ang);
    s.turnRate = this.yawRate;
    this.trackCarve(input.carve, Math.abs(ang));

    // --- pump: along the board's line, efficiency min(1, since/period), minus a fixed cost. A pump
    // works the face: the net gain scales with the local steepness (a pump on the flats does nothing). ---
    if (input.pump) {
      const eff = Math.min(1, s.sincePump / c.pumpPeriod);
      const face = smoothstep(c.pumpMinSteepness, c.pumpFullSteepness, steep);
      const speed = Math.max(0, sp + (c.pumpImpulse * eff - c.pumpCost) * face);
      if (sp > 1e-3) rel.multiplyScalar(speed / sp);
      else rel.copy(this.e1).multiplyScalar(speed);
      s.sincePump = 0;
      this.emit({ type: 'pump', time: s.time, efficiency: eff });
    } else {
      s.sincePump += dt;
    }
    s.v.addVectors(rel, water);

    // --- integrate + re-project onto the surface ---
    s.p.addScaledVector(s.v, dt);
    w.closestParam(s.p, s.param, s.param);
    const tc = this.crestAt(s.param.x).t;
    if (s.floating) {
      this.floatTick(input, tc);
      if (s.mode !== 'riding') return;
    } else {
      // The rideable face ends at the crest, or earlier where it turns vertical / overhangs.
      const tb = this.faceEnd(s.param.x, Math.min(s.param.t, tc - CREST_EPS));
      if (s.param.t >= tc - CREST_EPS || s.param.t > tb) {
        if (w.profile(s.param.x, tb, this.tmp).distanceTo(this.prevP) > s.v.length() * dt + DROP_SLACK) {
          // The face end dropped away under the rider (an upper ledge ended): fall to the face below.
          this.enterAir(null);
          this.beginAir('drop', tb, 0);
          return;
        }
        if (this.faceEdge(tb, tc, input.carve)) return;
      } else {
        this.atCrest = false;
        w.profile(s.param.x, s.param.t, s.p);
        w.normal(s.param.x, s.param.t, n);
        s.v.addScaledVector(n, -s.v.dot(n));
        if (s.param.t <= 0) {
          // Bottomed out on the flats in front of the wave: the part heading further out is lost.
          this.frameAt(s.param.x, 0);
          const out = s.v.dot(this.eUp);
          if (out < 0) s.v.addScaledVector(this.eUp, -out);
        }
      }
    }
    this.headingFromMotion(s.heading);

    // --- snap arming on the open face: a climb can top out near the crest without reaching the face
    // edge, so the apex of a climb into the top band arms it too.
    const topY = c.snapTopFrac * this.crestAt(s.param.x).y;
    if (!s.floating && s.p.y >= topY) {
      if (!this.nearTop) {
        this.crestHeading.copy(s.heading);
        this.topPending = true;
      }
      this.nearTop = true;
      if (this.topPending && !this.snapArmed && s.v.dot(this.eUp) <= 0) {
        this.topPending = false;
        this.crestTime = s.time;
        this.snapArmed = true;
      }
    } else if (s.p.y < topY - 0.1) {
      this.nearTop = false;
      this.topPending = false;
    }

    // --- snap: heading reversal at the crest within the window, while carving ---
    if (this.snapArmed) {
      if (s.time - this.crestTime > c.snapWindow) this.snapArmed = false;
      else if (input.carve !== 0 && s.heading.angleTo(this.crestHeading) >= c.snapAngle * DEG) {
        this.snapArmed = false;
        this.emit({ type: 'snap', time: s.time });
      }
    }

    this.tubeTick(this.crestAt(s.param.x).y);
    if (s.mode !== 'riding') return;

    // --- lost the wave ---
    this.frameAt(s.param.x, s.param.t);
    if (s.param.x > c.kickOutX && s.v.dot(this.e1) < c.kickOutMinSpeed) {
      this.slowTime += dt;
      if (this.slowTime >= c.kickOutTime) {
        this.kickOut();
      }
    } else {
      this.slowTime = 0;
    }
  }

  /**
   * At the end of the rideable face (param already past it): start a floater (x < floaterMaxX with
   * speed), launch (up-face speed > launchSpeed), or clamp there and slide back. True = left the face.
   * Carving (either way) into the top with a snap armed or pending is a turn off the lip, not a
   * launch: the climb comes back down the face at snapRebound × its up-face speed. Airs come from
   * arriving without a carve held, or from an ollie.
   */
  private faceEdge(tb: number, tc: number, carve: number): boolean {
    const s = this.state;
    const c = this.cfg;
    const w = this.wave;
    const n = s.normal;
    s.param.t = tb;
    w.profile(s.param.x, tb, s.p);
    w.tangents(s.param.x, tb, this.sx, this.st);
    const out = this.outward.copy(this.st).normalize();
    const u = s.v.dot(out);
    // Floater: travelling along the collapsing section (toward the shoulder) with speed, ride over the top.
    if (s.param.x < c.floaterMaxX && s.v.x > 0 && s.v.length() >= c.floaterMinSpeed) {
      this.enterAir(null);
      this.beginAir('mount', tc, u);
      return true;
    }
    const lipTurn = carve !== 0 && (this.snapArmed || this.topPending);
    if (u > c.launchSpeed && !lipTurn) {
      this.enterAir('crest');
      this.beginAir('jump', tb, clamp(u * c.airGain, c.launchSpeed, c.maxAirSpeed));
      return true;
    }
    if (!this.atCrest) {
      this.atCrest = true;
      this.crestTime = s.time;
      this.crestHeading.copy(s.heading);
      this.snapArmed = true;
    }
    this.frameAt(s.param.x, tb);
    s.v.addScaledVector(n, -s.v.dot(n));
    // Too slow to launch: the lip sheds the rider back down the face (no balancing on the ridge).
    // A lip turn sends the climb back down across the wave (eUp), keeping the speed along it.
    const dir = lipTurn ? this.eUp : out;
    const up = s.v.dot(dir);
    const back = lipTurn ? Math.max(c.crestShed, c.snapRebound * up) : c.crestShed;
    if (up > -back) s.v.addScaledVector(dir, -up - back);
    return false;
  }

  private floatTick(input: SurferInput, tc: number): void {
    const s = this.state;
    const c = this.cfg;
    const w = this.wave;
    s.floatTime = s.time - this.floatStart;
    if (s.param.x < -w.params.tubeDepth) {
      s.floating = false;
      this.emit({ type: 'floaterEnd', time: s.time, duration: s.floatTime, landed: false });
      this.wipe('swallowed');
      return;
    }
    s.param.t = tc;
    w.profile(s.param.x, tc, s.p);
    const done = s.param.x >= c.tubeXMax || s.floatTime >= c.floaterMaxTime || input.carve < 0;
    if (done) {
      // Drop off the lip back onto the face; floaterEnd is emitted once actually back on it.
      this.floatDuration = s.floatTime;
      this.enterAir(null);
      this.beginAir('dismount', 1, 0);
      return;
    }
    this.frameAt(s.param.x, tc);
    s.v.addScaledVector(s.normal, -s.v.dot(s.normal));
    s.v.addScaledVector(this.eUp, -s.v.dot(this.eUp));
  }
  private tubeTick(crestY: number): void {
    const s = this.state;
    const c = this.cfg;
    const D = this.wave.params.tubeDepth;
    const x = s.param.x;
    if (x < -D) {
      this.wipe('swallowed');
      return;
    }
    const inTube = x >= -D && x <= c.tubeXMax && s.p.y < c.tubeHeightFrac * crestY;
    if (inTube && !s.inTube) {
      this.tubeStart = s.time;
      this.emit({ type: 'tubeEnter', time: s.time });
    } else if (!inTube && s.inTube) {
      this.emit({ type: 'tubeExit', time: s.time, duration: s.time - this.tubeStart });
    }
    s.inTube = inTube;
    s.tubeTime = inTube ? s.time - this.tubeStart : 0;
    s.tubeDepth = inTube ? clamp(-x / D, 0, 1) : 0;
  }

  private trackCarve(carve: number, absAngle: number): void {
    const dir = Math.sign(carve);
    if (dir === 0 || dir !== this.carveDir) this.carveAccum = 0;
    this.carveDir = dir;
    if (dir === 0) return;
    this.carveAccum += absAngle;
    if (this.carveAccum >= this.cfg.comboCarveDeg * DEG) {
      this.emit({ type: 'carve', time: this.state.time, degrees: this.carveAccum / DEG });
      this.carveAccum = 0;
    }
  }

  /** Leave the surface. `kind` null = a silent floater mount / dismount: no launched / landed events. */
  private enterAir(kind: LaunchKind | null): void {
    const s = this.state;
    if (s.inTube) this.emit({ type: 'tubeExit', time: s.time, duration: s.time - this.tubeStart });
    s.inTube = false;
    s.tubeTime = 0;
    s.tubeDepth = 0;
    s.floating = false;
    s.mode = 'airborne';
    s.launchKind = kind;
    s.airYaw = 0;
    s.airTime = 0;
    s.turnRate = 0;
    this.yawRate = 0;
    s.stalling = false;
    this.atCrest = false;
    this.snapArmed = false;
    this.nearTop = false;
    this.topPending = false;
    this.grabs = [];
    this.headingFromMotion(s.heading, true);
    if (kind) this.emit({ type: 'launched', time: s.time, kind });
  }

  /** Anchor t at column x for the current air: the lip top for a mount, else the launch t lowered to the face end. */
  private anchorTarget(x: number): number {
    const a = this.path;
    const tc = this.crestAt(x).t;
    return a.kind === 'mount' ? tc : this.faceEnd(x, Math.min(a.tAnchor, tc - CREST_EPS));
  }

  /** Fill anchorP and up (the up-facing normal) at (x, t). */
  private anchorFrame(x: number, t: number): Vector3 {
    this.wave.profile(x, t, this.anchorP);
    this.wave.normal(x, t, this.up);
    if (this.up.y < 0) this.up.negate();
    return this.anchorP;
  }

  /** Start an anchored air from the current position with speed `vUp` along the air axis. */
  private beginAir(kind: AirKind, tAnchor: number, vUp: number): void {
    const s = this.state;
    const a = this.path;
    const g = this.cfg.gravity;
    // Face-frame velocity at take-off: carried along x through the air, restored on landing.
    this.frameAt(s.param.x, s.param.t);
    a.va = s.v.dot(this.e1);
    a.vu = s.v.dot(this.eUp);
    a.vx = a.va / Math.max(this.sx.length(), 1e-6);
    a.kind = kind;
    a.tAnchor = tAnchor;
    a.blend.set(0, 0, 0);
    this.anchorT = this.anchorTarget(s.param.x);
    const off = this.tmp.subVectors(s.p, this.anchorFrame(s.param.x, this.anchorT));
    // The air axis is fixed at take-off (a rotating axis would swing the rider sideways): the anchor's
    // up normal, tilted halfway to world up for a crest air so hollow-section airs go up, not out.
    this.axis.copy(this.up);
    if (kind === 'jump' && s.launchKind === 'crest') this.axis.add(WORLD_UP).normalize();
    a.h0 = off.dot(this.axis);
    a.residual.copy(off).addScaledVector(this.axis, -a.h0);
    if (kind === 'mount') {
      // Carried up the wall by the speed leaving the face (at least enough to clear the lip top);
      // touchdown is reaching the lip top on the way up.
      a.vUp = Math.max(vUp, Math.sqrt(2 * g * (Math.max(0, -a.h0) + MOUNT_CLEARANCE)));
      a.flightTime = (a.vUp - Math.sqrt(Math.max(0, a.vUp * a.vUp + 2 * g * a.h0))) / g;
    } else {
      if (a.h0 < 0) {
        a.blend.addScaledVector(this.axis, a.h0);
        a.h0 = 0;
      }
      a.vUp = vUp;
      a.flightTime = (a.vUp + Math.sqrt(a.vUp * a.vUp + 2 * g * a.h0)) / g;
      // Too short a flight to fade the residual out at a sane speed: blend it instead.
      if (a.residual.length() > BLEND_SPEED * a.flightTime) {
        a.blend.add(a.residual);
        a.residual.set(0, 0, 0);
      }
    }
    s.param.t = this.anchorT;
    s.normal.copy(this.up);
    this.airVelocity(0, a.vUp, 0);
  }

  /** v = d/dt of the anchored position (anchor sliding along x, height, fading residual and blend). */
  private airVelocity(time: number, hDot: number, blendSpeed: number): void {
    const s = this.state;
    const a = this.path;
    this.wave.tangents(s.param.x, this.anchorT, this.sx, this.st);
    s.v.copy(this.sx).multiplyScalar(a.vx).addScaledVector(this.axis, hDot);
    if (time < a.flightTime) s.v.addScaledVector(a.residual, -1 / a.flightTime);
    const b = a.blend.length();
    if (b > 0) s.v.addScaledVector(a.blend, -blendSpeed / b);
  }

  /** Terminal: left behind by the wave. */
  private kickOut(): void {
    const s = this.state;
    this.endGrab();
    s.mode = 'kickedOut';
    s.inTube = false;
    s.floating = false;
    this.emit({ type: 'kickedOut', time: s.time });
  }

  private air(input: SurferInput, dt: number): void {
    const s = this.state;
    const c = this.cfg;
    const a = this.path;
    const { xMin, xMax } = this.wave.params;
    s.airTime += dt;
    s.carve = 0;
    if (a.kind === 'jump') {
      s.turnRate = input.spin * c.spinRate * DEG;
      s.airYaw += s.turnRate * dt;
      if (input.grab !== s.grab) {
        if (s.grab) this.endGrab();
        if (input.grab) {
          this.grabStart = s.time;
          this.emit({ type: 'grabStart', time: s.time, kind: input.grab });
        }
        s.grab = input.grab;
      }
      if (s.grab) this.lastGrabTime = s.time;
    }

    const time = s.airTime;
    const hDot = a.vUp - c.gravity * time;
    const h = a.h0 + a.vUp * time - 0.5 * c.gravity * time * time;
    const reached = a.kind === 'mount' ? h >= 0 : h <= 0 && hDot < 0;
    const hEff = reached ? 0 : h;
    s.param.x = clamp(s.param.x + a.vx * dt, xMin, xMax);
    const tPrev = this.anchorT;
    this.anchorT = this.anchorTarget(s.param.x);
    if (this.anchorT !== tPrev) {
      // Keep p continuous when the anchor moves in t (the face end can jump with x): blend the step.
      const was = this.tmp.copy(this.anchorFrame(s.param.x, tPrev)).addScaledVector(this.axis, hEff);
      a.blend.add(was).sub(this.anchorFrame(s.param.x, this.anchorT)).addScaledVector(this.axis, -hEff);
    } else this.anchorFrame(s.param.x, this.anchorT);
    const b = a.blend.length();
    const fade = Math.min(b, BLEND_SPEED * dt);
    if (b > 0) a.blend.multiplyScalar((b - fade) / b);
    s.param.t = this.anchorT;
    s.normal.copy(this.up);
    if (reached && fade === b) {
      s.p.copy(this.anchorP);
      this.touchDown();
      return;
    }
    // (Reached with the blend still fading: skim the surface at h = 0 until it is gone.)
    s.p.copy(this.anchorP).addScaledVector(this.axis, hEff).add(a.blend);
    s.p.addScaledVector(a.residual, Math.max(0, 1 - time / a.flightTime));
    this.airVelocity(time, reached ? 0 : hDot, fade / dt);
  }

  /** Back on the surface at (param.x, anchorT) — exactly where the anchored air put us. */
  private touchDown(): void {
    const s = this.state;
    const a = this.path;
    if (a.kind === 'jump') {
      this.land();
      return;
    }
    s.mode = 'riding';
    s.turnRate = 0;
    if (a.kind === 'mount') {
      s.floating = true;
      this.floatStart = s.time;
      s.floatTime = 0;
    }
    this.frameAt(s.param.x, s.param.t);
    s.v.copy(this.e1).multiplyScalar(a.va);
    if (a.kind === 'drop') s.v.addScaledVector(this.eUp, Math.min(0, a.vu));
    this.headingFromMotion(s.heading);
    if (a.kind === 'mount') {
      this.emit({ type: 'floaterStart', time: s.time });
      return;
    }
    if (a.kind === 'drop') return;
    const swallowed = s.param.x < -this.wave.params.tubeDepth;
    this.emit({ type: 'floaterEnd', time: s.time, duration: this.floatDuration, landed: !swallowed });
    if (swallowed) this.wipe('swallowed');
  }

  private endGrab(): void {
    const s = this.state;
    if (!s.grab) return;
    const heldSec = s.time - this.grabStart;
    this.grabs.push({ kind: s.grab, heldSec });
    this.emit({ type: 'grabEnd', time: s.time, kind: s.grab, heldSec });
    s.grab = null;
  }

  private land(): void {
    const s = this.state;
    const c = this.cfg;
    const a = this.path;
    const grabRecent = s.grab !== null || s.time - this.lastGrabTime < c.grabGrace;
    this.endGrab();
    const off = Math.abs(wrapAngle(s.airYaw)) / DEG; // 0…180, board vs its take-off heading
    const aligned = off <= c.landTolerance;
    const reverse = off >= 180 - c.landTolerance;
    if (s.param.x < -this.wave.params.tubeDepth) return this.wipe('whitewater');
    if (grabRecent) return this.wipe('grabbing');
    if (!aligned && !reverse) return this.wipe('badLanding');

    s.mode = 'riding';
    // Restore the take-off face velocity (a crest air comes back down the face), minus a landing loss.
    this.frameAt(s.param.x, s.param.t);
    const vu = s.launchKind === 'crest' ? -Math.abs(a.vu) : a.vu;
    s.v.copy(this.e1).multiplyScalar(a.va).addScaledVector(this.eUp, vu).multiplyScalar(c.landingSpeedKeep);
    this.headingFromMotion(s.heading);
    if (reverse) s.stanceFlipped = !s.stanceFlipped;
    this.emit({
      type: 'landed',
      time: s.time,
      spinDeg: Math.round(Math.abs(s.airYaw) / Math.PI) * 180,
      grabs: this.grabs,
      revert: reverse,
      ollie: s.launchKind === 'ollie',
      airTime: s.airTime,
    });
    this.grabs = [];
    s.airYaw = 0;
  }

  private wipe(reason: WipeoutReason): void {
    const s = this.state;
    s.mode = 'wipeout';
    s.wipeoutReason = reason;
    s.inTube = false;
    s.floating = false;
    s.grab = null;
    this.emit({ type: 'wipeout', time: s.time, reason });
  }
}
