/**
 * Fixed-timestep accumulator. `advance` runs `step(dt)` as many times as the
 * elapsed frame time allows and returns the interpolation alpha in [0, 1)
 * between the previous and current simulation states.
 *
 * The sim loop must call `ActionState.tick()` inside the `step` callback so
 * `pressedThisFrame` edges are per physics tick, not per render frame.
 */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly dt: number,
    /** Frame times above this are clamped (tab switches, debugger pauses). */
    readonly maxFrame = 0.25,
  ) {}

  advance(frameSec: number, step: (dt: number) => void): number {
    this.acc += Math.min(Math.max(0, frameSec), this.maxFrame);
    // Small epsilon so float round-off never drops a step (e.g. 0.25 / 0.01).
    while (this.acc >= this.dt - 1e-9) {
      step(this.dt);
      this.acc -= this.dt;
    }
    return Math.max(0, this.acc / this.dt);
  }

  reset(): void {
    this.acc = 0;
  }
}
