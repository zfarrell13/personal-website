import { Vector3 } from 'three';
import type { EventBus, SurfEvent } from '../physics/events';
import type { Surfer } from '../physics/Surfer';
import { nearestPier, PIER, PIER_RIDER, riderHitsPier } from './track';

/** Longest step (m) of the rider relative to the pier between collision samples: well under a piling's reach (0.7 m). */
const SWEEP_STEP = 0.1;
/** Past this far from the centre line (m along x) no part of the rider can touch the pier: the pass is over. */
const REACH_X = Math.max(PIER.width / 2, PIER.half + PIER.pilingR) + PIER_RIDER.boardHalf + PIER_RIDER.radius;
const UP = new Vector3(0, 1, 0);

/**
 * Shooting the pier, headless (the game and the tests drive it after each sim step, with the scenery's
 * travel before and after the step). Sweeps the rider against the pier's solid parts relative to the
 * pier — a surge moves the frame (and so the pier) up to ≈ 0.4 m a tick, so the rider's motion through
 * the pier over the step is sampled every SWEEP_STEP, never just its end — and wipes them out on
 * contact (PIER'D). Passing under it clean, past its centre line and out the other side while still
 * up (riding or in the air), scores SHOT THE PIER once per pass, doubled when in the barrel at the
 * centre line.
 */
export class PierDirector {
  /** Frame x of the pier nearest the rider (m): the HUD hint, the camera and the debug hook read it. */
  x = Infinity;
  /** World x of the pier whose centre line the rider is past this pass (NaN: none), and whether they were tubed there. */
  private crossed = NaN;
  private crossedInTube = false;
  /** World x of the last pier scored or run into: one award per pass. */
  private done = NaN;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly fwd = new Vector3();

  constructor(
    private readonly surfer: Surfer,
    private readonly bus: EventBus<SurfEvent>,
  ) {}

  reset(travel = 0): void {
    this.crossed = NaN;
    this.crossedInTube = false;
    this.done = NaN;
    this.x = nearestPier(travel, this.surfer.state.p.x).x;
  }

  /** Frame distance (m) from the rider down the line to the pier (≤ 0 once it is level with or behind them). */
  get ahead(): number {
    return this.x - this.surfer.state.p.x;
  }

  /** After the surfer's step: `travel0` / `travel1` = the scenery's travel at the start / end of it. */
  step(travel0: number, travel1: number): void {
    const s = this.surfer.state;
    const pier = nearestPier(travel1, s.p.x);
    const x1 = pier.x;
    const x0 = x1 + (travel1 - travel0);
    this.x = x1;
    if (s.mode !== 'riding' && s.mode !== 'airborne') return;
    const world = Math.round(x1 + travel1);
    // Pier-local rider positions at the start and end of the step.
    const a = this.a.copy(this.surfer.prevP);
    a.x -= x0;
    const b = this.b.copy(s.p);
    b.x -= x1;
    const fwd = this.fwd.copy(s.heading);
    if (s.mode === 'airborne' && s.launchKind !== null) fwd.applyAxisAngle(UP, s.airYaw);
    if (Math.min(a.x, b.x) <= REACH_X && Math.max(a.x, b.x) >= -REACH_X) {
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / SWEEP_STEP));
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        if (riderHitsPier(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, fwd.x, fwd.z)) {
          this.done = world;
          this.crossed = NaN;
          this.surfer.hitPier();
          return;
        }
      }
    }
    if (this.done === world) return;
    if (a.x < 0 && b.x >= 0) {
      this.crossed = world;
      this.crossedInTube = s.inTube;
    } else if (b.x < 0 && this.crossed === world) this.crossed = NaN; // back out the way they came in
    if (this.crossed === world && b.x >= REACH_X) {
      this.done = world;
      this.crossed = NaN;
      this.bus.emit({ type: 'shotThePier', time: s.time, inTube: this.crossedInTube });
    }
  }
}
