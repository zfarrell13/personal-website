import type { WaveShape } from '../wave/WaveShape';
import { NO_INPUT, type SurferInput } from './input';
import type { Surfer } from './Surfer';

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
 * (bottom turn → top turn) with rhythmic pumps. Returns a per-tick input function.
 */
export function lineBot(surfer: Surfer, wave: WaveShape, o: LineBotOptions): (dt: number) => SurferInput {
  const { pumpEvery, low = 0.35, high = 0.6, slope = 0.15 } = o;
  let climbing = true;
  let since = 0;
  const input: SurferInput = { ...NO_INPUT };
  return (dt) => {
    const s = surfer.state;
    const frac = s.p.y / wave.crestY(s.param.x);
    if (climbing && frac > high) climbing = false;
    else if (!climbing && frac < low) climbing = true;
    const hy = s.heading.y;
    let carve = climbing ? (hy < slope ? 1 : 0) : hy > -slope ? -1 : 0;
    // Never turn back toward the curl.
    if (s.heading.x < 0 && carve !== 0) carve = climbing ? -1 : 1;
    since += dt;
    input.pump = pumpEvery > 0 && since >= pumpEvery;
    if (input.pump) since = 0;
    input.carve = carve;
    return input;
  };
}
