import type { FxChannel, XfAssign } from '../constants';
import type { Scheduler } from '../engine/graph/BeatFxRouter';
import { MixerGraph } from '../engine/graph/MixerGraph';
import { gainToDb } from '../engine/mixer/MixerCore';
import { WORKLET_URLS } from '../engine/worklets/messages';

export interface GraphCheckResult {
  assignA_xfA: number;
  assignA_xfB: number;
  assignB_xfA: number;
  assignB_xfB: number;
  thru_xfA: number;
  thru_xfB: number;
  /** Master peak for a 0.25 sine at MASTER LEVEL 0.84 (0 dB): should be 0.25. */
  unityPeak: number;
  /** Level change of a 40 Hz sine when LOW is killed, dB. */
  lowKillDb: number;
  /** Master peak for a +12 dBFS sine at MASTER LEVEL max. */
  hotPeak: number;
  /** Beat FX insert moved CH1 → MASTER mid-tone: lowest / highest windowed RMS relative to steady state. */
  fxSwitchMinRatio: number;
  fxSwitchMaxRatio: number;
}

const SR = 48000;
const QUANTUM = 128 / SR;

interface Scenario {
  hz: number;
  amp: number;
  xf?: XfAssign;
  crossfader?: number;
  low?: number;
  masterLevel?: number;
  /** Beat FX insert point: selected before rendering, then moved at `fxSwitchAtSec`. */
  fxFrom?: FxChannel;
  fxTo?: FxChannel;
  fxSwitchAtSec?: number;
}

/** A Scheduler that runs callbacks at render time (suspend/resume), so offline renders are deterministic. */
function offlineScheduler(ctx: OfflineAudioContext): Scheduler {
  return (ms, fn) => {
    const at = Math.ceil((ctx.currentTime + ms / 1000) / QUANTUM + 1) * QUANTUM;
    void ctx.suspend(at).then(() => {
      fn();
      void ctx.resume();
    });
  };
}

/** Renders the real MixerGraph offline (1 s) with a sine on CH1 and returns the master output. */
async function renderMaster(s: Scenario): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
  await Promise.all(WORKLET_URLS.map((u) => ctx.audioWorklet.addModule(u)));
  const schedule = offlineScheduler(ctx);
  const mixer = new MixerGraph(ctx, { schedule });
  const osc = new OscillatorNode(ctx, { frequency: s.hz });
  osc.connect(new GainNode(ctx, { gain: s.amp })).connect(mixer.input(0));
  const strip = mixer.channels[0];
  strip.setFader(1, 1);
  strip.setColorFx('FILTER', 0, 0.5, 120);
  if (s.low !== undefined) strip.setEq('low', s.low);
  mixer.setXfAssign(0, s.xf ?? 'THRU');
  mixer.setCrossfader(s.crossfader ?? 0.5, 0);
  mixer.setMasterLevel(s.masterLevel ?? 0.84);
  mixer.setHeadphones(0, 0.6, 'STEREO');
  if (s.fxFrom) mixer.setBeatFxChannel(s.fxFrom);
  if (s.fxTo && s.fxSwitchAtSec !== undefined) {
    const to = s.fxTo;
    void ctx.suspend(s.fxSwitchAtSec).then(() => {
      mixer.setBeatFxChannel(to);
      void ctx.resume();
    });
  }
  osc.start();
  return ctx.startRendering();
}

/** Master peak over the last half second (after filters, smoothing and the limiter have settled). */
async function render(s: Scenario): Promise<number> {
  const out = await renderMaster(s);
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = SR / 2; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  }
  return peak;
}

/** Moves the Beat FX insert mid-tone and measures 5 ms RMS windows against the steady state before the move. */
async function fxSwitch(): Promise<{ min: number; max: number }> {
  const at = 0.5;
  const out = await renderMaster({ hz: 1000, amp: 0.25, fxFrom: '1', fxTo: 'MASTER', fxSwitchAtSec: at });
  const d = out.getChannelData(0);
  const win = 240;
  const rms = (start: number) => {
    let s = 0;
    for (let i = start; i < start + win; i++) s += d[i]! ** 2;
    return Math.sqrt(s / win);
  };
  let steady = 0;
  let n = 0;
  for (let i = Math.round(0.3 * SR); i + win <= Math.round((at - 0.02) * SR); i += win, n++) steady += rms(i);
  steady /= n;
  let min = Infinity;
  let max = 0;
  for (let i = Math.round((at - 0.02) * SR); i + win <= Math.round(0.9 * SR); i += win) {
    const r = rms(i) / steady;
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { min, max };
}

/** Checks the native mixer wiring the unit tests can't reach (runs in a real browser). */
export async function runGraphChecks(): Promise<GraphCheckResult> {
  const tone = { hz: 1000, amp: 0.25 };
  const [assignA_xfA, assignA_xfB, assignB_xfA, assignB_xfB, thru_xfA, thru_xfB, unityPeak, lowOn, lowKilled, hotPeak, sw] = await Promise.all([
    render({ ...tone, xf: 'A', crossfader: 0 }),
    render({ ...tone, xf: 'A', crossfader: 1 }),
    render({ ...tone, xf: 'B', crossfader: 0 }),
    render({ ...tone, xf: 'B', crossfader: 1 }),
    render({ ...tone, xf: 'THRU', crossfader: 0 }),
    render({ ...tone, xf: 'THRU', crossfader: 1 }),
    render({ ...tone, masterLevel: 0.84 }),
    render({ hz: 40, amp: 0.25, low: 0.5 }),
    render({ hz: 40, amp: 0.25, low: 0 }),
    render({ hz: 1000, amp: 4, masterLevel: 1 }),
    fxSwitch(),
  ]);
  return {
    assignA_xfA,
    assignA_xfB,
    assignB_xfA,
    assignB_xfB,
    thru_xfA,
    thru_xfB,
    unityPeak,
    lowKillDb: gainToDb(lowKilled) - gainToDb(lowOn),
    hotPeak,
    fxSwitchMinRatio: sw.min,
    fxSwitchMaxRatio: sw.max,
  };
}
