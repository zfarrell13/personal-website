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
    /**
     * Wave drive gain along +x, multiplied by local steepness (m/s²). Playtest 7: 1.3 → 0.8 — the concave
     * face is steeper where the lines run (mid face and up), so the same gain drove them harder: unpumped
     * lines outlived 10 s and fast sections cost too little.
     */
    drive: 0.8,
    /**
     * Quadratic drag against the water (moving at −Vp in the frame). Playtest 6: 0.025 → 0.032 — with
     * the rail holding the line on release (no sag, no release overshoot) unpumped lines kept more
     * speed; this keeps "the same lines without pumps lose the wave within 10 s" and the no-input catch.
     */
    drag: 0.032,
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
    /**
     * Roundhouse: running back toward the curl with a carve held, reaching the whitewater (frame
     * x ≤ foamReboundX, just ahead of the impact zone [−D, 0]; not deeper than −D/2) or turning up
     * into the lip (in the top band, or anywhere once a cutback is under way) rebounds the board
     * round, back down the line.
     */
    foamReboundX: 3,
    /** A rebound turns at this many times the carve rate (the lip / foam pushes the board round). */
    reboundBoost: 2,
    /**
     * Coming out of a rebound the board picks up this much speed along its new line (m/s): the wave
     * throws it back down the line — back toward the speed the cutback began with, never beyond it.
     */
    reboundKick: 2,
    /**
     * … and rebounding in the whitewater (x ≤ foamReboundX), which runs with the break, a slower board
     * is pushed up toward this share of the peel speed (no faster than the cutback began) at foamPush m/s².
     */
    foamCarry: 1,
    foamPush: 15,
    /** A whitewater rebound bleeds this share of the speed per 180° turned (before the kick / carry). */
    roundhouseRebound: 0.05,
    /**
     * A cutback of at least this many degrees (the carve yaw since the board last ran down the line,
     * across releases) that ends in a rebound scores a ROUNDHOUSE. (Playtest 6: 150 → 130. Letting go
     * now stops the turn on the spot; the old release easing added ≈ 20–25° to every cutback, so the
     * same two presses — cut back until running at the curl, let go, press into the lip — read ≈ 139°.)
     */
    roundhouseDeg: 130,
    /** A cutback is forgotten after this long (s) running back toward the curl without a rebound. */
    cutbackMemory: 1.5,
    /** A snap that turns the board back toward the curl waits this long (s) at most for a ROUNDHOUSE to replace it. */
    snapDeferMax: 0.35,
    /** For this long (s) after letting go of a cutback, still running back toward the curl, the lip doesn't launch. */
    cutbackLaunchGuard: 0.5,
    ollieImpulse: 4,
    /**
     * Charged ollie (playtest 5): Space down crouches (loads the board), Space up pops. A tap pops
     * ollieTapGain × ollieImpulse, a load held ollieChargeTime s or longer ollieFullGain × (linearly
     * between; holding longer keeps the full pop). Height grows with the square: a full load ≈ 2.8× a tap.
     */
    ollieTapGain: 0.8,
    ollieFullGain: 1.35,
    ollieChargeTime: 0.5,
    /** Crest launch: speed off the face along the normal = up-face speed × airGain, in [launchSpeed, maxAirSpeed]. */
    airGain: 0.75,
    /** Cap on the pop speed of a crest launch (m/s). */
    maxAirSpeed: 9,
    /**
     * Off a section peak the pop (crest air or ollie) is faster by this × the bump there (its extra height
     * as a fraction of the wave's): × 1.35 at the top of a full 35% peak — a steeper ramp, a bigger air.
     */
    peakAirLift: 1,
    /**
     * … scaled by the launch height up the face (y / crest y at the column): none below
     * peakAirFrom, full from peakAirFull — the steeper ramp is what pops you (a trough ollie gets none).
     */
    peakAirFrom: 0.4,
    peakAirFull: 0.75,
    spinRate: 540,
    /** A landing within this many degrees of a half turn (0 / 180 / 360…) is clean. */
    landTolerance: 60,
    /** Not spinning in the air, the board settles to the nearest half turn at this rate (deg/s). */
    spinSettleRate: 360,
    /** A grab held this close to touchdown (s) is let go automatically. */
    grabAutoRelease: 0.15,
    landingSpeedKeep: 0.9,
    /**
     * In the tube when −D ≤ x ≤ tubeXMax, y < tubeHeightFrac × crest height, and under the lip: at least
     * tubeUnderLip m seaward (in z) of the lip tip. Playtest 7: tubeHeightFrac 0.6 → 0.8 — the concave
     * pocket's wall is near vertical up to the face end (≈ 0.78 of the crest), all of it under the lip: a
     * never-pumping rider drifts through the curl at ≈ 0.7–0.78 of the crest, metres under the lip.
     */
    tubeXMax: 1,
    tubeHeightFrac: 0.8,
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
  /**
   * Fast sections: the break outruns the rider for a while while a section peak forms down the line
   * (see PeelController). Each one: the peel ramps up by minBoost–maxBoost over `ramp` s and holds
   * until the peak pitches (minRace–maxRace s after the start), surges to the peak, then ramps back.
   */
  sections: {
    /** Seconds between sections (uniform, seeded per run). */
    minGap: 10,
    maxGap: 20,
    /**
     * The race: seconds from the start of the section (the peak begins to form) to the pitch
     * (playtest 5: "about 3.5–4.5 s"). The boost holds from the end of the ramp up to the pitch.
     */
    minRace: 3.5,
    maxRace: 4.5,
    /** Peel speed boost as a fraction of Vp. */
    minBoost: 0.45,
    maxBoost: 0.5,
    /** Ramp up / down time (s). */
    ramp: 0.5,
  },
  /**
   * Section peaks (playtest 5): a temporary bump in the wave shape (physics and render alike) that
   * forms down the line at the start of every fast section and pitches when the race is over.
   */
  peak: {
    /** The peak forms this far (m, seeded) ahead of the rider's frame x … */
    minAhead: 15,
    maxAhead: 25,
    /** … but no further down the line than this frame x (the shoulder tapers away beyond). */
    maxSpawnX: 70,
    /** It grows to full height over minRise–maxRise s (seeded). */
    minRise: 2,
    maxRise: 3,
    /** Full height: the wave is this much taller (fraction) at the peak, and steeper on its face. */
    height: 0.35,
    /** Half-width of the bump along the wave (m). */
    width: 7,
    /**
     * The race: the peak drifts toward the curl (in the wave frame) so that at the pitch it sits at the
     * rider's starting frame x minus `allowance` × the race time. A rider who loses ground on the
     * fast section no faster than this (m/s) is on or past the peak at the pitch. Playtest 7 (the concave
     * face): 3.3 → 3.55. Measured from the section's start to the pitch (headless, seeds 1–12, lineBot
     * lines): pumping every 1 s loses 2.2–3.4 m/s, a human rhythm (0.8–1.2 s) 2.0–3.4 (all 12 make it),
     * every 1.3 s 2.9–4.0 (7 / 12), every 2 s 3.7–5.0 and no pumps 4.5–6.0 (none). At 3.3 the 1 / s and
     * human rhythms missed seed 11 (3.4 m/s); before playtest 7 the same probe read 2.1–3.1 / 1.9–3.2 /
     * 2.8–3.9 (7 / 12) / 3.5–4.6 / 4.3–5.6.
     */
    allowance: 3.55,
    /** The pitch carries the curl at least this far (m): the peak never pitches closer to the curl. */
    minPitchX: 1,
    /** … and never closer than this many m/s × race time down the line from where it formed (it always approaches). */
    minApproach: 2,
    /** The surge that carries the curl to the peak averages this speed (m/s) … */
    surgeSpeed: 25,
    /** … and lasts at least this long (s). */
    minSurge: 0.4,
    /** A launch counts as off the peak (SECTION AIR) at or above this share of the bump's full height … */
    airOn: 0.5,
    /** … and off its upper face: a crest launch, or launched at or above this share of the crest height. */
    airFromHeight: 0.6,
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
    /** The tube view's wider lens (vertical degrees): the rider fills under half the frame and the eye stays in view. */
    tubeFov: 85,
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
export const FOG_CONFIG = { color: '#a6dcec', near: 110, far: 560 } as const;
