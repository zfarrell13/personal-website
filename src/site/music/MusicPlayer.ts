import { browserStorage } from '@/shared/storage';
import { loadManifest, type TrackEntry } from '@/shared/tracks';
import { Playlist } from './Playlist';

export interface MusicState {
  track: { id: string; title: string; artist: string } | null;
  playing: boolean;
  muted: boolean;
  /** Increments each time a new track starts (drives the NOW PLAYING pop). */
  trackKey: number;
  /** The manifest failed to load or has no tracks: there is nothing to play. */
  unavailable: boolean;
}

export const MUTE_STORAGE_KEY = 'zf-music-muted';

export interface MusicDeps {
  createAudio: () => HTMLAudioElement;
  createContext: () => AudioContext;
  loadTracks: () => Promise<readonly TrackEntry[]>;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  random: () => number;
}

export const INITIAL_MUSIC_STATE: MusicState = { track: null, playing: false, muted: false, trackKey: 0, unavailable: false };

const MUSIC_LEVEL = 0.8;
const OPEN_HZ = 20000;
const TAU = 0.08; // smoothing time constant for muffle / duck / mute (s)

const defaultDeps = (): MusicDeps => ({
  createAudio: () => new Audio(),
  createContext: () => new AudioContext(),
  loadTracks: async () => (await loadManifest()).tracks,
  storage: browserStorage(),
  random: Math.random,
});

/**
 * The site-wide soundtrack. One instance (see getMusicPlayer) outlives every route, so the playlist
 * never restarts on navigation. Graph:
 *   <audio> ► MediaElementSource ► lowpass (tube muffle) ► gain (0.8 × duck × unmuted) ► destination
 */
export class MusicPlayer {
  private readonly deps: MusicDeps;
  private state: MusicState;
  private readonly listeners = new Set<(s: MusicState) => void>();
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private playlist: Playlist | null = null;
  private current: TrackEntry | null = null;
  private tracksLoading: Promise<readonly TrackEntry[]> | null = null;
  /** Set once the manifest has resolved, so a gesture can start playback synchronously. */
  private tracks: readonly TrackEntry[] | null = null;
  private started: Promise<void> | null = null;
  private disposed = false;
  private failures = 0;
  private muffleHz = OPEN_HZ;
  private duck = 1;

