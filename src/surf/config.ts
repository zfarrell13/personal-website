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
    peelSpeed: 8,
    /** D — tube depth (m): the lip lands in the trough D metres behind the curl. */
    tubeDepth: 5,
    /** Ls — shoulder length (m): the shoulder zone and where the height taper starts. */
    shoulderLength: 45,
    /**
     * Hollowness (the pitching lip) fades 1 → 0 over 0 < x < hollowLength. Spec deviation
     * (task 17 ruling): fading over all of Ls left the rider under a closed curtain on the
     * open face; 12 m keeps the barrel near the curl and an open, visible face beyond it.
     */
    hollowLength: 12,
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
    /** Fraction of the cross-line gravity the rail holds at speed ≥ gripSpeed (0 = no rail, 1 = perfect trim). */
    railGrip: 0.85,
    gripSpeed: 5,
    /** Wave drive gain along +x, multiplied by local steepness (m/s²). */
    drive: 2.2,
    /** Quadratic drag against the water (moving at −Vp in the frame). */
    drag: 0.04,
    stallDragMultiplier: 4,
    /** Carve yaw rate = carveRate / (1 + speed / carveHalfSpeed) (rad/s); turn radius = speed / rate grows with speed. */
    carveRate: 6,
    carveHalfSpeed: 15,
    /** The yaw rate eases toward its target with this time constant (s): a weighty rail. */
    carveLag: 0.12,
    /** Speed bled while a carve is held (m/s²). */
    carveBleed: 0.5,
    pumpImpulse: 3,
    /** Fixed speed cost per pump: spamming (low efficiency) nets less than rhythm. */
    pumpCost: 0.25,
    pumpPeriod: 0.6,
    /** A pump's net gain scales with the face steepness: none below pumpMinSteepness (the flats), full above pumpFullSteepness. */
    pumpMinSteepness: 0.1,
    pumpFullSteepness: 0.5,
    /** Upward normal speed at the crest needed to launch (m/s). */
    launchSpeed: 3,
    /** Reaching the top of the face too slow to launch pushes the rider back down at this speed (m/s). */
    crestShed: 1,
    /** … reaching that speed at this rate (m/s²): the lip turns the board back down over a few ticks. */
    crestShedRate: 40,
    snapWindow: 0.6,
    /** A climb whose apex is above this fraction of the crest height arms a snap (open face; spec: "at the crest"). */
    snapTopFrac: 0.7,
    /**
     * Carving at the top of the face with a snap armed or pending turns off the lip instead of
     * launching; while a snap is armed and a carve held, the carve's yaw rate is this many times faster.
     */
    snapCarveBoost: 2,
    /** Snap requires the heading to turn at least this much at the crest (deg). */
    snapAngle: 110,
    ollieImpulse: 4,
    /** Crest launch: speed off the face along the normal = up-face speed × airGain, in [launchSpeed, maxAirSpeed]. */
    airGain: 0.75,
    /** Cap on the pop speed of a crest launch (m/s). */
    maxAirSpeed: 9,
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
    /** Tube blend target on entry (rises with depth to 1); higher = the camera commits to the barrel sooner. */
    tubeBlendFloor: 0.9,
    /** Tube blend spring rate (1/s, ≈ 2 / settle time). */
    tubeBlendRate: 12,
    /** Position/look spring rate at full tube blend (lerps from `stiffness`). */
    tubeStiffness: 20,
    /** Frame x the tube camera never goes behind: the barrel is too thin to see from past x ≈ −4.5. */
    tubeMinX: -4,
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

/** Scene fog — single source shared by Environment and SurfGame. */
export const FOG_CONFIG = { color: '#bfdcf0', near: 60, far: 520 } as const;
