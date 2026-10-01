# Zach Farrell — resume site

A personal resume site styled as a PS2 game menu. A live breaking wave, which is also a playable surf game, runs behind every page. The soundtrack plays continuously across the whole site.

| Menu item | Route | What it is |
|---|---|---|
| FREE SURF (pre-selected) | `/surf` | The surf game (choose LEFT/RIGHT, GUIDE, then DROP IN) |
| RIDER PROFILE | `/profile` | Player card: photo, name, title, bio, what I'm looking for, skill bars |
| CAREER MODE | `/career` | The resume: seasons newest first, each expandable; DOWNLOAD RESUME (PDF) |
| TROPHY ROOM | `/trophies` | Portfolio: project cards, each opening a detail card with PLAY/VIEW and CODE links |
| CREDITS | `/credits` | Contact, links, resume PDF and music credits, as rolling game credits |

`/` is the title menu. Use ↑↓ to move, Enter or Space to select, and Esc or Backspace to go back to the menu. Mouse and touch work too. Every section is a real route with real HTML, so the pages can be shared, crawled and read without WebGL.

## Requirements

- Node 22+
- ffmpeg (`brew install ffmpeg`), used by the track pipeline before `dev` and `build`

## Run it

    npm install
    npm run dev        # http://localhost:3000

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (builds tracks first) |
| `npm run build && npm start` | Production build (builds tracks first) and server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript |
| `npm run test:e2e` | Browser tests (Playwright). They start a dev server on port 3100 or reuse one already running. `PW_PORT=3000 npm run test:e2e` runs them against your running dev server. |
| `npm run tracks` | Rebuild the audio and waveform data from `content/tracks` |

## Editing the content

All of the site's text lives in one typed file, **`src/content/site.ts`** (types in `src/content/types.ts`):

- `profile`: name, title, location, tagline, bio paragraphs, `lookingFor`, `photo`, and `stats` (skill bars, 0–10).
- `career.resumePdf` and `career.seasons`: role, company, `start`/`end` (`YYYY-MM`, or `'Present'`), location, `wins` (3–4 each) and `stack`. Seasons can go in any order; the page sorts them newest first.
- `trophies`: `id`, name, one-liner, image, stack, `links` (labelled `PLAY` / `VIEW` / `CODE`) and the longer `story` shown on the detail card. The surf game is the first trophy.
- `credits`: `email`, `links` (LinkedIn, GitHub, …) and `music` (the soundtrack credits) shown on CREDITS.

Placeholder text starts with `SAMPLE`. Replace it, and the files under `public/site/` (photo, resume PDF, trophy images), with your own. `src/content/site.test.ts` checks the file's shape. The page titles, descriptions and the link-preview card (`src/app/opengraph-image.tsx`) are all built from the same file.

## Adding tracks

The soundtrack is the tracks in `content/tracks/tracks.json` that have `"surf": true`. They play as one shuffled playlist that never restarts on navigation. See `content/tracks/README.md` for the format.

- The audio masters and artwork are git-ignored (commercial releases). Only `tracks.json` is committed.
- `npm run dev` and `npm run build` encode them into `public/tracks/` first. If any listed file is missing, as in a fresh clone, the synthesized placeholder tracks are used instead, with a warning. In CI or on Vercel a missing file fails the build instead (see Deploying).
- The music starts on the first click, tap or key press, because browsers block autoplay. The NOW PLAYING tag on every page shows the track and has SKIP and MUTE buttons. The mute choice is remembered.
- `?tracks=test` on any page selects the synthetic test tracks (the e2e suite uses them).

## Deploying

- **`NEXT_PUBLIC_SITE_URL`** (optional) sets the site's public origin (for example `https://zachfarrell.com`) as the `metadataBase`, so link previews get absolute `og:image` / `twitter:image` URLs on your own domain. Set it **at build time**: the pages are prerendered, so setting it only at runtime has no effect. Without it, Next falls back on its own: on Vercel, the project's production URL (or the preview URL on a preview deployment); in `npm run dev`, `http://localhost:3000`. A self-hosted build without it gets `localhost` URLs (and a build warning), so set it there.
- The share card (`/opengraph-image`) is prerendered at build time from `assets/fonts/RussoOne-Regular.ttf`.
- **The track files must be on the build machine.** The audio is git-ignored, so a build from a git checkout doesn't have it. When `CI` or `VERCEL` is set (Vercel sets both), `npm run build` stops with `✖ … track file(s) missing …` rather than ship the placeholder tracks under the real songs' credits. Either:
  - build where the files are, and upload the result: `vercel build --prod && vercel deploy --prebuilt --prod`, from a checkout with the files in `content/tracks/`; or
  - set `ALLOW_PLACEHOLDER_TRACKS=1` to build with the placeholders on purpose (a preview, or a CI job that only runs the tests; `npm run dev` runs the same check, so a CI e2e job needs it too).
