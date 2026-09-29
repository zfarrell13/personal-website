import type { TrackEntry } from '@/shared/tracks';
import { BEAT_FX_DIVISIONS, type DeckId } from '../constants';
import { deckSettingsFromState, diffSettings, type DjData } from '../store/djStore';
import type { DeckEvent, DeckSettings } from './core/DeckCore';
import type { DeckCommand, DecksPortMessage } from './core/protocol';
import { DeckOutput } from './graph/DeckOutput';
import { MixerGraph } from './graph/MixerGraph';
import { createStretches } from './graph/stretch';
import { mtWetAllowed } from './masterTempo';
import { applyTelemetry, createTelemetry, deckBpm, type EngineTelemetry } from './telemetry';
import { pcmForDeck, pcmTransferList, TrackLoader } from './TrackLoader';
import { PROCESSORS, WORKLET_URLS } from './worklets/messages';

export interface EngineOptions {
  onDeckEvent?: (deck: DeckId, e: DeckEvent) => void;
}

/**
 * Owns the AudioContext and the whole graph:
 * decks worklet → DeckOutput (Master Tempo) ×2 → MixerGraph → destination (+ headphones).
 * Applies store changes (applyState) and per-frame work (tick). Never touches React.
 */
export class AudioEngine {
  readonly telemetry: EngineTelemetry;
  readonly loader: TrackLoader;
  private readonly lastSettings: [DeckSettings | null, DeckSettings | null] = [null, null];
  private lastColorBpm = 0;
  private disposed = false;

  private constructor(
    readonly ctx: AudioContext,
    private readonly decks: AudioWorkletNode,
    private readonly outs: readonly [DeckOutput, DeckOutput],
    readonly mixer: MixerGraph,
    readonly mtAvailable: boolean,
    /** Master Tempo latency; the dry path is delayed by the same amount. */
    private readonly stretchLatencySec: number,
    opts: EngineOptions,
  ) {
    this.telemetry = createTelemetry(ctx.sampleRate);
    this.updateLatency();
    this.loader = new TrackLoader(ctx);
    decks.port.onmessage = (e: MessageEvent<DecksPortMessage>) => {
      const m = e.data;
      if (m.t === 'tel') applyTelemetry(this.telemetry, m.data);
      else if (m.t === 'event') opts.onDeckEvent?.(m.deck, m.e);
    };
  }

  /** Must be called from a user gesture (autoplay policy). */
  static async create(opts: EngineOptions = {}): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      await Promise.all(WORKLET_URLS.map((u) => ctx.audioWorklet.addModule(u)));
      // Both decks render to their own stereo output; without these options the worklet stays silent.
      const decks = new AudioWorkletNode(ctx, PROCESSORS.decks, {
        numberOfInputs: 0,
        numberOfOutputs: 2,
        outputChannelCount: [2, 2],
      });

      // Master Tempo is optional: on failure or timeout the decks play dry (varispeed only).
      const stretch = await createStretches(ctx, 2);
      const latency = stretch?.latencySec ?? 0;
      const outs = [
        new DeckOutput(ctx, stretch?.nodes[0] ?? null, latency),
        new DeckOutput(ctx, stretch?.nodes[1] ?? null, latency),
      ] as const;
      const mixer = new MixerGraph(ctx);
      for (const i of [0, 1] as const) {
        decks.connect(outs[i].input, i, 0);
        outs[i].output.connect(mixer.input(i));
      }

      // Beat clock: decks worklet → Beat FX worklet, sample-accurate, no main-thread hop.
      const channel = new MessageChannel();
      decks.port.postMessage({ t: 'clockPort', port: channel.port1 }, [channel.port1]);
      mixer.beatFx.connectClock(channel.port2);
      mixer.beatFx.setLatencyFrames(Math.round(latency * ctx.sampleRate));

