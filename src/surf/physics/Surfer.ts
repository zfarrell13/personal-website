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
/** A bottom turn from (nearly) straight down the face heads for the shoulder unless the board already runs back toward the curl by more than this share of its speed. */
const BOTTOM_TURN_SENSE = 0.05;
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
/**
 * A rebound is done once the board's line runs down the line, dropping at this angle below flat
 * (coming off the lip / out of the foam it heads back down the face, picking up speed).
 */
const REBOUND_EXIT = -30 * DEG;
/** A cutback is under way once the carves since the board last ran down the line have turned it this far. */
const CUTBACK_ACTIVE = 90 * DEG;
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
  /** Scratch tangents for headingFromMotion (never the riding frame's sx / st). */
  private readonly hx = new Vector3();
  private readonly ht = new Vector3();
  private anchorT = 0;
  /** Current peel speed (m/s): the water moves at −vp along x in the wave frame. */
  private vp = 0;
  /** Carve yaw rate (rad/s), easing toward the input's target while a carve key is held; 0 the tick it is let go. */
  private yawRate = 0;
  /**
   * With no carve key held the rail holds the board's line (playtest 6): its angle in the face, from
   * along the wave (e1) toward up the face (eUp), latched when the key is let go (or on the first
   * keyless tick). null while a key is held, in the air and on a floater.
   */
  private line: number | null = null;
  /** Unit board line in the face at the current point (cos line · e1 + sin line · eUp). */
  private readonly lineDir = new Vector3();
  /** +1 while the board runs toward +x (the shoulder), −1 toward the curl; see TURN_SENSE_HYSTERESIS. */
  private turnSense = 1;
  /** Sign of the carve input on the last tick: a change (press, release, other key) starts a new turn. */
  private heldSign = 0;
  /**
   * Rotation sense of the held turn about the normal, latched when it starts: +1 turns the line from
   * down the line (+x) up the face, over toward the curl and on round. It is the carve's toward-the-lip
   * / toward-the-trough meaning at the moment the key went down; the board keeps turning that way
   * for as long as the key is held.
   */
  private heldSense = 0;
  /**
   * Cutback: the net carve yaw (rad, in cutbackSense) since the board last ran down the line. It
   * survives letting go of the key (cut back, let go, run at the curl, press into the lip), and is
   * forgotten once the board runs down the line again or after cutbackMemory s running back toward
   * the curl without a rebound.
   */
  private cutbackYaw = 0;
  private cutbackSense = 0;
  /** World speed (m/s) when the cutback's turning began, and when the rebound began (its cap: a roundhouse never exits faster than it went in). */
  private cutbackEntry = 0;
  private reboundEntry = 0;
  /** Seconds running back toward the curl in the current cutback, and whether it has run back at all. */
  private backFor = 0;
  private wentBack = false;
  /** When the last held carve was let go (sim s). */
  private releasedAt = -Infinity;
  /**
   * A snap that turns the board back toward the curl waits (from deferredAt): a ROUNDHOUSE out of it
   * replaces it; otherwise it scores when the cutback ends, or after snapDeferMax s at the latest.
   */
  private deferredSnap = false;
  private deferredAt = 0;
  /** This cutback's snap has already scored (its wait ran out): a ROUNDHOUSE out of it then takes the snap back. */
  private cutbackSnapped = false;
  /** The held carve was pressed while the board ran back toward the curl (a re-press after a cutback). */
  private pressedBack = false;
  /** The held turn ended in a rebound: it does nothing more until the key is let go. */
  private carveSpent = false;
  /** Running back toward the curl, bounced round off the whitewater ('foam') or the lip, back down the line. */
  private rebound: 'foam' | 'lip' | null = null;
  /** The rebound's rotation sense: −1 up the face and round (off the lip), +1 down and round. */
  private reboundSense = 0;
  /** cutbackYaw when the rebound started, and the yaw (rad) the rebound has turned since. */
  private reboundHeld = 0;
  private reboundYaw = 0;
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
  /** The spin input on the current tick (read by enterAir for the spin latch). */
  private spinInput = 0;
  /**
   * A spin needs a fresh press in the air: a carve key still held from the face (e.g. an ollie
   * mid-carve) does nothing until it is released.
   */
  private spinArmed = false;
  /** The held grab was let go automatically just before touchdown; grab input is ignored until landing. */
  private grabLocked = false;
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
    this.line = null;
    this.turnSense = 1;
    this.deferredSnap = false; // a fresh run: nothing from the last one scores
    this.endTurn();
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
    this.spinInput = 0;
    this.spinArmed = false;
    this.grabLocked = false;
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
    this.spinInput = input.spin;
    if (s.mode === 'riding') this.ride(input, dt);
    else if (s.mode === 'airborne') this.air(input, dt);
  }

  /**
   * The board points along its motion through the water: v − water, the water sliding along the
   * surface at −vp·e1 at the board's param (as the riding forces see it — so the heading is the same
   * line the rail holds when no key is down, with no jump on a press or a release; playtest 6: it was
   * v + vp·x̂, which differs from it by vp·(x̂ − e1) where the hollow face tilts e1). Kept when that is
   * too slow to tell. (Airborne, setPeelSpeed shifts the path's x-velocity by −Δ, which assumes the
   * launch tangent ≈ x̂.)
   */
  private headingFromMotion(out: Vector3, horizontal = false): void {
    const s = this.state;
    this.wave.tangents(s.param.x, s.param.t, this.hx, this.ht);
    const e1 = this.hx.normalize();
    const x = s.v.x + this.vp * e1.x;
    const y = horizontal ? 0 : s.v.y + this.vp * e1.y;
    const z = s.v.z + this.vp * e1.z;
    const len = Math.hypot(x, y, z);
    if (len > this.cfg.minSpeed) out.set(x / len, y / len, z / len);
    else if (horizontal) out.set(out.x, 0, out.z).normalize();
  }

  /** The board's line angle in the face (from e1 toward eUp) at the current frame: its motion through the water, else its heading. */
  private lineAngle(): number {
    const s = this.state;
    const rel = this.tmp.copy(s.v).addScaledVector(this.e1, this.vp);
    const d = rel.length() > this.cfg.minSpeed ? rel : s.heading;
    return Math.atan2(d.dot(this.eUp), d.dot(this.e1));
  }

  /** lineDir = the line at `angle` in the current face frame (e1, eUp). */
  private lineAt(angle: number): Vector3 {
    return this.lineDir.copy(this.e1).multiplyScalar(Math.cos(angle)).addScaledVector(this.eUp, Math.sin(angle)).normalize();
  }

  /**
   * Keyless, after the move: the board's motion through the water is put back on its held line in
   * the face frame where it now is (the same angle from along the wave toward up the face): only its
   * part across that line is removed.
   */
  private holdLine(): void {
    const s = this.state;
    this.frameAt(s.param.x, s.param.t);
    const L = this.lineAt(this.line!);
    // Only the cross-line part of the motion through the water here goes (the rail holds it).
    const along = this.rel.copy(s.v).addScaledVector(this.e1, this.vp).dot(L);
    s.v.copy(L).multiplyScalar(along).addScaledVector(this.e1, -this.vp);
  }

  /** Keyless heading: the held line (never flipped by sliding back along it). */
  private lineHeading(out: Vector3): void {
    out.copy(this.lineAt(this.line!));
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

  /**
   * Bottomed out on the flats in front of the wave while still heading further out: a bottom turn.
   * The board's line through the water swings toward along the wave (the way a held turn or a
   * rebound is turning; else the way it already runs, from straight down toward the shoulder) at
   * bottomTurnRate, bleeding bottomTurnLoss of its speed per 90° turned. Never a dead stop or a
   * one-tick heading snap.
   */
  private bottomTurn(dt: number, sense: number): void {
    const s = this.state;
    const c = this.cfg;
    this.frameAt(s.param.x, 0);
    const water = this.water.copy(this.e1).multiplyScalar(-this.vp);
    const rel = this.rel.subVectors(s.v, water);
    const down = rel.dot(this.eUp);
    if (down >= 0) return;
    const along = rel.dot(this.e1);
    const sp = Math.hypot(along, down);
    const phi = Math.atan2(down, along); // −π/2 = straight down the face
    // A held turn carries on round the way it is turning (never fights the rail into the flats).
    const dir = sense !== 0 ? sense : along < -BOTTOM_TURN_SENSE * sp ? -1 : 1;
    const turn = Math.min(c.bottomTurnRate * dt, dir > 0 ? -phi : Math.PI + phi);
    const next = phi + dir * turn;
    const speed = sp * (1 - (c.bottomTurnLoss * turn) / (Math.PI / 2));
    rel.copy(this.e1).multiplyScalar(Math.cos(next) * speed).addScaledVector(this.eUp, Math.sin(next) * speed);
    s.v.addVectors(rel, water);
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
    // No carve key held: nothing turns the board (playtest 6). The rail holds its line — the angle in
    // the face latched here — and the forces below only change its speed along that line.
    const keyless = input.carve === 0 && !s.floating;
    if (!keyless) this.line = null;
    else if (this.line === null) this.line = this.lineAngle();

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
      // A stall sets the rail: full grip at any speed.
      const grip = c.railGrip * (s.stalling ? 1 : clamp((speed0 - c.minSpeed) / (c.gripSpeed - c.minSpeed), 0, 1));
      const line = this.tmp2.copy(rel).multiplyScalar(1 / speed0);
      const along = a.dot(line);
      a.multiplyScalar(1 - grip).addScaledVector(line, along * grip);
    }
    const steep = w.steepness(s.param.x, s.param.t);
    a.addScaledVector(this.e1, c.drive * steep);
    // Bottomed out on the flats in front of the wave, the board bogs down.
    const dragK = c.drag * (s.stalling ? c.stallDragMultiplier : 1) * (s.param.t <= 0 ? c.flatsDragMultiplier : 1);
    a.addScaledVector(rel, -dragK * speed0);
    if (input.carve !== 0 && speed0 > 1e-3) a.addScaledVector(rel, (-c.carveBleed * Math.abs(input.carve)) / speed0);
    s.v.addScaledVector(a, dt);
    rel.subVectors(s.v, water);
    // Stalling holds the board's height on the face: its motion up / down the face dies away.
    if (s.stalling) rel.addScaledVector(this.eUp, -rel.dot(this.eUp) * (1 - Math.exp(-c.stallHold * dt)));
    // Keyless, the rail holds the line: only the part of the motion along it is kept (all of the
    // cross-line gravity is held; a stall's damping slows the board along its line instead of
    // flattening it). The board may slow to a stop and slide back along its line, tail first.
    if (keyless) {
      // Holding the stall (↓) is the player setting the rail: its damping may flatten the held line.
      if (s.stalling && rel.length() > c.minSpeed) this.line = Math.atan2(rel.dot(this.eUp), rel.dot(this.e1));
      const L = this.lineAt(this.line!);
      const along = rel.dot(L);
      rel.copy(L).multiplyScalar(along);
    }

    // --- carve: rotate the board's line about the normal. A held carve keeps turning the way it
    // started (heldSense, latched on the press: toward the lip = +carve) for as long as it is held —
    // up the face, round past straight up, back toward the curl and on round; let go and the board
    // holds its line. The yaw rate eases toward carveRate / (1 + speed / carveHalfSpeed) with lag
    // carveLag (a weighty rail); the turn radius speed / rate grows with speed. ---
    const sp = rel.length();
    const along = rel.dot(this.e1);
    const rate = c.carveRate / (1 + sp / c.carveHalfSpeed);
    // Which way along the wave the board runs; it only flips once the board clearly points the other way.
    if (Math.abs(along) > TURN_SENSE_HYSTERESIS * sp) this.turnSense = along > 0 ? 1 : -1;
    const sign = Math.sign(input.carve);
    if (sign !== this.heldSign) {
      if (sign === 0) this.releasedAt = s.time;
      this.heldSign = sign;
      this.heldSense = sign * this.turnSense;
      this.pressedBack = sign !== 0 && this.turnSense < 0;
      this.carveSpent = false;
    }
    // The cutback is forgotten once the board runs down the line again — after running back toward
    // the curl (a loop came round), or with no turn held its way — or after running at the curl too long.
    const back = sp > c.minSpeed && along < -TURN_SENSE_HYSTERESIS * sp;
    if (back) {
      this.backFor += dt;
      this.wentBack = true;
    }
    const downLine = along > TURN_SENSE_HYSTERESIS * sp;
    const turningOn = this.heldSign !== 0 && !this.carveSpent && this.heldSense === this.cutbackSense;
    if (!this.rebound && ((downLine && (this.wentBack || !turningOn)) || this.backFor > c.cutbackMemory)) this.endCutback();
    // Running back toward the curl with a carve held: turning up into the lip (in the top band, or
    // anywhere once a cutback is under way — the second half of the figure-8) or reaching the
    // whitewater bounces the board round, back down the line. Off the lip it turns up and over; the
    // foam knocks it round the shorter way (a line still climbing goes up and over, one already
    // dropping carries on down and round).
    if (!this.rebound && sign !== 0 && !s.floating && back) {
      // (Not inside the barrel, under the lip; deeper than half the tube the foam no longer throws the
      // board out: the curl swallows it.)
      const foam = !s.inTube && s.param.x <= c.foamReboundX && s.param.x > -this.wave.params.tubeDepth / 2;
      const lip =
        !this.carveSpent && this.heldSense < 0 && (this.nearTop || this.atCrest || (this.pressedBack && this.cutbackYaw >= CUTBACK_ACTIVE));
      if (foam || lip) {
        this.rebound = foam ? 'foam' : 'lip';
        this.reboundSense = foam && rel.dot(this.eUp) < 0 ? 1 : -1;
        this.reboundHeld = this.cutbackYaw;
        this.reboundEntry = Math.max(sp, this.cutbackSense !== 0 ? this.cutbackEntry : 0);
        this.reboundYaw = 0;
      }
    }
    // Letting go always wins: a rebound only turns the board while the key is held. Released mid-way,
    // the bounce is over (no roundhouse out of it; the cutback is remembered for a re-press).
    if (this.rebound && sign === 0) this.rebound = null;
    let target = 0;
    if (this.rebound) {
      // Round toward the shoulder, the rail biting hard (the lip / foam pushes the board round).
      target = this.reboundSense * rate * c.reboundBoost;
    } else if (sign !== 0 && !this.carveSpent) {
      // Snapping at the lip (a snap armed, held there), the rail bites harder.
      target = Math.abs(input.carve) * rate * this.heldSense * (this.snapArmed && this.atCrest ? c.snapCarveBoost : 1);
    }
    // Let go: the turn stops on that tick (playtest 6: no easing out, no turning without a key). A
    // pressed key eases in over carveLag (a weighty rail).
    if (sign === 0) this.yawRate = 0;
    else this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt / c.carveLag));
    const ang = this.yawRate * dt;
    if (ang !== 0) rel.applyAxisAngle(n, ang);
    s.turnRate = this.yawRate;
    // Carried deeper than half the tube, the foam has lost the board to the curl: no rebound out of it.
    if (this.rebound === 'foam' && s.param.x < -this.wave.params.tubeDepth / 2) {
      this.rebound = null;
      this.carveSpent = this.heldSign !== 0;
      this.endCutback();
    }
    if (this.rebound) {
      const turned = Math.max(0, ang * this.reboundSense);
      this.reboundYaw += turned;
      // The foam knocks some speed off (bounded, per 180° of the bounce) …
      if (this.rebound === 'foam') rel.multiplyScalar(1 - (c.roundhouseRebound * turned) / Math.PI);
      // … but in the whitewater, which runs with the break, it pushes a slow board up toward the peel speed.
      const spr = rel.length();
      const carry = Math.min(c.foamCarry * this.vp, this.reboundEntry);
      if (s.param.x <= c.foamReboundX && spr > 1e-3 && spr < carry) rel.multiplyScalar(Math.min(carry, spr + c.foamPush * dt) / spr);
      // Done once the line runs down the line again, dropping at REBOUND_EXIT (reached from above
      // coming over the top, from below coming round the bottom).
      const phi = Math.atan2(rel.dot(this.eUp), rel.dot(this.e1));
      if (rel.dot(this.e1) > 0 && (phi - REBOUND_EXIT) * this.reboundSense >= 0) this.endRebound();
    } else if (ang !== 0) {
      if (this.cutbackSense === 0) {
        this.cutbackSense = Math.sign(ang);
        this.cutbackEntry = sp;
      }
      this.cutbackYaw = Math.max(0, this.cutbackYaw + ang * this.cutbackSense);
      if (this.cutbackYaw === 0) this.cutbackSense = 0;
    }
    this.trackCarve(input.carve, Math.abs(ang));

    // --- pump: along the board's line, efficiency min(1, since/period), minus a fixed cost. A pump
    // works the face: the net gain scales with the local steepness, from pumpFlatGain on the flats
    // (weak, never nothing) to full on a steep face. ---
    if (input.pump) {
      const eff = Math.min(1, s.sincePump / c.pumpPeriod);
      const face = c.pumpFlatGain + (1 - c.pumpFlatGain) * smoothstep(c.pumpMinSteepness, c.pumpFullSteepness, steep);
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
        if (this.faceEdge(tb, tc, input.carve, dt)) return;
        if (keyless) this.holdLine();
      } else {
        this.atCrest = false;
        w.profile(s.param.x, s.param.t, s.p);
        w.normal(s.param.x, s.param.t, n);
        s.v.addScaledVector(n, -s.v.dot(n));
        // Bottoming out on the flats turns the board only with a turn held (keyless, it bogs down there).
        if (keyless) this.holdLine();
        else if (s.param.t <= 0) this.bottomTurn(dt, this.turningSense());
      }
    }
    if (keyless) this.lineHeading(s.heading);
    else this.headingFromMotion(s.heading);

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

    // A waiting snap scores after snapDeferMax s at the latest (no roundhouse came out of it in time).
    if (this.deferredSnap && s.time - this.deferredAt >= c.snapDeferMax) {
      this.deferredSnap = false;
      this.cutbackSnapped = true;
      this.emit({ type: 'snap', time: s.time });
    }

    // --- snap: heading reversal at the crest within the window, while carving ---
    if (this.snapArmed) {
      if (s.time - this.crestTime > c.snapWindow) this.snapArmed = false;
      else if (input.carve !== 0 && s.heading.angleTo(this.crestHeading) >= c.snapAngle * DEG) {
        this.snapArmed = false;
        // The snap is done: the rail lets go of the boost (no swinging on past the fall line).
        this.yawRate /= c.snapCarveBoost;
        // A snap that turns the board back toward the curl (a cutback over the top) waits: a ROUNDHOUSE
        // out of it replaces the snap.
        if ((this.cutbackYaw >= CUTBACK_ACTIVE && s.heading.x < 0) || this.rebound) {
          this.deferredSnap = true;
          this.deferredAt = s.time;
        } else this.emit({ type: 'snap', time: s.time });
      }
    }

    this.tubeTick(this.crestAt(s.param.x).y);
    if (s.mode !== 'riding') return;

    // --- lost the wave ---
    this.frameAt(s.param.x, s.param.t);
    // Measured against the BASE peel: a fast section's frame shift never counts as the wave leaving you.
    const sectionShift = this.vp - this.wave.params.peelSpeed;
    if (s.param.x > c.kickOutX && s.v.dot(this.e1) + sectionShift < c.kickOutMinSpeed) {
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
   * Carving (either way) into the top with a snap armed or pending, or in a rebound, is a turn off
   * the lip, not a launch: the rider is held at the lip while the (boosted) carve turns the board back down.
   * Airs come from arriving without a carve held (or letting go at the lip), or from an ollie.
   */
  private faceEdge(tb: number, tc: number, carve: number, dt: number): boolean {
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
    const lipTurn = carve !== 0 && (this.snapArmed || this.topPending || this.rebound !== null);
    // Just after letting go of a cutback, still running back toward the curl, the lip doesn't launch:
    // there is time to press again and carve off it.
    const world = this.tmp.copy(s.v).addScaledVector(this.e1, this.vp);
    const guard =
      this.cutbackYaw >= CUTBACK_ACTIVE &&
      world.dot(this.e1) < -TURN_SENSE_HYSTERESIS * world.length() &&
      s.time - this.releasedAt <= c.cutbackLaunchGuard;
    if (u > c.launchSpeed && !lipTurn && !guard) {
      this.enterAir('crest');
      this.beginAir('jump', tb, clamp(u * c.airGain, c.launchSpeed, c.maxAirSpeed));
      return true;
    }
    if (!this.atCrest) {
      this.atCrest = true;
      this.crestTime = s.time;
      this.crestHeading.copy(s.heading);
      this.snapArmed = true;
      // Armed here: the top-band arming must not re-arm this same climb (one snap per lip turn).
      this.topPending = false;
    }
    this.frameAt(s.param.x, tb);
    s.v.addScaledVector(n, -s.v.dot(n));
    // A lip turn holds the rider at the lip (the position is clamped there) while the boosted carve
    // turns the board's motion back down the face; the heading turns with the rail, never in one tick.
    if (lipTurn) return false;
    // Too slow to launch: the lip sheds the rider back down the face (no balancing on the ridge),
    // over a few ticks (crestShedRate) so the board's heading turns rather than flips.
    const up = s.v.dot(out);
    // Keyless the line is held (playtest 6): nothing turns the board off the lip. Gravity along its
    // line slows a board whose line climbs into the lip until it slides back down that line, tail
    // first, with no yaw (and a line along the lip runs along the top of the face).
    if (this.line !== null) return false;
    if (up > -c.crestShed) s.v.addScaledVector(out, -Math.min(up + c.crestShed, c.crestShedRate * dt));
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
    const inTube = x >= -D && x <= c.tubeXMax && s.p.y < c.tubeHeightFrac * crestY && s.p.z < this.wave.profile(x, 1, this.tmp).z - c.tubeUnderLip;
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

  /** The rebound has the board heading down the line again: a long enough held turn into it was a ROUNDHOUSE. */
  private endRebound(): void {
    const s = this.state;
    if (this.reboundHeld >= this.cfg.roundhouseDeg * DEG) {
      // The roundhouse replaces any snap on the way round (and the lip turn it ends in): a waiting one
      // is dropped, one that already scored is taken back.
      this.deferredSnap = false;
      this.snapArmed = false;
      this.topPending = false;
      this.emit({ type: 'roundhouse', time: s.time, degrees: (this.reboundHeld + this.reboundYaw) / DEG, replacesSnap: this.cutbackSnapped });
    }
    // Off the lip / out of the foam the wave throws the board back down the line — back toward the
    // speed it went in with, never beyond (a roundhouse costs a little speed).
    const sp = this.rel.length();
    const out = Math.max(sp, Math.min(sp + this.cfg.reboundKick, this.reboundEntry));
    if (sp > 1e-3) this.rel.multiplyScalar(out / sp);
    this.rebound = null;
    this.endCutback();
    // The rail lets go of the bounce's bite (no swinging on down the face) and the held key is spent.
    this.yawRate /= this.cfg.reboundBoost;
    this.carveSpent = this.heldSign !== 0;
  }

  /** The way the board is being turned round (a rebound, else an active held turn), or 0. */
  private turningSense(): number {
    if (this.rebound) return this.reboundSense;
    return this.heldSign !== 0 && !this.carveSpent ? this.heldSense : 0;
  }

  /** The cutback is over (no roundhouse out of it, or one already scored): a waiting snap scores now. */
  private endCutback(): void {
    if (this.deferredSnap) this.emit({ type: 'snap', time: this.state.time });
    this.deferredSnap = false;
    this.cutbackSnapped = false;
    this.cutbackYaw = 0;
    this.cutbackSense = 0;
    this.backFor = 0;
    this.wentBack = false;
  }

  /** Forget the held turn, the cutback and any rebound (a fresh start, or leaving the face). */
  private endTurn(): void {
    this.heldSign = 0;
    this.heldSense = 0;
    this.pressedBack = false;
    this.carveSpent = false;
    this.rebound = null;
    this.releasedAt = -Infinity;
    this.endCutback();
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
    this.line = null;
    this.endTurn();
    s.stalling = false;
    this.atCrest = false;
    this.snapArmed = false;
    this.nearTop = false;
    this.topPending = false;
    this.grabs = [];
    this.spinArmed = this.spinInput === 0;
    this.grabLocked = false;
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
      if (input.spin === 0) this.spinArmed = true;
      const spin = this.spinArmed ? input.spin : 0;
      s.turnRate = spin * c.spinRate * DEG;
      if (spin === 0) {
        // Landing assist: not spinning, the board settles to the nearest half turn (0 / 180 / 360…).
        const target = Math.round(s.airYaw / Math.PI) * Math.PI;
        const step = c.spinSettleRate * DEG * dt;
        s.turnRate = clamp((target - s.airYaw) / dt, -c.spinSettleRate * DEG, c.spinSettleRate * DEG);
        s.airYaw = Math.abs(target - s.airYaw) <= step ? target : s.airYaw + Math.sign(target - s.airYaw) * step;
      } else s.airYaw += s.turnRate * dt;
      // A grab still held just before touchdown is let go automatically (scored, no wipeout).
      if (!this.grabLocked && a.flightTime - s.airTime <= c.grabAutoRelease) this.grabLocked = true;
      const grab = this.grabLocked ? null : input.grab;
      if (grab !== s.grab) {
        if (s.grab) this.endGrab();
        if (grab) {
          this.grabStart = s.time;
          this.emit({ type: 'grabStart', time: s.time, kind: grab });
        }
        s.grab = grab;
      }
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
    this.endGrab();
    const off = Math.abs(wrapAngle(s.airYaw)) / DEG; // 0…180, board vs its take-off heading
    const aligned = off <= c.landTolerance;
    const reverse = off >= 180 - c.landTolerance;
    if (s.param.x < -this.wave.params.tubeDepth) return this.wipe('whitewater');
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
    // A waiting snap still shows (the wipeout then loses it with the pot).
    this.endCutback();
    s.mode = 'wipeout';
    s.wipeoutReason = reason;
    s.inTube = false;
    s.floating = false;
    s.grab = null;
    this.emit({ type: 'wipeout', time: s.time, reason });
  }
}
