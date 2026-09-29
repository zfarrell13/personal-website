import { describe, expect, it } from "vitest";
import { angleDelta, JogTracker, jogZone, platterAngle } from "./jogMath";

describe("jog math", () => {
  it("splits the jog into top plate and ring", () => {
    expect(jogZone(100, 100, 100, 100, 100)).toBe("top");
    expect(jogZone(190, 100, 100, 100, 100)).toBe("ring");
    expect(jogZone(250, 100, 100, 100, 100)).toBe(null);
  });
  it("wraps angle deltas across ±π", () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9);
    expect(angleDelta(0.5, 0.2)).toBeCloseTo(-0.3, 9);
  });
  it("a clockwise quarter turn per 1/4 s converges to +1 rev/s", () => {
    const j = new JogTracker();
    j.begin(200, 100, 100, 100); // angle 0
    let v = 0;
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      j.move(100 + 100 * Math.cos(a), 100 + 100 * Math.sin(a), 100, 100);
      v = j.sample(0.25 / steps);
    }
    expect(v).toBeCloseTo(1, 2);
    expect(j.sample(1 / 60)).toBeLessThan(0.6); // stopped hand → decays
  });
  it("maps position to platter angle", () => {
    expect(platterAngle(0.9, 1.8)).toBeCloseTo(Math.PI, 9);
  });
});
