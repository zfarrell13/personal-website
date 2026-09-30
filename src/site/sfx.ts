import { getMusicPlayer } from './music/MusicPlayer';

/**
 * Menu blips, synthesised on the music player's AudioContext. Before the music has started (no context yet)
 * or while it is muted they are silent: no second context, and nothing plays before the first gesture.
 */
function blip(notes: readonly (readonly [hz: number, at: number])[], dur: number, gain: number): void {
  const player = getMusicPlayer();
  const ctx = player.context;
  if (!ctx || ctx.state !== 'running' || player.getState().muted) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'square';
  for (const [hz, at] of notes) osc.frequency.setValueAtTime(hz, t0 + at);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
  osc.onended = () => amp.disconnect();
}

/** Cursor moved: a short high tick. */
export function menuMove(): void {
  blip([[880, 0]], 0.06, 0.05);
}

/** Item chosen: a rising two-note chirp. */
export function menuSelect(): void {
  blip(
    [
      [660, 0],
      [1320, 0.06],
    ],
    0.18,
    0.06,
  );
}