- The encoded tracks are served as static files under `/tracks/`, so anyone can download them.

## Layout

- `src/app`: routes (`/`, `/surf`, the four sections, the share card, `/dev/retro`)
- `src/site`: the site shell (persistent surf stage, title menu, section chrome, menu sounds) and `src/site/music` (the global player and the NOW PLAYING tag)
- `src/content`: the content file
- `src/surf`: the surf game
- `src/retro`: the PS2 renderer and shared UI primitives
- `src/shared`: input actions, storage, track manifest and waveform codec
- `scripts`: the track pipeline
- `docs/superpowers`: design specs and implementation plans

## Surf game (`/surf`)

| Input | On the face | In the air |
|---|---|---|
| ← / → | Carve (screen-relative). Held, the board keeps turning: up, round past straight up and back toward the curl; let go and the turn stops on the spot — with no key held nothing turns the board (carve your own bottom turns). Held at the lip = snap. Cut back toward the curl, then carve up into the lip or the whitewater (keep holding, or let go and press again) = ROUNDHOUSE: it bounces you back down the line. **Let go at the lip to launch** (not just after letting go of a cutback) | Spin |
| ↑ | Pump (works the face, not the flats; rhythm beats mashing) | — |
| ↓ | Stall (the curl catches you; let go early to pump out of the barrel) | — |
| Space | Hold to crouch (you keep riding and carving), release to ollie — hold longer to pop higher (full height after ½ s; a tap is a small hop) | — |
| W / A / S / D (hold) | — | Method / Rail / Stalefish / Indy |
| G (title) | Toggle the GUIDE coach | — |
| Esc | Pause (on the title: back to the menu) | Pause |

- **Phones (landscape):** a four-way pad on the left; on the right, the grabs (METHOD, RAIL, STALE, INDY) in two columns with OLLIE under the thumb in the corner (hold it to crouch, let go to pop, like Space). Pause is at the top centre. Held portrait, the game asks you to rotate.
- **RIGHT / LEFT** follow the surf convention: a RIGHT peels to your right as you face the beach.
- **The break chases you.** Sit still and the curl swallows you in about 5 s. Carve down the line and pump on the face to stay ahead. Every 10–20 s a ⚡ FAST SECTION speeds the peel up by 30–50% and a **peak** starts to form 15–25 m down the line: a hump of wave rising taller and steeper, spray feathering off its top.
- **Race the peak.** You have 3.5–4.5 s (the coach calls ▲ PUMP! if you are falling behind). Then it pitches and the whole stretch back to the curl breaks at once. On or past the peak: the new barrel is right behind you and you score SECTION MADE (500) — stall into it or keep racing. Short of it: **CLOSED OUT**.
- **Air off the peak** instead: its steeper, taller face pops you higher (crest air or ollie), and a clean landing scores a SECTION AIR bonus (750) on top of the trick.
- **Barrels:** stall as the curl arrives to get tubed. Pump to get out before it closes.
- **GUIDE ON** (the default; remembered) shows a ▲ PUMP! coach prompt when you need speed.
- **Camera:** it rides behind you on the curl side, cuts into the barrel when you are tubed, pulls back in the air, and cuts underwater on a wipeout.
- **Music:** the site soundtrack keeps playing. It is muffled inside the tube and ducked while paused.
- `/surf?debug`: live tuning sliders for `src/surf/config.ts`, fps / draw calls / triangles, and a wave-frame gizmo.
- **Your avatar:** edit `SURFER_LOOK` in `src/surf/config.ts` (hair, skin, outfit colours, board text, or `boardImage` for your own deck art, 256 px or smaller).
- High scores are stored locally (`localStorage['zf-surf-highscores']`).

## Credits

See `CREDITS.md`.