  constructor(deps: Partial<MusicDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
    this.state = { ...INITIAL_MUSIC_STATE, muted: this.readMuted() };
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Fetch the manifest ahead of the first gesture (idempotent; call on mount). With the tracks already in hand,
   * start() calls play() synchronously inside the gesture, which WebKit requires to unlock the element.
   */
  prefetch(): Promise<void> {
    this.tracksLoading ??= this.deps.loadTracks().then(
      (tracks) => this.tracksLoaded(tracks),
      (e: unknown) => {
        console.warn('Music manifest failed to load', e);
        return this.tracksLoaded([]);
      },
    );
    return this.tracksLoading.then(() => undefined);
  }

  private tracksLoaded(tracks: readonly TrackEntry[]): readonly TrackEntry[] {
    this.tracks = tracks;
    if (!tracks.some((t) => t.surf)) this.setState({ unavailable: true });
    return tracks;
  }

  /** Idempotent; call from a user gesture. Later calls resume the context and retry a blocked play(). */
  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.started) {
      this.resume();
      return this.started;
    }
    // Everything the browser gates on a user gesture happens synchronously, inside it.
    setPlaybackAudioSession();
    const ctx = this.deps.createContext();
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.muffleHz;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.targetGain();
    const audio = this.deps.createAudio();
    audio.preload = 'none';
    this.audio = audio;
    ctx.createMediaElementSource(audio).connect(this.filter).connect(this.gain).connect(ctx.destination);
    audio.addEventListener('playing', this.onPlaying);
    audio.addEventListener('pause', this.onPause);
    audio.addEventListener('ended', this.onEnded);
    audio.addEventListener('error', this.onError);
    void ctx.resume().catch(() => undefined);
    if (this.tracks) {
      this.beginPlaylist(this.tracks);
      this.started = Promise.resolve();
    } else {
      // The gesture beat the manifest: start when it arrives (a strict browser may then need another gesture).
      this.started = this.prefetch().then(() => {
        if (this.tracks) this.beginPlaylist(this.tracks);
      });
    }
    return this.started;
  }

  private beginPlaylist(tracks: readonly TrackEntry[]): void {
    if (this.disposed || this.playlist) return;
    this.playlist = new Playlist(tracks, this.deps.random);
    if (!this.state.muted) this.nextTrack();
  }

  /**
   * Cheap re-arm after an interruption (backgrounding, a phone call): resumes a suspended context and a paused
   * element. A no-op before start() and while muted. Safe to call on every pointerdown / visibilitychange.
   */
  resume(): void {
    if (this.disposed || !this.started || this.state.muted) return;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (this.current && this.audio?.paused) this.play();
  }

  skip(): void {
    this.nextTrack();
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    try {
      this.deps.storage?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // storage blocked or full: the choice just isn't remembered
    }
    this.setState({ muted, playing: muted ? false : this.state.playing });
    this.applyGain();
    if (muted) {
      this.audio?.pause(); // paused, not just silent: no bandwidth while muted
      return;
    }
    if (!this.started) {
      void this.start();
      return;
    }
    void this.ctx?.resume().catch(() => undefined);
    // Started muted: the playlist begins now, synchronously inside this click once the manifest has arrived.
    if (!this.current) this.nextTrack();
    else this.play();
  }

  /** Low-pass cutoff for game effects (tube muffle). 20000 = open. Smoothed. */
  setMuffleHz(hz: number): void {
    this.muffleHz = Math.min(OPEN_HZ, Math.max(20, Number.isFinite(hz) ? hz : OPEN_HZ));
    if (this.ctx && this.filter) this.filter.frequency.setTargetAtTime(this.muffleHz, this.ctx.currentTime, TAU);
  }

  /** 0..1 volume multiplier for game effects (pause duck). Smoothed. */
  setDuck(level: number): void {
    this.duck = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    this.applyGain();
  }

  getState(): MusicState {
    return this.state;
  }

  subscribe(listener: (s: MusicState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const audio = this.audio;
    if (audio) {
      audio.removeEventListener('playing', this.onPlaying);
      audio.removeEventListener('pause', this.onPause);
      audio.removeEventListener('ended', this.onEnded);
      audio.removeEventListener('error', this.onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    void this.ctx?.close().catch(() => undefined);
    this.setState({ playing: false });
    this.listeners.clear();
    const g = globalThis as MusicGlobal;
    if (g.__zfMusic === this) delete g.__zfMusic;
  }

  private readonly onPlaying = (): void => {
    this.failures = 0;
    this.setState({ playing: true });
  };

  private readonly onPause = (): void => {
    this.setState({ playing: false });
  };

  private readonly onEnded = (): void => {
    this.nextTrack();
  };

  // A missing or undecodable file skips to the next track: at most one full cycle of failures in a row.
  private readonly onError = (): void => {
    if (this.disposed) return;
    this.setState({ playing: false });
    const total = this.playlist?.tracks.length ?? 0;
    this.failures++;
    if (this.failures < total) this.nextTrack();
    else if (this.failures === total) console.warn('No music track could be played.');
  };

  private nextTrack(): void {
    const t = this.playlist?.next();
    if (!t || !this.audio || this.disposed) return;
    this.current = t;
    this.audio.src = t.audioUrl;
    this.setState({ track: { id: t.id, title: t.title, artist: t.artist }, trackKey: this.state.trackKey + 1 });
    if (!this.state.muted) this.play();
  }

  private play(): void {
    this.audio?.play().catch((e: unknown) => {
      // AbortError: a pause, skip or dispose interrupted a pending play(), which is expected. NotSupportedError: an
      // undecodable source, already handled (skipped) by the `error` listener.
      const name = (e as { name?: unknown } | null)?.name;
      if (name !== 'AbortError' && name !== 'NotSupportedError') console.warn('Music playback blocked', e);
    });
  }

  private targetGain(): number {
    return MUSIC_LEVEL * this.duck * (this.state.muted ? 0 : 1);
  }

  private applyGain(): void {
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, TAU);
  }

  private readMuted(): boolean {
    try {
      return this.deps.storage?.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setState(patch: Partial<MusicState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof MusicState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    for (const l of [...this.listeners]) l(next);
  }
}

/** iOS 16.4+: play as media (ignores the ringer switch) rather than as an ambient sound effect. */
function setPlaybackAudioSession(): void {
  try {
    const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession;
    if (session) session.type = 'playback';
  } catch {
    // unsupported
  }
}

type MusicGlobal = typeof globalThis & { __zfMusic?: MusicPlayer };

/**
 * The browser-wide player, cached on globalThis so StrictMode double-mounts and route changes share it.
 * `globalThis.__zfMusic` is also the one debug / e2e handle (every build). In dev, an HMR edit of this file keeps
 * the instance created by the old class until a full reload.
 */
export function getMusicPlayer(): MusicPlayer {
  const g = globalThis as MusicGlobal;
  return (g.__zfMusic ??= new MusicPlayer());
}
