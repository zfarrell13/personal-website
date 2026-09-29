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

## Layout

- `src/app` — routes (portal, `/surf`, `/dj`)
- `src/retro` — shared PS2 renderer and UI primitives
- `src/shared` — mode, input actions, track manifest + waveform codec
- `src/surf`, `src/dj` — the two experiences
- `scripts` — track pipeline
- `docs/superpowers` — design specs and implementation plans

## Credits

See `CREDITS.md` (third-party models, samples and libraries).
