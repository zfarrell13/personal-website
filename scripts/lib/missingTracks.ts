/** What the track build does about the real tracks' audio: build it, fall back to the placeholders, or stop. */
export type MissingTracksPolicy = { action: 'real' } | { action: 'placeholder'; message: string } | { action: 'fail'; message: string };

/**
 * The real audio is git-ignored, so a fresh clone (or a CI / Vercel build from git) has tracks.json but not the
 * files. Locally the placeholder tracks stand in, with a warning. In CI or on Vercel that would deploy the
 * placeholders while CREDITS names the real songs, so it fails instead, unless ALLOW_PLACEHOLDER_TRACKS=1.
 */
export function missingTracksPolicy(missing: readonly string[], env: Readonly<Record<string, string | undefined>>): MissingTracksPolicy {
  if (missing.length === 0) return { action: 'real' };
  const what = `${missing.length} track file(s) missing from content/tracks (${missing.join(', ')})`;
  const deploy = Boolean(env.CI) || Boolean(env.VERCEL);
  if (deploy && env.ALLOW_PLACEHOLDER_TRACKS !== '1') {
    return {
      action: 'fail',
      message:
        `${what}. This is a CI / Vercel build (CI or VERCEL is set), so it stops rather than ship the placeholder tracks. ` +
        'Put the audio files in content/tracks/ on the build machine, or set ALLOW_PLACEHOLDER_TRACKS=1 to build with the placeholders.',
    };
  }
  return { action: 'placeholder', message: `${what} — using the placeholder test tracks.` };
}
