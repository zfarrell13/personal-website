# Zach Farrell — Surf by day, DJ by night

Two interactive experiences behind a light/dark switch:

- **Light mode → Surf** (`/surf`): a PS2-era surf game on an endless peeling reef wave.
- **Dark mode → DJ booth** (`/dj`): two fully functional CDJ-style decks and a 2-channel club mixer in a reactive low-poly club.

## Requirements

- Node 22+
- ffmpeg (`brew install ffmpeg`)

## Run it

    npm install
    npm run dev        # http://localhost:3000

The first `npm run dev` synthesizes placeholder tracks if `content/tracks/tracks.json` is empty.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (builds tracks first) |
| `npm run build && npm start` | Production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser smoke tests (Playwright) |
| `npm run typecheck` | TypeScript |
| `npm run tracks` | Rebuild audio + waveform data from `content/tracks` |

## Adding your tracks

See `content/tracks/README.md`.

## DJ booth (`/dj`)

- **TAP TO START** unlocks audio (browser autoplay rules). BROWSE on a deck loads a track; the booth is a CDJ | mixer | CDJ layout modelled on the real hardware (no branding).
- **Tracks:** the decks play whatever is in `content/tracks/tracks.json` (see "Adding your tracks"); BROWSE lists them with artwork, BPM and key. Loading onto a deck that is playing on air needs a second tap.
- **Controls:** each deck has PLAY/PAUSE, CUE, hot cues A–H (saved per track in the browser), memory-cue CALL, loops (IN/OUT, 4/8 BEAT, ½X/2X, RELOOP/EXIT), BEAT JUMP, SLIP, QUANTIZE, REVERSE, tempo (±6/10/16/WIDE) with Master Tempo, SYNC/MASTER and a jog wheel (VINYL scratch or CDJ pitch bend). The mixer has TRIM, 3-band isolator EQ, Colour FX, Beat FX, channel faders with curves, crossfader with assign, CUE buttons and MASTER. Drag knobs vertically and faders along their track; on a phone (landscape) swipe between DECK 1 · MIXER · DECK 2.
- **Tab** or **VIEW** switches between the booth close-up and the club room view. Hold **Shift** for SHIFT (e.g. SHIFT + hot cue clears it) and fine knob control.
- **Headphones:** SETTINGS → choose a second output device (Chrome/Edge support `setSinkId`), or set the mixer's HEADPHONES switch to SPLIT (cue left / master right on the main output).
- **Worklets:** `src/dj/engine/worklets/*.worklet.ts` are bundled to `public/worklets/` by `npm run worklets` (automatic before dev/build). While editing engine code run `npm run worklets:watch` in a second terminal.
- **3D booth model (optional):** see `content/models/README.md`. Without it, procedural gear is used.
- **Engine test page:** `/dev/dj-engine` runs the audio engine end to end without the UI.

## Layout

- `src/app` — routes (portal, `/surf`, `/dj`)
- `src/retro` — shared PS2 renderer and UI primitives
- `src/shared` — mode, input actions, track manifest + waveform codec
- `src/surf`, `src/dj` — the two experiences
- `scripts` — track pipeline
- `docs/superpowers` — design specs and implementation plans

## Credits

See `CREDITS.md` (third-party models, samples and libraries).
