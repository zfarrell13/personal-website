import type { WaveformData } from "@/shared/waveform";
import { END_WARNING_SEC } from "../../constants";
import type { HotCueSlots } from "../../store/hotcueStorage";

/** CDJ-style 3-band waveform colours: low blue, mid amber, high white. */
export const WAVE_COLORS = {
  low: "#1f6bff",
  mid: "#ffa21a",
  high: "#ffffff",
} as const;

/** Internal canvas resolution of the deck screen (CSS scales it). */
export const SCREEN_W = 960;
export const SCREEN_H = 540;
export const SCREEN_LAYOUT = {
  header: { y: 0, h: 92 },
  detail: { y: 100, h: 250 },
  info: { y: 356, h: 60 },
  overview: { y: 424, h: 70 },
  footer: { y: 498, h: 42 },
} as const;

export interface ScreenView {
  deckLabel: string;
  loaded: boolean;
  loading: boolean;
  title: string;
  artist: string;
  keyName: string;
  trackBpm: number;
  bpm: number;
  tempoPct: number;
  rangeLabel: string;
  masterTempo: boolean;
  isMaster: boolean;
  synced: boolean;
  quantize: boolean;
  quantizeBeats: number;
  beatJumpBeats: number;
  slip: boolean;
  posSec: number;
  shadowSec: number;
  slipActive: boolean;
  lengthSec: number;
  cueSec: number;
  firstBeatSec: number;
  hotCues: HotCueSlots;
  memoryCuesSec: number[];
  loopInSec: number;
  loopOutSec: number;
  loopActive: boolean;
  detail: WaveformData | null;
  /** Pre-rendered overview (renderOverview), SCREEN_W × SCREEN_LAYOUT.overview.h. */
  overviewImage: CanvasImageSource | null;
  zoomSec: number;
  nowSec: number;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** Beats until the next memory cue as the CDJ's "BARS.BEATS" countdown, e.g. 13 beats → "3.2". */
export function barsBeatsCountdown(beatsRemaining: number): string {
  const b = Math.max(0, Math.floor(beatsRemaining));
  return `${Math.floor(b / 4)}.${(b % 4) + 1}`;
}

/** Beats from `posSec` to the next memory cue after it, or null. */
export function beatsToNextCue(
  posSec: number,
  cuesSec: readonly number[],
  bpm: number,
): number | null {
  const next = cuesSec.find((c) => c > posSec + 1e-3);
  return next === undefined ? null : ((next - posSec) * bpm) / 60;
}

/** Bin index of a detail waveform for screen column `x` (−1 when outside the track). */
export function detailBin(
  x: number,
  width: number,
  centerSec: number,
  visibleSec: number,
  binsPerSec: number,
  binCount: number,
): number {
  const sec = centerSec - visibleSec / 2 + (x / width) * visibleSec;
  const b = Math.floor(sec * binsPerSec);
  return b < 0 || b >= binCount ? -1 : b;
}

/** Needle search: x on the overview strip → seconds. */
export const overviewSeekSec = (
  x: number,
  width: number,
  lengthSec: number,
): number =>
  Math.min(lengthSec, Math.max(0, (x / Math.max(1, width)) * lengthSec));

/** The END warning flashes (2 Hz) in the last 30 s. */
export const endFlashOn = (
  posSec: number,
  lengthSec: number,
  nowSec: number,
): boolean => {
  const remaining = lengthSec - posSec;
  return (
    lengthSec > 0 &&
    remaining > 0 &&
    remaining <= END_WARNING_SEC &&
    Math.floor(nowSec * 2) % 2 === 0
  );
};

/**
 * Display position from the extrapolated audible position. While a loop is active the
 * extrapolation can run past the loop-out (and, for ~80 ms after a wrap, shows the
 * pre-jump spot), so keep the playhead inside the loop instead of flying past its end.
 */
export function displayPosSec(
  audibleSec: number,
  loopActive: boolean,
  loopInSec: number,
  loopOutSec: number,
): number {
  if (!loopActive || Number.isNaN(loopInSec) || Number.isNaN(loopOutSec))
    return audibleSec;
  return audibleSec > loopOutSec &&
    audibleSec - loopOutSec < loopOutSec - loopInSec
    ? loopOutSec
    : audibleSec;
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
  | "fillRect"
  | "fillText"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "save"
  | "restore"
  | "drawImage"
>;

type Band = "low" | "mid" | "high";
const PASSES: readonly Band[] = ["high", "mid", "low"];
/** Relative bar heights per pass: the white envelope behind, amber mids, blue lows in front. */
const PASS_SCALE: Record<Band, number> = { high: 1, mid: 0.85, low: 0.7 };

function passValue(band: Band, low: number, mid: number, high: number): number {
  if (band === "high") return Math.max(low, mid, high) / 255;
  if (band === "mid") return Math.max(low, mid) / 255;
  return low / 255;
}

/**
 * Draws 3-band bars for columns [0, width) in three colour passes (one fillStyle
 * change per pass, not per column). `binAt(x)` returns a bin index or −1.
 */
export function drawWaveColumns(
  ctx: Ctx,
  wf: WaveformData,
  width: number,
  midY: number,
  halfHeight: number,
  binAt: (x: number) => number,
): void {
  for (const band of PASSES) {
    ctx.fillStyle = WAVE_COLORS[band];
    const k = halfHeight * PASS_SCALE[band];
    for (let x = 0; x < width; x++) {
      const b = binAt(x);
      if (b < 0) continue;
      const h = passValue(band, wf.low[b]!, wf.mid[b]!, wf.high[b]!) * k;
      if (h > 0.5) ctx.fillRect(x, midY - h, 1, h * 2);
    }
  }
}

/** Renders a whole-track overview once (cached per track by DeckDisplay). */
export function renderOverview(
  ctx: Ctx,
  ov: WaveformData,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  drawWaveColumns(ctx, ov, width, height / 2, height / 2 - 4, (x) =>
    Math.min(ov.binCount - 1, Math.floor((x / width) * ov.binCount)),
  );
}

// Font strings hoisted so drawScreen does not rebuild them every frame.
const F_DECK = "600 22px system-ui, sans-serif";
const F_TITLE = "600 30px system-ui, sans-serif";
const F_ARTIST = "20px system-ui, sans-serif";
const F_BPM = "700 52px system-ui, sans-serif";
const F_BPM_LABEL = "600 20px system-ui, sans-serif";
const F_TEMPO = "600 26px system-ui, sans-serif";
const F_RANGE = "18px system-ui, sans-serif";
const F_BADGE = "700 16px system-ui, sans-serif";
const F_FLAG = "700 15px system-ui, sans-serif";
const F_CLOCK = "600 28px ui-monospace, monospace";
const F_END = "800 30px system-ui, sans-serif";
const F_COUNT = "600 22px ui-monospace, monospace";
const F_FOOT = "600 18px system-ui, sans-serif";

const BADGE_LABELS = ["MT", "MASTER", "SYNC", "Q", "SLIP"] as const;
const BADGE_COLORS = [
  "#ff4a4a",
  "#ffa21a",
  "#3aa0ff",
  "#ff4a4a",
  "#ff4a4a",
] as const;
const CUE_LETTERS = "ABCDEFGH";

export function drawScreen(ctx: Ctx, v: ScreenView): void {
  const W = SCREEN_W;
  const L = SCREEN_LAYOUT;
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, W, SCREEN_H);
  ctx.textBaseline = "middle";

  // ── header: deck, title/artist, key, BPM, tempo, badges
  ctx.fillStyle = "#10141c";
  ctx.fillRect(0, L.header.y, W, L.header.h);
  ctx.fillStyle = "#6f7a8e";
  ctx.font = F_DECK;
  ctx.textAlign = "left";
  ctx.fillText(v.deckLabel, 16, 24);
  ctx.fillStyle = "#f2f5fa";
  ctx.font = F_TITLE;
  ctx.fillText(
    v.loaded ? v.title : v.loading ? "LOADING…" : "NO TRACK — PRESS BROWSE",
    16,
    58,
  );
  ctx.fillStyle = "#9aa6bb";
  ctx.font = F_ARTIST;
  ctx.fillText(v.loaded ? `${v.artist}  ·  ${v.keyName}` : "", 16, 84);
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = F_BPM;
  ctx.fillText(v.loaded ? v.bpm.toFixed(1) : "--.-", W - 150, 46);
  ctx.font = F_BPM_LABEL;
  ctx.fillStyle = "#9aa6bb";
  ctx.fillText("BPM", W - 150, 82);
  ctx.fillStyle = v.tempoPct === 0 ? "#9aa6bb" : "#ffcf40";
  ctx.font = F_TEMPO;
  ctx.fillText(
    `${v.tempoPct >= 0 ? "+" : ""}${v.tempoPct.toFixed(2)}%`,
    W - 14,
    30,
  );
  ctx.font = F_RANGE;
  ctx.fillStyle = "#9aa6bb";
  ctx.fillText(v.rangeLabel, W - 14, 58);
  ctx.font = F_BADGE;
  let bx = W - 14;
  for (let i = 0; i < BADGE_LABELS.length; i++) {
    const on =
      i === 0
        ? v.masterTempo
        : i === 1
          ? v.isMaster
          : i === 2
            ? v.synced
            : i === 3
              ? v.quantize
              : v.slip;
    ctx.fillStyle = on ? BADGE_COLORS[i]! : "#2a303b";
    ctx.fillText(BADGE_LABELS[i]!, bx, 82);
    bx -= BADGE_LABELS[i]!.length * 11 + 14;
  }

  // ── detail waveform
  const D = L.detail;
  const midY = D.y + D.h / 2;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, D.y, W, D.h);
  if (v.detail && v.loaded) {
    const wf = v.detail;
    drawWaveColumns(ctx, wf, W, midY, D.h / 2 - 8, (x) =>
      detailBin(x, W, v.posSec, v.zoomSec, wf.binsPerSec, wf.binCount),
    );
    const x0Sec = v.posSec - v.zoomSec / 2;
    const pxPerSec = W / v.zoomSec;
    // loop region
    if (!Number.isNaN(v.loopInSec)) {
      const x0 = (v.loopInSec - x0Sec) * pxPerSec;
      const x1 = Number.isNaN(v.loopOutSec)
        ? x0 + 2
        : (v.loopOutSec - x0Sec) * pxPerSec;
      ctx.globalAlpha = v.loopActive ? 0.28 : 0.14;
      ctx.fillStyle = "#ffb000";
      ctx.fillRect(x0, D.y, Math.max(2, x1 - x0), D.h);
      ctx.globalAlpha = 1;
    }
    // beat grid (bars brighter)
    const spb = 60 / Math.max(1, v.trackBpm);
    const firstVisible = Math.ceil(
      (v.posSec - v.zoomSec / 2 - v.firstBeatSec) / spb,
    );
    for (let beat = firstVisible; ; beat++) {
      const s = v.firstBeatSec + beat * spb;
      const x = (s - x0Sec) * pxPerSec;
      if (x > W) break;
      ctx.fillStyle = beat % 4 === 0 ? "#ff3b3b" : "#8a93a6";
      ctx.fillRect(Math.round(x), D.y, beat % 4 === 0 ? 2 : 1, 10);
      ctx.fillRect(Math.round(x), D.y + D.h - 10, beat % 4 === 0 ? 2 : 1, 10);
    }
    // memory cues (red), cue (orange), hot cues (pad colour)
    for (let i = 0; i < v.memoryCuesSec.length; i++) {
      const m = v.memoryCuesSec[i]!;
      ctx.fillStyle = "#ff3b3b";
      ctx.fillRect((m - x0Sec) * pxPerSec - 1, D.y, 3, 18);
    }
    ctx.fillStyle = "#ff8c00";
    ctx.fillRect((v.cueSec - x0Sec) * pxPerSec - 1, D.y, 3, D.h);
    for (let i = 0; i < v.hotCues.length; i++) {
      const h = v.hotCues[i];
      if (!h) continue;
      const x = (h.sec - x0Sec) * pxPerSec;
      ctx.fillStyle = h.color;
      ctx.fillRect(x - 1, D.y, 3, D.h);
      ctx.fillRect(x, D.y, 20, 20);
      ctx.fillStyle = "#000";
      ctx.font = F_FLAG;
      ctx.textAlign = "left";
      ctx.fillText(CUE_LETTERS[i]!, x + 5, D.y + 11);
    }
    if (v.slipActive) {
      ctx.fillStyle = "#ff4a4a";
      ctx.globalAlpha = 0.8;
      ctx.fillRect((v.shadowSec - x0Sec) * pxPerSec, D.y, 2, D.h);
      ctx.globalAlpha = 1;
    }
  }
  // playhead
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(W / 2 - 1, D.y, 3, D.h);

