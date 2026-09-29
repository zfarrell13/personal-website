import type { HeadphoneMode } from '../../constants';
import { cueMixGains, levelGain } from '../mixer/MixerCore';
import { smooth } from './params';

/** Where the headphone bus goes: a second output device if chosen, else (SPLIT) the main output. */
export interface HeadphoneRouting {
  /** What the main output (AudioContext.destination) plays. */
  main: 'master' | 'split';
  /** Headphone bus goes to the selected device. */
  device: boolean;
  /** Which headphone signal feeds the device: stereo mix or cue-left/master-right split. */
  deviceSignal: 'stereo' | 'split';
}

export function headphoneRouting(mode: HeadphoneMode, deviceActive: boolean): HeadphoneRouting {
  return {
    main: !deviceActive && mode === 'SPLIT' ? 'split' : 'master',
    device: deviceActive,
    deviceSignal: mode === 'SPLIT' ? 'split' : 'stereo',
  };
}

export const supportsSinkSelection = (): boolean =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Headphone bus: Σ CUE taps + master, CUE/MASTER MIX, level, STEREO or SPLIT.
 * With a second device: MediaStreamAudioDestinationNode → <audio>.setSinkId(device).
 */
export class HeadphoneOutput {
  readonly cueIn: GainNode;
  readonly masterIn: GainNode;
  /** cue (left) / master (right) split signal, used for the device or the main-output fallback. */
  readonly splitOut: GainNode;
  private readonly stereoOut: GainNode;
  private readonly cueGain: GainNode;
  private readonly masterGain: GainNode;
  private readonly nodes: AudioNode[];
  private dest: MediaStreamAudioDestinationNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private mode: HeadphoneMode = 'STEREO';

  constructor(private readonly ctx: BaseAudioContext) {
    this.cueIn = new GainNode(ctx);
    this.masterIn = new GainNode(ctx);
    this.cueGain = new GainNode(ctx, { gain: 1 });
    this.masterGain = new GainNode(ctx, { gain: 0 });
    this.stereoOut = new GainNode(ctx, { gain: levelGain(0.6) });
    this.cueIn.connect(this.cueGain).connect(this.stereoOut);
    this.masterIn.connect(this.masterGain).connect(this.stereoOut);

    const mono = () => new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const cueMono = mono();
    const masterMono = mono();
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.splitOut = new GainNode(ctx, { gain: levelGain(0.6) });
    this.cueIn.connect(cueMono).connect(merger, 0, 0);
    this.masterIn.connect(masterMono).connect(merger, 0, 1);
    merger.connect(this.splitOut);
    this.nodes = [this.cueIn, this.masterIn, this.cueGain, this.masterGain, this.stereoOut, cueMono, masterMono, merger, this.splitOut];
  }

  get deviceActive(): boolean {
    return this.audio !== null;
  }

  setMix(cueMix: number, level: number, mode: HeadphoneMode): void {
    const [c, m] = cueMixGains(cueMix);
    smooth(this.cueGain.gain, c, this.ctx);
    smooth(this.masterGain.gain, m, this.ctx);
    smooth(this.stereoOut.gain, levelGain(level), this.ctx);
    smooth(this.splitOut.gain, levelGain(level), this.ctx);
    if (mode !== this.mode) {
      this.mode = mode;
      this.routeDevice();
    }
  }

  private detachDest(): void {
    if (!this.dest) return;
    for (const src of [this.stereoOut, this.splitOut]) {
      try {
        src.disconnect(this.dest);
      } catch {
        /* was not connected */
      }
    }
  }

  private routeDevice(): void {
    if (!this.dest) return;
    this.detachDest();
    (headphoneRouting(this.mode, true).deviceSignal === 'split' ? this.splitOut : this.stereoOut).connect(this.dest);
  }

  /** Sends the headphone bus to an output device (null = off). Resolves false if unsupported or refused. */
  async setDevice(sinkId: string | null): Promise<boolean> {
    if (sinkId === null) {
      this.audio?.pause();
      if (this.audio) this.audio.srcObject = null;
      this.audio = null;
      this.detachDest();
      this.dest = null;
      return true;
    }
    if (!supportsSinkSelection() || !(this.ctx instanceof AudioContext)) return false;
    try {
      this.dest ??= new MediaStreamAudioDestinationNode(this.ctx);
      const audio = this.audio ?? new Audio();
      audio.srcObject = this.dest.stream;
      await audio.setSinkId(sinkId);
      await audio.play();
      this.audio = audio;
      this.routeDevice();
      return true;
    } catch {
      await this.setDevice(null);
      return false;
    }
  }

  dispose(): void {
    void this.setDevice(null);
    for (const n of this.nodes) n.disconnect();
  }
}
