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
    expect(formatClock(59.96)).toBe("01:00.0");
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
  it("clamps only a small overshoot past loop-out", () => {
    expect(displayPosSec(10.05, true, 8, 10)).toBe(10);
    expect(displayPosSec(9, true, 8, 10)).toBe(9);
    expect(displayPosSec(10.3, true, 8, 10)).toBe(10.3);
    expect(displayPosSec(10.3, false, 8, 10)).toBe(10.3);
    expect(displayPosSec(10.05, true, NaN, NaN)).toBe(10.05);
  });
  it("does not freeze after a jump landing just past a long armed loop", () => {
    expect(displayPosSec(12, true, 8, 32)).toBe(12);
    expect(displayPosSec(40, true, 8, 32)).toBe(40);
  });
  it("snaps a small post-wrap undershoot to loop-in", () => {
    expect(displayPosSec(7.95, true, 8, 10)).toBe(8);
    expect(displayPosSec(7.5, true, 8, 10)).toBe(7.5);
  });
});

function view(over: Partial<ScreenView> = {}): ScreenView {
  return {
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
    ...over,
  } as ScreenView;
}

describe("drawing", () => {
  it("draws waveform bars in three colour passes (low blue, mid amber, high white)", () => {
    const { ctx, calls } = recorder();
    drawWaveColumns(ctx, wf(10), 10, 50, 40, 0, 1);
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
    const v = view();
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

  const rects = (calls: Array<[string, unknown[]]>) =>
    calls.filter(([k]) => k === "fillRect").map(([, a]) => a as number[]);

  it("draws beat ticks at grid positions, including before firstBeatSec, and the playhead at centre", () => {
    const { ctx, calls } = recorder();
    drawScreen(ctx, view({ trackBpm: 120 }));
    const r = rects(calls);
    // pos 30, zoom 8 → 120 px/s, left edge 26 s; beat at 26.25 s is a bar (2 px wide) at x=30
    expect(
      r.some(([x, y, w, h]) => x === 30 && y === 100 && w === 2 && h === 10),
    ).toBe(true);
    expect(
      r.some(([x, y, w, h]) => x === 90 && y === 100 && w === 1 && h === 10),
    ).toBe(true);
    expect(
      r.some(([x, y, w, h]) => x === 479 && y === 100 && w === 3 && h === 250),
    ).toBe(true);
    const early = recorder();
    drawScreen(early.ctx, view({ posSec: 1, trackBpm: 120 }));
    // first tick at -2.75 s (before firstBeatSec 0.25) → x=30
    expect(
      rects(early.calls).some(([x, y, w]) => x === 30 && y === 100 && w === 1),
    ).toBe(true);
  });

  it("draws overview, hot cue and loop paths", () => {
    const { ctx, calls } = recorder();
    const hot = emptySlots();
    hot[0] = { sec: 31, color: "#12ab34" };
    drawScreen(
      ctx,
      view({
        overviewImage: {} as CanvasImageSource,
        hotCues: hot,
        loopInSec: 29,
        loopOutSec: 31,
        loopActive: true,
      }),
    );
    expect(calls.some(([k]) => k === "drawImage")).toBe(true);
    const fills = calls
      .filter(([k]) => k === "set:fillStyle")
      .map(([, a]) => a[0]);
    expect(fills).toContain("#12ab34");
    expect(fills).toContain("#ffb000");
    // hot cue tick on overview: 31/186 * 960
    expect(
      rects(calls).some(
        ([x, y, w, h]) =>
          Math.abs(x - ((31 / 186) * 960 - 1)) < 1e-6 &&
          y === 424 &&
          w === 3 &&
          h === 10,
      ),
    ).toBe(true);
  });

  it("survives non-finite positions without hanging", () => {
    const { ctx } = recorder();
    expect(() =>
      drawScreen(ctx, view({ posSec: NaN, firstBeatSec: NaN, zoomSec: 0 })),
    ).not.toThrow();
    expect(() => drawScreen(ctx, view({ posSec: Infinity }))).not.toThrow();
  });

  it("takes the max over the bins each column spans", () => {
    const { ctx, calls } = recorder();
    const w = wf(4);
    w.low.set([10, 250, 10, 10]);
    // 2 columns over 4 bins: column 0 spans bins 0-1, so its low bar reflects 250, not bin 0
    drawWaveColumns(ctx, w, 2, 50, 40, 0, 2);
    const lows = rects(calls).filter(
      ([, , , h]) => Math.abs(h - (250 / 255) * 40 * 0.7 * 2) < 1e-6,
    );
    expect(lows.length).toBe(1);
  });

  it("crops jog artwork to a square (cover)", () => {
    const { ctx, calls } = recorder();
    const art = { width: 200, height: 100 } as unknown as CanvasImageSource;
    drawJog(ctx as never, {
      sizePx: 200,
      angle: 0,
      cueAngle: 0,
      artwork: art,
      playing: true,
      vinyl: true,
      touched: false,
    });
    const d = calls.find(([k]) => k === "drawImage")![1] as number[];
    expect(d).toHaveLength(9);
    expect(d[3]).toBe(d[4]); // square source rect
    expect(d[3]).toBe(100);
    expect(d[1]).toBe(50);
  });
});
