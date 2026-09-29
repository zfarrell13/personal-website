import { Vector3 } from 'three';
import { configVersion, type PhysicsParams } from '../config';
import { clamp, DEG, wrapAngle } from '../math/scalar';
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
  /** Surface params of the contact point (riding) or of the nearest face point (airborne). */
  param: WaveParam;
  /** Contact normal (riding) / last contact normal (airborne). */
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
/** Airborne below still-water level (y = 0) by more than this = fell off the back. */
const WATER_LEVEL_SLACK = 0.5;
/** The rideable face ends where the surface normal's y drops below this (face going vertical / overhanging). */
const FACE_MIN_NY = 0.2;
/** Fraction of the headroom under the lip a crest launch may use (the lip is solid). */
const LIP_HEADROOM_USE = 0.6;
/** Below the crest, on the face, where a crest air is aimed to come back down (in t). */
const LANDING_BELOW_EDGE = 0.06;
/** Landing snap distance beyond the distance travelled in a tick (m). */
const LAND_SNAP = 0.3;
const DROP_IN = { x: 4, t: 0.55, along: 2, down: 4 };

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
  private readonly q: WaveParam = { x: 0, t: 0 };
  private readonly outward = new Vector3();
  private readonly scratch = new Vector3();
  private crestMemo = { x: NaN, version: -1, t: 0, y: 0 };
  /** Riding up the overhanging lip (only reachable while able to float). */
  private onLip = false;
  /** This air is a crest launch over the flat shoulder: it ends kicked out. */
  private overBack = false;
  /** A floater dismount: no launched/landed events. */
  private silentAir = false;
  /** Signed distance to the local face at the previous air tick (> 0 = front side). */
  private prevD = 0;
  private readonly crestHeading = new Vector3();
  private atCrest = false;
  private crestTime = -Infinity;
  private snapArmed = false;
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
    s.param.t = t;
    this.frameAt(x, t);
    this.wave.profile(x, t, s.p);
    s.v.copy(this.e1).multiplyScalar(DROP_IN.along).addScaledVector(this.eUp, -DROP_IN.down);
    s.heading.copy(s.v).normalize();
    this.prevP.copy(s.p);
    this.prevHeading.copy(s.heading);
    this.atCrest = false;
    this.snapArmed = false;
    this.onLip = false;
    this.overBack = false;
    this.silentAir = false;
    this.crestMemo.x = NaN;
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

  step(input: SurferInput, dt: number): void {
    const s = this.state;
    this.prevP.copy(s.p);
    this.prevHeading.copy(s.heading);
    s.time += dt;
    if (s.mode === 'riding') this.ride(input, dt);
    else if (s.mode === 'airborne') this.air(input, dt);
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

  /**
   * Largest t ≤ tMax at column x whose surface normal still has n.y ≥ FACE_MIN_NY:
   * the end of the rideable face (before it turns vertical or overhangs).
   */
  private faceEnd(x: number, tMax: number): number {
    const w = this.wave;
    const ny = (t: number): number => w.normal(x, t, this.scratch).y;
    if (ny(tMax) >= FACE_MIN_NY) return tMax;
    let hi = tMax;
    let lo = tMax;
    while (lo > 0 && ny(lo) < FACE_MIN_NY) {
      hi = lo;
      lo = Math.max(0, lo - 0.02);
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (ny(mid) >= FACE_MIN_NY) lo = mid;
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
      // The pop's vertical part (impulse along the normal) is kept; the shoreward part is re-aimed so the
      // hop comes back down onto the face instead of flying off into the flat water in front of it.
      const vy = Math.max(0, s.v.y + n.y * c.ollieImpulse);
      s.p.addScaledVector(n, 0.02);
      this.hop(vy, s.param.t - LANDING_BELOW_EDGE, this.crestAt(s.param.x).y);
      this.launch('ollie');
      return;
    }

    // --- forces in the tangent plane ---
    const a = this.acc.set(0, -c.gravity, 0);
    a.addScaledVector(n, -a.dot(n));
    const steep = w.steepness(s.param.x, s.param.t);
    if (!s.floating) {
      const crestY = this.crestAt(s.param.x).y;
      const depth = clamp((crestY - s.p.y) / Math.max(crestY, 0.1), 0, 1);
      a.addScaledVector(this.eUp, c.lift * steep * depth);
      a.addScaledVector(this.eUp, -c.faceDamping * s.v.dot(this.eUp));
    }
    a.addScaledVector(this.e1, c.drive * steep);
    const water = this.tmp.set(-w.params.peelSpeed, 0, 0);
    water.addScaledVector(n, -water.dot(n));
    const rel = this.tmp2.subVectors(s.v, water);
    const dragK = c.drag * (s.stalling ? c.stallDragMultiplier : 1);
    a.addScaledVector(rel, -dragK * rel.length());
    const speed0 = s.v.length();
    if (input.carve !== 0 && speed0 > 1e-3) a.addScaledVector(s.v, (-c.carveBleed * Math.abs(input.carve)) / speed0);
    s.v.addScaledVector(a, dt);

    // --- carve: rotate v about the normal; toward the lip = +carve ---
    const sp = s.v.length();
    const omega = c.carveRate / (1 + sp / c.carveHalfSpeed);
    const dir = s.v.dot(this.e1) >= 0 ? 1 : -1;
    const ang = input.carve * omega * dir * dt;
    if (ang !== 0) s.v.applyAxisAngle(n, ang);
    s.turnRate = ang / dt;
    this.trackCarve(input.carve, Math.abs(ang));

    // --- pump: efficiency min(1, since/period), minus a fixed cost ---
    if (input.pump) {
      const eff = Math.min(1, s.sincePump / c.pumpPeriod);
      const target = Math.max(0, sp + c.pumpImpulse * eff - c.pumpCost);
      if (sp > 1e-3) s.v.multiplyScalar(target / sp);
      else s.v.copy(this.e1).multiplyScalar(target);
      s.sincePump = 0;
      this.emit({ type: 'pump', time: s.time, efficiency: eff });
    } else {
      s.sincePump += dt;
    }

    // --- integrate + re-project onto the surface ---
    s.p.addScaledVector(s.v, dt);
    w.closestParam(s.p, s.param, s.param);
    const crest = this.crestAt(s.param.x);
    const tc = crest.t;
    const tCrestEdge = tc - CREST_EPS;
    const canFloat = s.param.x < c.floaterMaxX && s.v.length() >= c.floaterMinSpeed;
    let tb = tc;
    if (!s.floating) {
      const fe = this.faceEnd(s.param.x, Math.min(s.param.t, tCrestEdge));
      if (s.param.t <= fe + 1e-9) this.onLip = false;
      else if (canFloat) this.onLip = true; // climbing the overhang toward a floater
      tb = canFloat || this.onLip ? tCrestEdge : fe;
    }
    if (!s.floating && this.onLip && !canFloat) {
      // Ran out of speed climbing the overhang before reaching the crest: fall back off it.
      this.dropFromLip(tc);
      return;
    }
    const atEdge = !s.floating && (s.param.t >= tCrestEdge || tb < s.param.t);

    if (s.floating) {
      this.floatTick(input, tc);
      if (s.mode !== 'riding') return;
    } else if (atEdge) {
      // End of the rideable face. Speed leaving the face (along ∂S/∂t) decides launch vs clamp.
      const atCrestEdge = tb >= tCrestEdge - 1e-9;
      w.tangents(s.param.x, tb, this.sx, this.st);
      const out = this.outward.copy(this.st).normalize();
      if (!(atCrestEdge && canFloat) && s.v.dot(out) > c.launchSpeed) {
        w.profile(s.param.x, tb, s.p);
        w.normal(s.param.x, tb, n);
        s.p.addScaledVector(n, 0.02);
        if (atCrestEdge) this.launch('crest', true);
        else {
          this.hop(s.v.dot(out), tb - LANDING_BELOW_EDGE, crest.y);
          this.launch('crest');
        }
        return;
      }
      if (!this.atCrest) {
        this.atCrest = true;
        this.crestTime = s.time;
        this.crestHeading.copy(s.heading);
        this.snapArmed = true;
      }
      s.param.t = tb;
      w.profile(s.param.x, tb, s.p);
      this.frameAt(s.param.x, tb);
      s.v.addScaledVector(n, -s.v.dot(n));
      const up = s.v.dot(out);
      if (up > 0) s.v.addScaledVector(out, -up);
      if (atCrestEdge && canFloat) {
        s.floating = true;
        this.onLip = false;
        this.floatStart = s.time;
        s.floatTime = 0;
        this.snapArmed = false;
        this.frameAt(s.param.x, tb);
        this.emit({ type: 'floaterStart', time: s.time });
      }
    } else {
      this.atCrest = false;
      w.profile(s.param.x, s.param.t, s.p);
      w.normal(s.param.x, s.param.t, n);
      s.v.addScaledVector(n, -s.v.dot(n));
    }

    if (s.v.lengthSq() > c.minSpeed * c.minSpeed) s.heading.copy(s.v).normalize();

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

  private floatTick(input: SurferInput, tc: number): void {
    const s = this.state;
    const c = this.cfg;
    const w = this.wave;
    s.floatTime = s.time - this.floatStart;
    if (s.param.x < -w.params.tubeDepth) {
      this.wipe('swallowed');
      return;
    }
    const done = s.param.x >= c.tubeXMax || s.floatTime >= c.floaterMaxTime || input.carve < 0;
    if (done) {
      s.floating = false;
      this.emit({ type: 'floaterEnd', time: s.time, duration: s.floatTime, landed: true });
      this.dropFromLip(tc);
      return;
    }
    s.param.t = tc;
    w.profile(s.param.x, tc, s.p);
    this.frameAt(s.param.x, tc);
    s.v.addScaledVector(s.normal, -s.v.dot(s.normal));
    s.v.addScaledVector(this.eUp, -s.v.dot(this.eUp));
  }

  /** Leave the lip in place (no teleport): a silent hop that comes down on the face below. */
  private dropFromLip(tc: number): void {
    const s = this.state;
    const fe = this.faceEnd(s.param.x, tc - CREST_EPS);
    this.onLip = false;
    this.hop(0, fe - LANDING_BELOW_EDGE, this.crestAt(s.param.x).y);
    this.launch(null);
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

  /** Enter the air. `kind` null = a silent dismount (floater end): no launched / landed events. */
  private launch(kind: LaunchKind | null, overBack = false): void {
    const s = this.state;
    if (s.inTube) this.emit({ type: 'tubeExit', time: s.time, duration: s.time - this.tubeStart });
    if (s.floating) this.emit({ type: 'floaterEnd', time: s.time, duration: s.floatTime, landed: true });
    s.inTube = false;
    s.tubeTime = 0;
    s.tubeDepth = 0;
    s.floating = false;
    s.mode = 'airborne';
    s.launchKind = kind;
    s.airYaw = 0;
    s.airTime = 0;
    s.stalling = false;
    this.atCrest = false;
    this.snapArmed = false;
    this.grabs = [];
    this.overBack = overBack;
    this.silentAir = kind === null;
    this.prevD = 1;
    const hx = s.v.x;
    const hz = s.v.z;
    const h = Math.hypot(hx, hz);
    if (h > 1e-3) s.heading.set(hx / h, 0, hz / h);
    else s.heading.set(s.heading.x, 0, s.heading.z).normalize();
    if (kind) this.emit({ type: 'launched', time: s.time, kind });
  }

  /**
   * Turn a launch into a local hop. In the wave frame the face is stationary but in reality the lip
   * pitches toward shore and carries the rider, so the wanted vertical speed (capped by maxAirSpeed and
   * by the headroom under the solid lip) keeps v.x, drops any along-the-face shoreward/back speed, and
   * takes just the z drift that brings the ballistic arc back down onto the face at `tTarget`.
   */
  private hop(vyWanted: number, tTarget: number, crestY: number): void {
    const s = this.state;
    const c = this.cfg;
    const x = s.param.x;
    const headroom = Math.max(0, crestY - s.p.y) * LIP_HEADROOM_USE;
    const vy = Math.min(vyWanted, c.maxAirSpeed, Math.sqrt(2 * c.gravity * headroom));
    const target = this.wave.profile(x, clamp(tTarget, 0.05, 1), this.tmp);
    const drop = Math.max(0, s.p.y - target.y);
    const flight = (vy + Math.sqrt(vy * vy + 2 * c.gravity * drop)) / c.gravity;
    const drift = clamp((target.z - s.p.z) / Math.max(flight, 1e-3), -3, 3);
    s.v.set(s.v.x, vy, Math.abs(drift) < 0.2 ? 0.2 : drift);
  }

  /** Terminal: carried off the wave (over the back, or left behind by it). */
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
    const w = this.wave;
    s.v.y -= c.gravity * dt;
    s.p.addScaledVector(s.v, dt);
    s.airTime += dt;
    s.turnRate = input.spin * c.spinRate * DEG;
    s.airYaw += s.turnRate * dt;
    s.carve = 0;

    if (input.grab !== s.grab) {
      if (s.grab) this.endGrab();
      if (input.grab) {
        this.grabStart = s.time;
        this.emit({ type: 'grabStart', time: s.time, kind: input.grab });
      }
      s.grab = input.grab;
    }
    if (s.grab) this.lastGrabTime = s.time;

    // Fell into open water behind / below the wave.
    if (s.p.y < -WATER_LEVEL_SLACK) {
      this.kickOut();
      return;
    }

    // Landing is local: the closest point of the rideable face, crossed from the front side.
    const q = w.closestParam(s.p, s.param, this.q);
    const tc = this.crestAt(q.x).t;
    if (q.t > tc) q.t = tc;
    s.param.x = q.x;
    s.param.t = q.t;
    const S = w.profile(q.x, q.t, this.tmp);
    const n = w.normal(q.x, q.t, this.tmp2);
    const off = this.acc.subVectors(s.p, S);
    const d = off.dot(n);
    const prevD = this.prevD;
    this.prevD = d;
    if (this.overBack) {
      if (d <= 0) this.kickOut();
      return;
    }
    // Above the end of the face (vertical / overhanging lip) there is nothing to land on.
    if (q.t > this.faceEnd(q.x, Math.min(q.t, tc - CREST_EPS)) + 1e-9) return;
    if (d > 0) return;
    if (prevD > 0 && s.v.dot(n) < 0 && off.length() <= LAND_SNAP + s.v.length() * dt) this.land(S, n);
    else this.kickOut();
  }

  private endGrab(): void {
    const s = this.state;
    if (!s.grab) return;
    const heldSec = s.time - this.grabStart;
    this.grabs.push({ kind: s.grab, heldSec });
    this.emit({ type: 'grabEnd', time: s.time, kind: s.grab, heldSec });
    s.grab = null;
  }

  private land(S: Vector3, n: Vector3): void {
    const s = this.state;
    const c = this.cfg;
    const grabRecent = s.grab !== null || s.time - this.lastGrabTime < c.grabGrace;
    this.endGrab();
    const off = Math.abs(wrapAngle(s.airYaw)) / DEG; // 0…180, board vs (constant) horizontal velocity
    const aligned = off <= c.landTolerance;
    const reverse = off >= 180 - c.landTolerance;
    if (s.param.x < -this.wave.params.tubeDepth) return this.wipe('whitewater');
    if (grabRecent) return this.wipe('grabbing');
    if (!aligned && !reverse) return this.wipe('badLanding');

    s.mode = 'riding';
    s.p.copy(S);
    s.normal.copy(n);
    s.v.addScaledVector(n, -s.v.dot(n)).multiplyScalar(c.landingSpeedKeep);
    if (s.v.lengthSq() > 1e-6) s.heading.copy(s.v).normalize();
    if (reverse) s.stanceFlipped = !s.stanceFlipped;
    if (!this.silentAir) {
      this.emit({
        type: 'landed',
        time: s.time,
        spinDeg: Math.round(Math.abs(s.airYaw) / Math.PI) * 180,
        grabs: this.grabs,
        revert: reverse,
        ollie: s.launchKind === 'ollie',
        airTime: s.airTime,
      });
    }
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
