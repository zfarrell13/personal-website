import type { SurfConfig } from '../config';
import type { EventBus, LaunchKind, SurfEvent } from '../physics/events';
import type { SurferInput } from '../physics/input';
import type { Surfer } from '../physics/Surfer';
import type { PeelController } from '../wave/PeelController';
import type { WaveShape } from '../wave/WaveShape';
import type { CoachRace } from './coach';

/**
 * Runs the fast sections and their peaks around the surfer's physics step (playtest 5), headless:
 * the game and the tests drive the same code. Each tick it advances the peel (PeelController),
 * puts the peak into the wave shape, decides the race at the pitch, closes the section on a rider
 * short of the peak, and scores SECTION MADE / SECTION AIR through the event bus.
 */
export class SectionDirector {
  /** The rider was on or past the current peak at its pitch (null: no pitch yet this section). */
  made: boolean | null = null;
  /** The peak as of the previous tick (the render interpolates it like the rider). */
  readonly prevPeak = { x: 0, amp: 0 };
  private airPending = false;
  private airDone = false;
  private readonly raceState: CoachRace = { pitchX: 0, timeLeft: 0 };
  private readonly off: Array<() => void>;

  constructor(
    private readonly peel: PeelController,
    private readonly wave: WaveShape,
    private readonly surfer: Surfer,
    private readonly bus: EventBus<SurfEvent>,
    private readonly cfg: SurfConfig['peak'],
  ) {
    this.off = [
      bus.on('launched', (e) => this.onLaunch(e.kind)),
      bus.on('landed', (e) => {
        if (!this.airPending) return;
        // A clean landing (a bad one is a wipeout, not a landed event): SECTION AIR, once per peak.
        this.airPending = false;
        this.airDone = true;
        bus.emit({ type: 'sectionAir', time: e.time });
      }),
      bus.on('wipeout', () => {
        this.airPending = false;
      }),
    ];
  }

  /** A new run (after peel.reset): no peak in the wave. */
  reset(): void {
    this.wave.setPeak(0, 0, this.cfg.width);
    this.prevPeak.x = 0;
    this.prevPeak.amp = 0;
    this.made = null;
    this.airPending = false;
    this.airDone = false;
  }

  /** The race to the peak while it is on (where it pitches, time left), for the coach; else null. */
  get race(): CoachRace | null {
    const pk = this.peel.peak;
    if (pk.phase !== 'rising') return null;
    this.raceState.pitchX = pk.xPitch;
    this.raceState.timeLeft = pk.raceTime - pk.age;
    return this.raceState;
  }

  /**
   * One sim tick: peel and peak, then the surfer's step. Returns the frame shift (m along x) of the
   * pitch's surge this tick (≤ 0), which the camera follows.
   */
  step(input: SurferInput, dt: number): number {
    const s = this.surfer.state;
    const section = this.peel.update(s.time + dt, s.param.x);
    const pk = this.peel.peak;
    this.prevPeak.x = this.wave.peak.x;
    this.prevPeak.amp = this.wave.peak.amp;
    this.wave.setPeak(pk.x, pk.amp, pk.width);
    // Only a live ride (riding / airborne) announces a section or makes one: none after a wipeout / kick-out.
    const live = s.mode === 'riding' || s.mode === 'airborne';
    if (section === 'start') {
      this.made = null;
      this.airPending = false;
      this.airDone = false;
      if (live) this.bus.emit({ type: 'fastSection', time: s.time, boost: this.peel.boost });
    } else if (section === 'pitch' && live) {
      // The race is over: on or past the peak, the new barrel is behind you; short of it, the section closes on you.
      this.made = s.param.x >= pk.xPitch;
      this.surfer.closing = !this.made;
      this.bus.emit({ type: 'peakPitch', time: s.time, made: this.made, x: pk.xPitch });
    }
    this.surfer.setPeelSpeed(this.peel.speed);
    this.surfer.step(input, dt);
    if (section === 'surged') {
      // The curl has reached the peak: whoever it was closing on is closed out; a rider still up who made it scores.
      if (this.surfer.closing) this.surfer.closeOut();
      this.surfer.closing = false;
      if (this.made && (s.mode === 'riding' || s.mode === 'airborne')) this.bus.emit({ type: 'sectionMade', time: s.time });
    }
    return -this.peel.surge * dt;
  }

  /**
   * A launch off the section peak goes for SECTION AIR: on its upper part (the bump ≥ airOn of full)
   * and off its upper face — a crest launch, or launched at ≥ airFromHeight of the crest height (an
   * ollie from the trough in the peak's column is not an air off the peak).
   */
  private onLaunch(kind: LaunchKind): void {
    const pk = this.peel.peak;
    if (this.airDone || (pk.phase !== 'rising' && pk.phase !== 'pitching')) return;
    const s = this.surfer.state;
    const onPeak = this.wave.peakBump(s.param.x) >= this.cfg.airOn * this.cfg.height;
    const upFace = kind === 'crest' || s.p.y >= this.cfg.airFromHeight * this.wave.crestY(s.param.x);
    this.airPending = onPeak && upFace;
  }

  dispose(): void {
    this.off.splice(0).forEach((u) => u());
  }
}
