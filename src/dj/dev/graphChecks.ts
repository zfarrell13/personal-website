import type { XfAssign } from '../constants';
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
  /** Level change of a 40 Hz sine when LOW is killed, dB. */
  lowKillDb: number;
  /** Master peak for a +12 dBFS sine at MASTER LEVEL max. */
  hotPeak: number;
}

const SR = 48000;

interface Scenario {
  hz: number;
  amp: number;
  xf?: XfAssign;
  crossfader?: number;
  low?: number;
  masterLevel?: number;
}

/**
 * Renders the real MixerGraph offline with a sine on CH1 and returns the master peak over
 * the last half second (after filters, smoothing and the limiter have settled).
 */
async function render(s: Scenario): Promise<number> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
  await Promise.all(WORKLET_URLS.map((u) => ctx.audioWorklet.addModule(u)));
  const mixer = new MixerGraph(ctx);
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
  osc.start();
  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = SR / 2; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  }
  return peak;
}

/** Checks the native mixer wiring the unit tests can't reach (runs in a real browser). */
export async function runGraphChecks(): Promise<GraphCheckResult> {
  const tone = { hz: 1000, amp: 0.25 };
  const [assignA_xfA, assignA_xfB, assignB_xfA, assignB_xfB, thru_xfA, thru_xfB, lowOn, lowKilled, hotPeak] = await Promise.all([
    render({ ...tone, xf: 'A', crossfader: 0 }),
    render({ ...tone, xf: 'A', crossfader: 1 }),
    render({ ...tone, xf: 'B', crossfader: 0 }),
    render({ ...tone, xf: 'B', crossfader: 1 }),
    render({ ...tone, xf: 'THRU', crossfader: 0 }),
    render({ ...tone, xf: 'THRU', crossfader: 1 }),
    render({ hz: 40, amp: 0.25, low: 0.5 }),
    render({ hz: 40, amp: 0.25, low: 0 }),
    render({ hz: 1000, amp: 4, masterLevel: 1 }),
  ]);
  return {
    assignA_xfA,
    assignA_xfB,
    assignB_xfA,
    assignB_xfB,
    thru_xfA,
    thru_xfB,
    lowKillDb: gainToDb(lowKilled) - gainToDb(lowOn),
    hotPeak,
  };
}
