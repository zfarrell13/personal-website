/**
 * Every surf-game tunable lives here. The debug panel (?debug) mutates this
 * object live; call `bumpConfig()` afterwards so caches (wave tables, mesh)
 * know to rebuild.
 */
export type Side = 'left' | 'right';

export const SURF_CONFIG = {
  wave: {
    /** H — nominal wave height (m). */
    height: 2.4,
    /** Vp — peel speed: how fast the wave frame moves along the reef (m/s). */
    peelSpeed: 7,
    /** D — tube depth (m): the lip lands in the trough D metres behind the curl. */
    tubeDepth: 5,
    /** Ls — shoulder length (m): hollowness fades 1 → 0 over 0 < x < Ls. */
    shoulderLength: 45,
    /** Height tapers from 100% at x = Ls to `taperMin` at x = `taperEnd`. */
    taperEnd: 90,
    taperMin: 0.4,
    /** Metres behind x = −D over which the closed barrel collapses into the foam mound. */
    collapseLength: 4,
    /** Foam mound height decays toward `moundMinScale` with this length (m). */
    moundDecay: 25,
    moundMinScale: 0.3,
    /** Frame-space x range of the simulated / rendered wave. */
    xMin: -30,
    xMax: 90,
  },
  physics: {
    hz: 120,
    gravity: 9.81,
    /** Face lift gain; equilibrium depth fraction = gravity / lift (0.5 → mid-face). */
    lift: 19.62,
    /** Damps oscillation up/down the face (1/s). */
    faceDamping: 1.5,
    /** Wave drive gain along +x, multiplied by local steepness (m/s²). */
    drive: 3.25,
    /** Quadratic drag against the water (moving at −Vp in the frame). */
    drag: 0.045,
    stallDragMultiplier: 4,
    /** Carve yaw rate = carveRate / (1 + speed / carveHalfSpeed) (rad/s). */
    carveRate: 3.2,
    carveHalfSpeed: 12,
    /** Speed bled while a carve is held (m/s²). */
    carveBleed: 0.8,
    pumpImpulse: 1.6,
    /** Fixed speed cost per pump: spamming (low efficiency) nets less than rhythm. */
    pumpCost: 0.25,
    pumpPeriod: 0.6,
    /** Upward normal speed at the crest needed to launch (m/s). */
    launchSpeed: 3,
    snapWindow: 0.4,
    /** Snap requires the heading to turn at least this much at the crest (deg). */
    snapAngle: 110,
    ollieImpulse: 4,
    spinRate: 540,
    landTolerance: 40,
    grabGrace: 0.1,
    landingSpeedKeep: 0.9,
    /** In the tube when −D ≤ x ≤ tubeXMax and y < tubeHeightFrac × crest height. */
    tubeXMax: 1,
    tubeHeightFrac: 0.6,
    kickOutX: 70,
    kickOutMinSpeed: 1.5,
    kickOutTime: 2,
    floaterMaxX: 0,
    floaterMinSpeed: 3,
    floaterMaxTime: 2.5,
    /** A continuous carve past this many degrees keeps a combo alive. */
    comboCarveDeg: 60,
    minSpeed: 0.5,
  },
  scoring: {
    comboWindow: 1.5,
    repeatFactor: 0.5,
  },
  camera: {
    stiffness: 4.5,
    lookStiffness: 7,
    fov: 62,
  },
  mesh: {
    columns: 160,
    rows: 64,
  },
};

export type SurfConfig = typeof SURF_CONFIG;
export type WaveParams = SurfConfig['wave'];
export type PhysicsParams = SurfConfig['physics'];

/**
 * The player's avatar colors and board graphic. PLACEHOLDERS until the user
 * supplies hair/skin/outfit colors and board art (see spec "Inputs needed").
 */
export const SURFER_LOOK = {
  skin: '#c68e5c',
  hair: '#3b2412',
  top: '#1f4fd1',
  shorts: '#f07a1a',
  boardDeck: '#fff4d6',
  boardStripe: '#0ea5e9',
  boardBottom: '#f5f5f5',
  boardText: 'ZF',
  /** Optional URL of user-provided deck art (≤ 256 px); overrides the text design. */
  boardImage: null as string | null,
};
export type SurferLook = typeof SURFER_LOOK;

let version = 0;
/** Monotonic counter; bumped whenever the debug panel edits SURF_CONFIG. */
export const configVersion = (): number => version;
export const bumpConfig = (): void => {
  version++;
};
