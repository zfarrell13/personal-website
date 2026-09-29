import { TELEMETRY_EVERY_BLOCKS } from '../../constants';
import { DeckEngineCore } from '../core/DeckEngineCore';
import { TEL_SIZE, type DeckCommand, type DecksPortMessage } from '../core/protocol';
import { PROCESSORS, type ClockMessage, type ClockPortMessage } from './messages';

/** Thin wrapper: both decks + sync in one processor so the PLL sees exact positions. Outputs: [deck 1, deck 2], stereo. */
class DecksProcessor extends AudioWorkletProcessor {
  private readonly core = new DeckEngineCore(sampleRate);
  private block = 0;
  private clockPort: MessagePort | null = null;
  /** Reused: postMessage structured-clones it, so no per-post allocation. */
  private readonly clockMsg: ClockMessage = { t: 'clock', frame: 0, beat: 0, bpm: 0 };

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<DeckCommand | ClockPortMessage>) => {
      const m = e.data;
      if (m.t === 'clockPort') {
        this.clockPort = m.port;
        return;
      }
      this.core.command(m);
      this.flushEvents();
    };
  }

  private flushEvents(): void {
    const events = this.core.drainEvents(); // shared frozen empty array when idle: never mutated here
    for (let i = 0; i < events.length; i++) {
      const msg: DecksPortMessage = { t: 'event', deck: events[i]!.deck, e: events[i]!.e };
      this.port.postMessage(msg);
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const a = outputs[0];
    const b = outputs[1];
    if (!a || !b || a.length < 2 || b.length < 2) return true;
    const frames = a[0]!.length;
    this.core.process(a[0]!, a[1]!, b[0]!, b[1]!, frames);
    if (++this.block >= TELEMETRY_EVERY_BLOCKS) {
      this.block = 0;
      const frame = currentFrame + frames;
      const data = new Float64Array(TEL_SIZE); // one small allocation per ~16 ms, not per block
      this.core.writeTelemetry(data, frame);
      const tel: DecksPortMessage = { t: 'tel', data };
      this.port.postMessage(tel, [data.buffer]);
      this.flushEvents();
      const clock = this.core.masterClock(); // reused object: copy the fields now
      if (clock && this.clockPort) {
        const msg = this.clockMsg;
        msg.frame = frame;
        msg.beat = clock.beat;
        msg.bpm = clock.bpm;
        this.clockPort.postMessage(msg);
      }
    }
    return true;
  }
}

registerProcessor(PROCESSORS.decks, DecksProcessor);
