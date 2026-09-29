import { describe, expect, it } from "vitest";
import type { WaveformData } from "@/shared/waveform";
import { emptySlots } from "../../store/hotcueStorage";
import {
  barsBeatsCountdown,
  beatsToNextCue,
  detailBin,
  displayPosSec,
  drawJog,
  drawScreen,
  drawWaveColumns,
  endFlashOn,
  formatClock,
  overviewSeekSec,
  WAVE_COLORS,
  type ScreenView,
} from "./screenDraw";

/** Records calls; accepts any canvas method or property. */
function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (t, k: string) =>
      k in t ? t[k] : (...args: unknown[]) => void calls.push([k, args]),
    set: (t, k: string, v) => {
      t[k] = v;
      calls.push([`set:${k}`, [v]]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const wf = (n: number): WaveformData => ({
  binsPerSec: 150,
  binCount: n,
  low: new Uint8Array(n).fill(200),
  mid: new Uint8Array(n).fill(100),
  high: new Uint8Array(n).fill(50),
});

describe("screen helpers", () => {
  it("formats clocks and bar countdowns", () => {
    expect(formatClock(186.06)).toBe("03:06.1");
    expect(formatClock(-1)).toBe("00:00.0");
    expect(barsBeatsCountdown(13)).toBe("3.2");
    expect(barsBeatsCountdown(0)).toBe("0.1");
  });
  it("finds the next memory cue in beats", () => {
    expect(beatsToNextCue(10, [5, 20, 40], 120)).toBe(20);
    expect(beatsToNextCue(50, [5, 20], 120)).toBeNull();
  });
  it("maps screen columns to detail bins around the playhead", () => {
    expect(detailBin(480, 960, 10, 8, 150, 3000)).toBe(1500);
    expect(detailBin(0, 960, 1, 8, 150, 3000)).toBe(-1);
  });
  it("needle search maps x to seconds", () => {
    expect(overviewSeekSec(480, 960, 200)).toBe(100);
    expect(overviewSeekSec(2000, 960, 200)).toBe(200);
  });
  it("flashes END only in the last 30 s", () => {
    expect(endFlashOn(100, 200, 0)).toBe(false);
    expect(endFlashOn(180, 200, 0)).toBe(true);
    expect(endFlashOn(180, 200, 0.5)).toBe(false);
    expect(endFlashOn(200, 200, 0)).toBe(false);
  });
});

describe("displayPosSec", () => {
  it("holds the playhead at loop-out instead of overshooting, and passes through otherwise", () => {
    expect(displayPosSec(10.3, true, 8, 10)).toBe(10);
    expect(displayPosSec(9, true, 8, 10)).toBe(9);
    expect(displayPosSec(10.3, false, 8, 10)).toBe(10.3);
    expect(displayPosSec(10.3, true, NaN, NaN)).toBe(10.3);
    expect(displayPosSec(50, true, 8, 10)).toBe(50); // a real jump far past the loop is not clamped
  });
});

describe("drawing", () => {
  it("draws waveform bars in three colour passes (low blue, mid amber, high white)", () => {
    const { ctx, calls } = recorder();
    drawWaveColumns(ctx, wf(10), 10, 50, 40, (x) => x);
    const styles = calls
      .filter(([k]) => k === "set:fillStyle")
      .map(([, a]) => a[0]);
    expect(styles).toEqual([
      WAVE_COLORS.high,
      WAVE_COLORS.mid,
      WAVE_COLORS.low,
    ]);
    expect(calls.filter(([k]) => k === "fillRect")).toHaveLength(30);
  });

  it("draws a full screen and a jog display without throwing", () => {
    const { ctx } = recorder();
    const v: ScreenView = {
      deckLabel: "DECK 1",
      loaded: true,
      loading: false,
      title: "T",
      artist: "A",
      keyName: "8A",
      trackBpm: 124,
      bpm: 124,
      tempoPct: 0,
      rangeLabel: "±10%",
      masterTempo: false,
      isMaster: true,
      synced: false,
      quantize: true,
      quantizeBeats: 1,
      beatJumpBeats: 4,
      slip: false,
      posSec: 30,
      shadowSec: 30,
      slipActive: false,
      lengthSec: 186,
      cueSec: 0.25,
      firstBeatSec: 0.25,
      hotCues: emptySlots(),
      memoryCuesSec: [31.2],
      loopInSec: NaN,
      loopOutSec: NaN,
      loopActive: false,
      detail: wf(30000),
      overviewImage: null,
      zoomSec: 8,
      nowSec: 0,
    };
    expect(() => drawScreen(ctx, v)).not.toThrow();
    expect(() =>
      drawJog(ctx as never, {
        sizePx: 200,
        angle: 1,
        cueAngle: 0,
        artwork: null,
        playing: true,
        vinyl: true,
        touched: false,
      }),
    ).not.toThrow();
  });
});
