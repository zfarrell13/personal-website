import type { TrackEntry } from "@/shared/tracks";
import { SCRATCH_SEC_PER_REV, type DeckId } from "../../constants";
import {
  audiblePosSec,
  deckBpm,
  type EngineTelemetry,
} from "../../engine/telemetry";
import type { DjData } from "../../store/djStore";
import { platterAngle } from "./jogMath";
import {
  displayPosSec,
  drawJog,
  drawScreen,
  renderOverview,
  SCREEN_H,
  SCREEN_LAYOUT,
  SCREEN_W,
  type JogView,
  type ScreenView,
} from "./screenDraw";

export const JOG_PX = 320;

export interface DisplayDeps {
  telemetry: EngineTelemetry;
  getState: () => DjData;
  nowFrame: () => number;
  track: (id: string) => TrackEntry | undefined;
}

/**
 * Owns one deck's screen + jog canvases and redraws them every frame. The same
 * canvases are shown in the close-up DOM and used as CanvasTextures in the room view.
 */
export class DeckDisplay {
  readonly screen: HTMLCanvasElement;
  readonly jog: HTMLCanvasElement;
  /** Set by the Jog component while a finger is on the platter (for the ring highlight). */
  touched = false;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly jctx: CanvasRenderingContext2D;
  private overviewFor: unknown = null;
  private overviewCanvas: HTMLCanvasElement | null = null;
  private artworkId: string | null = null;
  private artwork: HTMLImageElement | null = null;

  constructor(
    readonly deck: DeckId,
    private readonly deps: DisplayDeps,
  ) {
    this.screen = document.createElement("canvas");
    this.screen.width = SCREEN_W;
    this.screen.height = SCREEN_H;
    this.jog = document.createElement("canvas");
    this.jog.width = JOG_PX;
    this.jog.height = JOG_PX;
    this.sctx = this.screen.getContext("2d")!;
    this.jctx = this.jog.getContext("2d")!;
    this.deckLabel = `DECK ${deck + 1}`;
    this.view = {
      deckLabel: this.deckLabel,
      loaded: false,
      loading: false,
      title: "",
      artist: "",
      keyName: "",
      trackBpm: 120,
      bpm: 0,
      tempoPct: 0,
      rangeLabel: "",
      masterTempo: false,
      isMaster: false,
      synced: false,
      quantize: true,
      quantizeBeats: 1,
      beatJumpBeats: 4,
      slip: false,
      posSec: 0,
      shadowSec: 0,
      slipActive: false,
      lengthSec: 0,
      cueSec: 0,
      firstBeatSec: 0,
      hotCues: [],
      memoryCuesSec: [],
      loopInSec: NaN,
      loopOutSec: NaN,
      loopActive: false,
      detail: null,
      overviewImage: null,
      zoomSec: 8,
      nowSec: 0,
    };
  }

  /** The loaded track's artwork once decoded (jog display, LED wall palette). */
  get artworkImage(): HTMLImageElement | null {
    return this.artwork;
  }

  private ensureAssets(s: DjData): void {
    const d = s.decks[this.deck];
    if (d.overview !== this.overviewFor) {
      this.overviewFor = d.overview;
      this.overviewCanvas = null;
      if (d.overview) {
        const c = document.createElement("canvas");
        c.width = SCREEN_W;
        c.height = SCREEN_LAYOUT.overview.h;
        renderOverview(c.getContext("2d")!, d.overview, c.width, c.height);
        this.overviewCanvas = c;
      }
    }
    if (d.trackId !== this.artworkId) {
      this.artworkId = d.trackId;
      this.artwork = null;
      const url = d.trackId ? this.deps.track(d.trackId)?.artworkUrl : null;
      if (url) {
        const img = new Image();
        img.src = url;
        img.onload = () => {
          if (this.artworkId === d.trackId) this.artwork = img;
        };
      }
    }
  }

  private memFor: unknown = null;
  private memoryCuesSec: number[] = [];
  private rangeFor = -1;
  private rangeLabel = "";
  private readonly deckLabel: string;
  private readonly view: ScreenView;
  private readonly jogView: JogView = {
    sizePx: JOG_PX,
    angle: 0,
    cueAngle: 0,
    artwork: null,
    playing: false,
    vinyl: true,
    touched: false,
  };

  draw(nowSec: number): void {
    const s = this.deps.getState();
    this.ensureAssets(s);
    const t = this.deps.telemetry;
    const tel = t.decks[this.deck];
    const d = s.decks[this.deck];
    const tr = d.trackId ? this.deps.track(d.trackId) : undefined;
    if (tr !== this.memFor) {
      this.memFor = tr;
      this.memoryCuesSec = tr
        ? tr.memoryCues.map((b) => tr.firstBeatSec + (b * 60) / tr.bpm)
        : [];
    }
    if (d.range !== this.rangeFor) {
      this.rangeFor = d.range;
      this.rangeLabel = d.range === 100 ? "WIDE" : `±${d.range}%`;
    }
    const pos = displayPosSec(
      audiblePosSec(t, this.deck, this.deps.nowFrame()),
      tel.loopActive,
      tel.loopInSec,
      tel.loopOutSec,
    );
    const v = this.view;
    v.loaded = tel.loaded && !!tr;
    v.loading = d.loading;
    v.title = tr?.title ?? "";
    v.artist = tr?.artist ?? "";
    v.keyName = tr?.key ?? "";
    v.trackBpm = tr?.bpm ?? 120;
    // deckBpm/baseRate: the display rate, never the PLL-trimmed TEL.rate.
    v.bpm = tel.loaded ? deckBpm(tel) : 0;
    v.tempoPct = (tel.baseRate - 1) * 100;
    v.rangeLabel = this.rangeLabel;
    v.masterTempo = d.masterTempo;
    v.isMaster = t.master === this.deck;
    v.synced = d.sync;
    v.quantize = d.quantize;
    v.quantizeBeats = d.quantizeBeats;
    v.beatJumpBeats = d.beatJumpBeats;
    v.slip = d.slip;
    v.posSec = pos;
    v.shadowSec = tel.shadowSec;
    v.slipActive = tel.slipFlags !== 0;
    v.lengthSec = tel.lengthSec;
    v.cueSec = tel.cueSec;
    v.firstBeatSec = tr?.firstBeatSec ?? 0;
    v.hotCues = d.hotCues;
    v.memoryCuesSec = this.memoryCuesSec;
    v.loopInSec = tel.loopInSec;
    v.loopOutSec = tel.loopOutSec;
    v.loopActive = tel.loopActive;
    v.detail = d.waveform;
    v.overviewImage = this.overviewCanvas;
    v.zoomSec = d.zoomSec;
    v.nowSec = nowSec;
    drawScreen(this.sctx, v);
    const j = this.jogView;
    j.angle = platterAngle(pos, SCRATCH_SEC_PER_REV);
    j.cueAngle = platterAngle(tel.cueSec, SCRATCH_SEC_PER_REV);
    j.artwork = this.artwork;
    j.playing = tel.state !== "PAUSED";
    j.vinyl = d.vinylMode;
    j.touched = this.touched;
    drawJog(this.jctx, j);
  }
}
