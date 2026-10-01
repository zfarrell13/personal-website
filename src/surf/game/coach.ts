import type { SurferState } from '../physics/Surfer';

/**
 * Tuning for the PUMP prompt. Frame x is the rider's distance ahead of the curl (the impact zone is
 * x ∈ [−D, 0]); the frame already moves at the live peel speed, so a falling x means losing ground.
 */
export const COACH_CONFIG = {
  /** Show only within this distance of the curl (m) … */
  nearX: 8,
  /** … and hide beyond it plus a margin (hysteresis). */
  hideX: 11,
  /** "Losing ground": x fell by at least `dropMin` m over the last `dropWindow` s … */
  dropWindow: 0.5,
  dropMin: 0.15,
  /** … continuously for `confirm` s. */
  confirm: 0.2,
  /** "Pulled ahead": x rose by at least `gainMin` m over the last `gainWindow` s. */
  gainWindow: 1,
  gainMin: 0.3,
  /** After hiding, stay quiet this long (s). */
  cooldown: 1,
  /** The pulse period (s): one pump per beat. */
  beat: 1,
  /**
   * Racing a section peak: "behind schedule" when the rider's frame x, carried on at its speed over
   * the last `raceWindow` s for the race time left, would fall more than `raceMargin` m short of where
   * the peak pitches. Shown at any distance from the curl while the race is on.
   */
  raceWindow: 0.5,
  raceMargin: 0.5,
} as const;

/** The race to a section peak (see PeelController): where it pitches and how long until then. */
export interface CoachRace {
  pitchX: number;
  timeLeft: number;
}

/** What the coach reads each tick (a SurferState fits). */
export type CoachFrame = Pick<SurferState, 'time' | 'mode' | 'stalling' | 'inTube'> & { param: { x: number } };

export interface CoachState {
  /** The ▲ PUMP prompt is up. */
  show: boolean;
  /** … and the rider is in the tube (the HUD reads "▲ PUMP OUT!"). */
  tube: boolean;
  /** Pumps landed this run (the HUD re-pops the prompt on each). */
  pumps: number;
  /**
   * 0…1 through the current beat on sim time; 0 = pump now. The beat restarts on the show and on each
   * pump. The HUD mirrors it in CSS (re-mounted on the show and each pump: pop, then a peak every
   * beat, paused with the game), so this is the reference clock for tests / the debug hook.
   */
  beatPhase: number;
}

/** Samples kept: the longest window at 120 Hz, with headroom. */
const HISTORY = 256;

/**
 * In-game coach: pops "▲ PUMP!" when the rider is near the curl and losing ground. Pure logic, fed
 * once per sim tick with the rider's state (and pump events); everything runs on sim time, so a
 * pause freezes it.
 */
export class Coach {
  readonly state: CoachState = { show: false, tube: false, pumps: 0, beatPhase: 0 };
  private enabled = true;
  private readonly times = new Float64Array(HISTORY);
  private readonly xs = new Float64Array(HISTORY);
  private head = 0;
  private count = 0;
  /** Sim time the "losing ground" condition started holding, or −1. */
  private losingSince = -1;
  private hiddenAt = -Infinity;
  private beatAt = 0;

  /** A new run (or GUIDE toggled): nothing showing, history cleared. */
  reset(enabled: boolean): void {
    this.enabled = enabled;
    this.state.show = false;
    this.state.tube = false;
    this.state.pumps = 0;
    this.state.beatPhase = 0;
    this.head = 0;
    this.count = 0;
    this.losingSince = -1;
    this.hiddenAt = -Infinity;
    this.beatAt = 0;
  }

  /** A pump landed (from the event bus): the beat restarts on it. */
  onPump(time: number): void {
    this.state.pumps++;
    this.beatAt = time;
  }

  /** `race`: the section peak's race while it is on (null otherwise). */
  update(f: CoachFrame, race: CoachRace | null = null): void {
    const c = COACH_CONFIG;
    const t = f.time;
    const x = f.param.x;
    this.record(t, x);
    const st = this.state;
    // Stalling = going for the barrel on purpose, or off the face: say nothing. In the tube without a
    // stall the rider is just being caught: keep prompting (PUMP OUT).
    const eligible = this.enabled && f.mode === 'riding' && !f.stalling;
    const drop = this.change(t, c.dropWindow);
    // Racing the peak: behind schedule = on the current pace, short of it at the pitch.
    const pace = race ? this.change(t, c.raceWindow) : null;
    const behind = race !== null && pace !== null && x + (pace / c.raceWindow) * race.timeLeft < race.pitchX - c.raceMargin;
    const losing = eligible && ((x < c.nearX && drop !== null && drop <= -c.dropMin) || behind);
    this.losingSince = losing ? (this.losingSince < 0 ? t : this.losingSince) : -1;

    if (st.show) {
      const gain = this.change(t, c.gainWindow);
      if (!eligible || (!behind && (x > c.hideX || (gain !== null && gain >= c.gainMin)))) {
        st.show = false;
        this.hiddenAt = t;
      }
    } else if (losing && t - this.losingSince >= c.confirm && t - this.hiddenAt >= c.cooldown) {
      st.show = true;
      this.beatAt = t;
    }
    st.tube = st.show && f.inTube;
    st.beatPhase = st.show ? (((t - this.beatAt) / c.beat) % 1 + 1) % 1 : 0;
  }

  private record(t: number, x: number): void {
    this.head = (this.head + 1) % HISTORY;
    this.times[this.head] = t;
    this.xs[this.head] = x;
    this.count = Math.min(HISTORY, this.count + 1);
  }

  /** x now minus x `window` s ago (the newest sample at least that old), or null without that much history. */
  private change(t: number, window: number): number | null {
    for (let i = 1; i < this.count; i++) {
      const k = (this.head - i + HISTORY) % HISTORY;
      if (t - this.times[k]! >= window - 1e-9) return this.xs[this.head]! - this.xs[k]!;
    }
    return null;
  }
}
