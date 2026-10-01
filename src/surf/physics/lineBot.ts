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
/** The bot's read of which way the board runs only flips once |heading.x| clears this (like the Surfer's turn sense). */
const SENSE_HYSTERESIS = 0.2;

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
 * (bottom turn → top turn) with rhythmic pumps. It steers like a player under the held-carve model:
 * hold a carve until the line climbs / drops at the commanded slope, then let go. Returns a per-tick
 * input function; the returned object is reused between calls (read it before the next call, or copy it).
 */
export function lineBot(surfer: Surfer, wave: WaveShape, o: LineBotOptions): (dt: number) => SurferInput {
  const { pumpEvery, low = 0.35, high = 0.6, slope = 0.15 } = o;
  let climbing = true;
  let since = 0;
  /** Which way along the wave the board runs (+1 toward the shoulder), with the Surfer's hysteresis. */
  let sense = 1;
  /** The rotation being held (+1: from down the line up the face), and the carve key that does it. */
  let heldRot = 0;
  let heldCarve = 0;
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
    if (Math.abs(s.heading.x) > SENSE_HYSTERESIS) sense = s.heading.x > 0 ? 1 : -1;
    const hy = s.heading.y;
    // Ease the line's steepness in with distance from the curl: a rider right under it trims first.
    const room = clamp((s.param.x - 3) / 8, 0, 1);
    const lim = slope * room;
    // A held carve keeps turning (the Surfer latches its sense on the press), so the bot holds a
    // carve until the line reaches the slope it wants, then lets go and the board holds that line.
    // Heading toward the curl: turn on round, down through the fall line, toward the shoulder.
    const rot = sense < 0 ? 1 : climbing ? (hy < lim ? 1 : 0) : hy > -lim ? -1 : 0;
    if (rot !== heldRot) {
      // A different turn needs a fresh press: let go for a tick first if a key is down.
      if (heldRot !== 0 && rot !== 0) {
        heldRot = 0;
        heldCarve = 0;
      } else {
        heldRot = rot;
        // The key whose meaning (+1 toward the lip) gives that rotation the way the board runs now.
        heldCarve = rot * sense;
      }
    }
    since += dt;
    input.pump = pumpEvery > 0 && since >= pumpEvery;
    if (input.pump) since = 0;
    input.carve = heldCarve;
    return input;
  };
}