      if (ctx.state !== 'running') await ctx.resume();
      return new AudioEngine(ctx, decks, outs, mixer, stretch !== null, latency, opts);
    } catch (err) {
      await ctx.close().catch(() => undefined);
      throw err;
    }
  }

  /** Stretch latency + the context's current output latency (which can change at runtime). */
  private updateLatency(): void {
    this.telemetry.latencySec = this.stretchLatencySec + (this.ctx.outputLatency || 0);
  }

  command(c: DeckCommand, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    this.decks.port.postMessage(c, transfer);
  }

  /** Transfers a copy of the decoded PCM to the deck worklet (the cached AudioBuffer stays intact). */
  loadTrack(deck: DeckId, t: TrackEntry, buffer: AudioBuffer, hotCuesSec: (number | null)[]): void {
    const pcm = pcmForDeck(buffer);
    const memoryCuesSec = t.memoryCues.map((beat) => t.firstBeatSec + (beat * 60) / t.bpm);
    this.command(
      { t: 'load', deck, left: pcm.left, right: pcm.right, bpm: t.bpm, firstBeatSec: t.firstBeatSec, memoryCuesSec, hotCuesSec },
      pcmTransferList(pcm) as Transferable[],
    );
  }

  /** Applies store changes to the worklets and nodes. `prev` null = apply everything. */
  applyState(s: DjData, prev: DjData | null): void {
    if (this.disposed) return;
    for (const i of [0, 1] as const) {
      const next = deckSettingsFromState(s.decks[i]);
      const patch = diffSettings(this.lastSettings[i], next);
      if (Object.keys(patch).length > 0) this.command({ t: 'set', deck: i, patch });
      this.lastSettings[i] = next;
      if (!prev || prev.decks[i].sync !== s.decks[i].sync) this.command({ t: 'sync', deck: i, on: s.decks[i].sync });
    }

    const m = s.mixer;
    const pm = prev?.mixer;
    for (const i of [0, 1] as const) {
      const c = m.ch[i];
      const pc = pm?.ch[i];
      const strip = this.mixer.channels[i];
      if (!pm || !pc) {
        strip.setTrim(c.trim);
        strip.setEq('high', c.hi);
        strip.setEq('mid', c.mid);
        strip.setEq('low', c.low);
        strip.setFader(c.fader, m.chCurve);
        strip.setCue(c.cue);
        this.mixer.setXfAssign(i, c.xf);
        strip.setColorFx(m.colorFxType, c.color, m.colorFxParam, this.masterBpm());
        continue;
      }
      if (pc.trim !== c.trim) strip.setTrim(c.trim);
      if (pc.hi !== c.hi) strip.setEq('high', c.hi);
      if (pc.mid !== c.mid) strip.setEq('mid', c.mid);
      if (pc.low !== c.low) strip.setEq('low', c.low);
      if (pc.fader !== c.fader || pm.chCurve !== m.chCurve) strip.setFader(c.fader, m.chCurve);
      if (pc.cue !== c.cue) strip.setCue(c.cue);
      if (pc.xf !== c.xf) this.mixer.setXfAssign(i, c.xf);
      if (pc.color !== c.color || pm.colorFxType !== m.colorFxType || pm.colorFxParam !== m.colorFxParam) {
        strip.setColorFx(m.colorFxType, c.color, m.colorFxParam, this.masterBpm());
      }
    }
    if (!pm || pm.crossfader !== m.crossfader || pm.xfCurve !== m.xfCurve) this.mixer.setCrossfader(m.crossfader, m.xfCurve);
    if (!pm || pm.masterLevel !== m.masterLevel) this.mixer.setMasterLevel(m.masterLevel);
    if (!pm || pm.masterCue !== m.masterCue) this.mixer.setMasterCue(m.masterCue);
    if (!pm || pm.cueMix !== m.cueMix || pm.hpLevel !== m.hpLevel || pm.hpMode !== m.hpMode) {
      this.mixer.setHeadphones(m.cueMix, m.hpLevel, m.hpMode);
    }
    const fx = m.beatFx;
    if (!pm || pm.beatFx !== fx) {
      this.mixer.beatFx.set(fx.type, BEAT_FX_DIVISIONS[fx.divisionIndex] ?? 1, fx.depth, fx.on);
      this.mixer.setBeatFxChannel(fx.channel);
    }
  }

  /** Per animation frame: meters, latency, Master Tempo wet/dry + pitch, DUB ECHO tempo follow. */
  tick(s: DjData): void {
    if (this.disposed) return;
    this.updateLatency();
    this.mixer.readLevels(this.telemetry.levels);
    for (const i of [0, 1] as const) {
      const tel = this.telemetry.decks[i];
      const out = this.outs[i];
      out.setWet(mtWetAllowed(s.decks[i].masterTempo && out.hasMasterTempo, tel, s.decks[i].reverse));
      out.setRate(tel.rate);
    }
    const bpm = this.masterBpm();
    if (Math.abs(bpm - this.lastColorBpm) > 0.5) {
      this.lastColorBpm = bpm;
      for (const i of [0, 1] as const) this.mixer.channels[i].setColorFx(s.mixer.colorFxType, s.mixer.ch[i].color, s.mixer.colorFxParam, bpm);
    }
  }

  masterBpm(): number {
    const m = this.telemetry.master;
    return m === -1 ? 120 : deckBpm(this.telemetry.decks[m]) || 120;
  }

  /** Master spectrum (128 bins, 0..255) for the LED wall. */
  readSpectrum(out: Uint8Array<ArrayBuffer>): void {
    this.mixer.fftAnalyser.getByteFrequencyData(out);
  }

  /** Current AudioContext frame (for telemetry extrapolation). */
  nowFrame(): number {
    return this.ctx.currentTime * this.ctx.sampleRate;
  }

  /** Idempotent: removes port listeners, disconnects every node, closes the context. StrictMode-safe. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.decks.port.onmessage = null;
    this.decks.port.close();
    this.decks.disconnect();
    for (const o of this.outs) o.dispose();
    this.mixer.dispose();
    if (this.ctx.state !== 'closed') await this.ctx.close();
  }
}