  // ── info row: elapsed, remaining, countdown, END
  const I = L.info;
  ctx.textAlign = "left";
  ctx.font = F_CLOCK;
  ctx.fillStyle = "#e8ecf5";
  ctx.fillText(formatClock(v.posSec), 16, I.y + I.h / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = endFlashOn(v.posSec, v.lengthSec, v.nowSec)
    ? "#ff3b3b"
    : "#e8ecf5";
  ctx.fillText(
    `-${formatClock(v.lengthSec - v.posSec)}`,
    W - 16,
    I.y + I.h / 2,
  );
  if (endFlashOn(v.posSec, v.lengthSec, v.nowSec)) {
    ctx.fillStyle = "#ff3b3b";
    ctx.font = F_END;
    ctx.textAlign = "center";
    ctx.fillText("END", W / 2 + 140, I.y + I.h / 2);
  }
  const toCue = beatsToNextCue(v.posSec, v.memoryCuesSec, v.trackBpm);
  ctx.textAlign = "center";
  ctx.font = F_COUNT;
  ctx.fillStyle = "#ff6b6b";
  ctx.fillText(
    toCue === null ? "" : `${barsBeatsCountdown(toCue)} BARS`,
    W / 2 - 60,
    I.y + I.h / 2,
  );

  // ── overview with played region greyed and needle position
  const O = L.overview;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, O.y, W, O.h);
  if (v.overviewImage && v.loaded) {
    const played = v.lengthSec > 0 ? v.posSec / v.lengthSec : 0;
    ctx.drawImage(v.overviewImage, 0, O.y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, O.y, played * W, O.h);
    for (let i = 0; i < v.hotCues.length; i++) {
      const h = v.hotCues[i];
      if (!h || v.lengthSec <= 0) continue;
      ctx.fillStyle = h.color;
      ctx.fillRect((h.sec / v.lengthSec) * W - 1, O.y, 3, 10);
    }
    ctx.fillStyle = "#ff3b3b";
    ctx.fillRect(played * W - 1, O.y, 3, O.h);
  }

