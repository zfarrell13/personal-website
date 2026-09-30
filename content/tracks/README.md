# Tracks

The site's soundtrack: one shuffled playlist that plays across every page (the NOW PLAYING tag) and under the surf game. Drop the audio files (and optional square artwork) here, then list them in `tracks.json`:

    {
      "tracks": [{
        "id": "sunset-drive",
        "title": "Sunset Drive",
        "artist": "Zach Farrell",
        "file": "sunset-drive.mp3",
        "artwork": "sunset-drive.jpg",
        "surf": true,
        "bpm": 124,
        "key": "8A",
        "firstBeatSec": 0
      }]
    }

| Field | |
|---|---|
| `id` | Unique, kebab-case. Also the folder name under `public/tracks/`. |
| `title`, `artist` | What the NOW PLAYING tag shows (`artist — title`). Keep them in step with `credits.music` in `src/content/site.ts`; a unit test checks that. |
| `file` | The audio file in this folder (anything ffmpeg reads: MP3, WAV, AIFF, FLAC…). It is encoded to AAC (`.m4a`) for the site. |
| `artwork` | Optional square image in this folder, copied into the build. The player doesn't show it at the moment. |
| `surf` | `true` puts the track in the playlist. A track without it is built but never played. |
| `bpm`, `key`, `firstBeatSec` | Legacy fields from the DJ booth that the parser still requires. The site player ignores them, so any valid value works: `bpm` > 0, `key` in Camelot notation (1A–12B), `firstBeatSec` ≥ 0. `memoryCues` (beat numbers) is optional and also unused. |

- `npm run tracks` encodes everything into `public/tracks/` (it also runs automatically before `npm run dev` and `npm run build`). ffmpeg must be installed.
- The audio and artwork are git-ignored (commercial releases); only `tracks.json` and this README are committed.
- **Missing files.** If the list is empty, or any listed `file` is missing (a fresh clone, say), synthesized placeholder tracks are built instead, with a warning.
- **CI and Vercel.** When `CI` or `VERCEL` is set, missing files fail the build instead (`✖ … track file(s) missing …`), because the deploy would ship the placeholders while CREDITS names the real songs. Put the files on the build machine, or set `ALLOW_PLACEHOLDER_TRACKS=1` to build with the placeholders on purpose (for example, a CI job that only runs the tests).
- The placeholder tracks are always built at `/tracks-test` too; `?tracks=test` on any page selects them (the e2e suite does).
