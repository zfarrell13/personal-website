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
    drive: 1.3,
    /** Quadratic drag against the water (moving at −Vp in the frame). */
    drag: 0.025,
    stallDragMultiplier: 4,
    /**
     * Stalling sets the rail: it holds the line on the face (full rail grip at any speed) and damps
     * the board's motion up / down the face at this rate (1/s), so the rider waits on the face for the
     * curl instead of sliding to the trough — and ends up under the lip.
     */
    stallHold: 3,
    /** Drag multiplier while bottomed out on the flats in front of the wave (t = 0): the board bogs down there. */
    flatsDragMultiplier: 2,
    /** Carve yaw rate = carveRate / (1 + speed / carveHalfSpeed) (rad/s); turn radius = speed / rate grows with speed. */
    carveRate: 6,
    carveHalfSpeed: 15,
    /** The yaw rate eases toward its target with this time constant (s): a weighty rail. */
    carveLag: 0.12,
    /** Speed bled while a carve is held (m/s²). */
    carveBleed: 0.7,
    pumpImpulse: 3.35,
    /** Fixed speed cost per pump: spamming (low efficiency) nets less than rhythm. */
    pumpCost: 0.35,
    pumpPeriod: 0.6,
    /**
     * A pump's net gain scales with the face steepness: pumpFlatGain of it below pumpMinSteepness
     * (the flats: weak, never nothing), full above pumpFullSteepness.
     */
    pumpMinSteepness: 0.1,
    pumpFullSteepness: 0.35,
    pumpFlatGain: 0.5,
    /** Slamming the trough is a bottom turn: the line swings toward along the wave at this rate (rad/s) … */
    bottomTurnRate: 12,
    /** … bleeding this share of the speed per 90° turned. */
    bottomTurnLoss: 0.25,
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
    /**
     * In the tube when −D ≤ x ≤ tubeXMax, y < tubeHeightFrac × crest height, and under the lip: at least
     * tubeUnderLip m seaward (in z) of the lip tip.
     */
    tubeXMax: 1,
    tubeHeightFrac: 0.6,
    tubeUnderLip: 0.3,
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
  /** Fast sections: the break outruns the rider for a while (see PeelController). */
  sections: {
    /** Seconds between sections (uniform, seeded per run). */
    minGap: 10,
    maxGap: 20,
    /**
     * Seconds a section holds at full speed (the ramps come on top). Task 4 retune (with the boost):
     * every section must be felt — the mildest (+45%, 4 s) costs a 1 s pumper ≈ 6.4–7.4 m of ground,
     * the hardest (+50%, 5 s) ≈ 10.5–11.3 m and swallows a rider pumping only every 2 s.
     */
    minHold: 4,
    maxHold: 5,
    /** Peel speed boost as a fraction of Vp. */
    minBoost: 0.45,
    maxBoost: 0.5,
    /** Ramp up / down time (s). */
    ramp: 0.5,
  },
  scoring: {
    comboWindow: 1.5,
    repeatFactor: 0.5,
  },
  camera: {
    /** Chase position spring rate (1/s, ≈ 2 / settle time): weighty but responsive. */
    stiffness: 4,
    lookStiffness: 6,
    fov: 62,
    /** Chase (a close bird's-eye view from behind): this far behind the rider along their travel direction (m) … */
    chaseBack: 3.5,
    /** … this high above them (m; floored above the local crest) … */
    chaseHeight: 4,
    /** … looking down at the point this far ahead of them along their travel direction (m). */
    chaseAhead: 3,
    /**
     * The chase's travel direction eases toward the board's heading (shortest arc) at this rate (1/s):
     * carves don't whip the camera, and a cutback swings it round behind the new line.
     */
    chaseYawRate: 3,
    /** The camera follows the rider through a spring this stiff (1/s): keeps up, but smooths pump kicks and landings. */
    followStiffness: 15,
    /** The tube view cuts in after the rider has been in the barrel this long (s) … */
    tubeCutIn: 0.2,
    /** … and back out after this long out of it (s). */
    tubeCutOut: 0.15,
    /** Position/look spring rate in the tube view (tight: the barrel is small). */
    tubeStiffness: 20,
    /** Riding at x ≤ pocketX below pocketHeightFrac × crest height (under the lip) also uses the tube view. */
    pocketX: 3,
    pocketHeightFrac: 0.6,
    /** Frame x the tube camera never goes behind: the closed barrel collapses into foam past x ≈ −D − 1. */
    tubeMinX: -6,
    /** Peak camera shake (m) in the impact zone where the lip lands. */
    shake: 0.06,
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
export const FOG_CONFIG = { color: '#b4d6f2', near: 60, far: 520 } as const;