  // ── footer: jump size, quantize resolution, zoom
  const F = L.footer;
  ctx.font = F_FOOT;
  ctx.textAlign = "left";
  ctx.fillStyle = "#9aa6bb";
  const q = v.quantizeBeats >= 1 ? "1" : `1/${Math.round(1 / v.quantizeBeats)}`;
  ctx.fillText(
    `JUMP ${v.beatJumpBeats}  ·  QUANTIZE ${q}  ·  ZOOM ${v.zoomSec}s`,
    16,
    F.y + F.h / 2,
  );
}

export interface JogView {
  sizePx: number;
  angle: number;
  cueAngle: number;
  artwork: CanvasImageSource | null;
  playing: boolean;
  vinyl: boolean;
  touched: boolean;
}

let jogFontSize = 0;
let jogFont = "";

export function drawJog(
  ctx: Ctx &
    Pick<
      CanvasRenderingContext2D,
      "arc" | "clip" | "translate" | "rotate" | "closePath" | "fill"
    >,
  v: JogView,
): void {
  const s = v.sizePx;
  const c = s / 2;
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
  ctx.clip();
  if (v.artwork)
    ctx.drawImage(v.artwork, c - c * 0.62, c - c * 0.62, c * 1.24, c * 1.24);
  else {
    ctx.fillStyle = "#1a2233";
    ctx.fillRect(0, 0, s, s);
  }
  ctx.restore();
  // outer ring
  ctx.strokeStyle = v.touched ? "#4fc3ff" : "#2a3242";
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  // rotating position indicator
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(v.angle);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-s * 0.012, -c * 0.95, s * 0.024, c * 0.3);
  ctx.restore();
  // cue marker
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(v.cueAngle);
  ctx.fillStyle = "#ff8c00";
  ctx.beginPath();
  ctx.moveTo(0, -c * 0.99);
  ctx.lineTo(-s * 0.03, -c * 0.88);
  ctx.lineTo(s * 0.03, -c * 0.88);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#9aa6bb";
  if (jogFontSize !== s) {
    jogFontSize = s;
    jogFont = `600 ${Math.round(s * 0.06)}px system-ui, sans-serif`;
  }
  ctx.font = jogFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(v.vinyl ? "VINYL" : "CDJ", c, s * 0.93);
}
