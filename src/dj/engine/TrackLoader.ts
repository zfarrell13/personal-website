import type { TrackEntry } from '@/shared/tracks';
import { decodeWaveform, type WaveformData } from '@/shared/waveform';
import { TRACK_CACHE_SIZE } from '../constants';

/** Tiny LRU map: get() refreshes recency; set() evicts the least recently used entry beyond `max`. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(readonly max: number) {}
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  /** Reads without refreshing recency. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
  delete(key: K): void {
    this.map.delete(key);
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  get size(): number {
    return this.map.size;
  }
  keys(): K[] {
    return [...this.map.keys()];
  }
}

export interface TrackWaveforms {
  detail: WaveformData;
  overview: WaveformData;
}

type Decoder = Pick<BaseAudioContext, 'decodeAudioData'>;

/**
 * Fetches + decodes tracks (LRU of 4 decoded AudioBuffers so reloading is instant)
 * and fetches the waveform files in parallel so they show before decoding finishes.
 */
export class TrackLoader {
  private readonly buffers = new LruCache<string, Promise<AudioBuffer>>(TRACK_CACHE_SIZE);
  private readonly waves = new Map<string, Promise<TrackWaveforms>>();

  constructor(
    private readonly decoder: Decoder,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  waveforms(t: TrackEntry): Promise<TrackWaveforms> {
    let p = this.waves.get(t.id);
    if (!p) {
      const get = async (url: string) => {
        const res = await this.fetchFn(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return decodeWaveform(await res.arrayBuffer());
      };
      const mine = Promise.all([get(t.waveformUrl), get(t.overviewUrl)]).then(([detail, overview]) => ({ detail, overview }));
      mine.catch(() => {
        if (this.waves.get(t.id) === mine) this.waves.delete(t.id);
      });
      this.waves.set(t.id, mine);
      p = mine;
    }
    return p;
  }

  decode(t: TrackEntry): Promise<AudioBuffer> {
    let p = this.buffers.get(t.id);
    if (!p) {
      const mine = (async () => {
        const res = await this.fetchFn(t.audioUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${t.audioUrl}`);
        return this.decoder.decodeAudioData(await res.arrayBuffer());
      })();
      mine.catch(() => {
        if (this.buffers.peek(t.id) === mine) this.buffers.delete(t.id);
      });
      this.buffers.set(t.id, mine);
      p = mine;
    }
    return p;
  }

  cachedIds(): string[] {
    return this.buffers.keys();
  }
}

export interface DeckPcm {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

/**
 * Copies an AudioBuffer's channels into fresh arrays for the deck worklet (mono → both sides).
 * Copies, so transferring them never detaches the cached AudioBuffer.
 */
export function pcmForDeck(buffer: AudioBuffer): DeckPcm {
  const left = new Float32Array(buffer.getChannelData(0));
  const right = buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : new Float32Array(left);
  return { left, right };
}

/** Transfer list for a PCM load: each underlying buffer exactly once (a duplicate throws DataCloneError). */
export function pcmTransferList(pcm: { left: Float32Array; right: Float32Array }): ArrayBufferLike[] {
  return pcm.left.buffer === pcm.right.buffer ? [pcm.left.buffer] : [pcm.left.buffer, pcm.right.buffer];
}
