import { clamp } from '../math/scalar';
import type { WaveShape } from '../wave/WaveShape';
import { NO_INPUT, type SurferInput } from './input';
import type { Surfer } from './Surfer';

/**
 * Turn early by this share of the height the board still travels while the turn comes round: the
 * vertical speed × (carve lag + the time to turn the line flat at the current speed). A competent
 * rider reads the speed; a fixed lead either cuts steep climbs short or plunges fast drops onto the flats.
 */
const ANTICIPATE = 0.6;

export interface LineBotOptions {
  /** Pump every this many seconds (0 = never). */
  pumpEvery: number;
  /** Bottom turn when below this fraction of the crest height … */
  low?: number;
  /** … top turn when above it. */
  high?: number;
  /** Carve until the board climbs / drops this steeply (|heading.y|). */
  slope?: number;
}

/**
 * Test support (not used by the game): a scripted rider doing down-the-line S-turns
 * (bottom turn → top turn) with rhythmic pumps. Returns a per-tick input function; the returned
 * object is reused between calls (read it before the next call, or copy it).
 */
export function lineBot(surfer: Surfer, wave: WaveShape, o: LineBotOptions): (dt: number) => SurferInput {
  const { pumpEvery, low = 0.35, high = 0.6, slope = 0.15 } = o;
  let climbing = true;
  let since = 0;
  const input: SurferInput = { ...NO_INPUT };
  return (dt) => {
    const s = surfer.state;
    // Turn early: the yaw rate is eased and the turn radius grows with speed, so the board keeps
    // climbing (or dropping) for a while after the turn starts.
    const c = surfer.cfg;
    const yawRate = c.carveRate / (1 + surfer.worldSpeed(surfer.peelSpeed) / c.carveHalfSpeed);
    const turnTime = c.carveLag + Math.asin(Math.min(1, Math.abs(s.heading.y))) / yawRate;
    const frac = (s.p.y + ANTICIPATE * s.v.y * turnTime) / wave.crestY(s.param.x);
    if (climbing && frac > high) climbing = false;
    else if (!climbing && frac < low) climbing = true;
    const hy = s.heading.y;
    // Ease the line's steepness in with distance from the curl: a rider right under it trims first.
    const room = clamp((s.param.x - 3) / 8, 0, 1);
    const lim = slope * room;
    let carve = climbing ? (hy < lim ? 1 : 0) : hy > -lim ? -1 : 0;
    // Heading toward the curl: carve down to the fall line, then bottom-turn out of it (a carve
    // toward the lip from near straight down swings through down the line, toward the shoulder).
    if (s.heading.x < 0) carve = -s.heading.y > -1.7 * s.heading.x ? 1 : -1;
    since += dt;
    input.pump = pumpEvery > 0 && since >= pumpEvery;
    if (input.pump) since = 0;
    input.carve = carve;
    return input;
  };
}
