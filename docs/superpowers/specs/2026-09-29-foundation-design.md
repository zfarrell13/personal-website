# Foundation — Portal, PS2 Renderer, Track Pipeline

Date: 2026-09-29 · Status: approved in brainstorming, pending spec review

Part 1 of 3. The two experiences (see `2026-09-29-surf-game-design.md` and
`2026-09-29-dj-booth-design.md`) depend on this. The resume/personal-site
content is explicitly **out of scope** for now.

## Goals

- A fresh app that runs on `localhost` with `npm run dev`.
- A portal with a sun/moon toggle: **light → surf game**, **dark → DJ booth**.
- A shared "PS2 homage" rendering look used by both experiences.
- One track pipeline that feeds both the DJ decks and the surf soundtrack.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript strict | Future resume site needs SEO/SSR; Vercel-native |
| 3D | three.js (vanilla, imperative) | Strict fixed-timestep game loop; React never re-renders per frame |
| UI state | zustand | Simple store readable outside React (engines, rAF loops) |
| Tests | Vitest (logic), Playwright (browser smoke) | Engines are pure TS and testable in Node |
| Package manager | npm | Already in use |
| Platforms | Desktop first-class; mobile "basic" (landscape, touch controls) | User decision |

The old Next 12 site (`src/`, `public/images`, `.next/`, old configs, `node_modules`) is deleted and replaced.

## Structure

```
src/
  app/
    layout.tsx            fonts, global CSS, no site chrome
    page.tsx              portal
    surf/page.tsx         client-only dynamic import of SurfApp
    dj/page.tsx           client-only dynamic import of DjApp
  retro/                  shared PS2 look
    RetroRenderer.ts      low-res render target + upscale/dither pass
    retroMaterial.ts      Gouraud/vertex-snap material patch helper
    shaders/              dither + quantize + trail GLSL
    ui/                   PS2-style React HUD primitives (Panel, Button, Meter, LoadingScreen, RotateDevice)
  shared/
    mode.ts               light/dark mode state + persistence
    tracks.ts             typed track manifest loader
    input/                action-map layer (keyboard + touch → named actions)
  surf/                   see surf spec
  dj/                     see DJ spec
content/tracks/           source masters + tracks.json (author-edited)
public/tracks/            generated (git-ignored): audio + analysis per track
scripts/build-tracks.ts   the pipeline
scripts/make-test-tracks.ts  synthesized placeholder tracks for development
tests/e2e/                Playwright
```

## Portal (`/`)

- Full-screen PS2 "memory card boot" style: dark gradient, floating low-poly
  shapes, a large sun/moon toggle, one "PRESS START" button.
- Mode is `light | dark`. Initial value: `localStorage['zf-mode']`, else
  `prefers-color-scheme`. Toggling animates (sun sets / moon rises) and persists.
- PRESS START (or Enter) navigates to `/surf` (light) or `/dj` (dark).
- Each experience shows a small sun/moon button in a corner; pressing it flips
  the mode and navigates to the other experience. Direct URLs always work.
- Mobile portrait: `RotateDevice` overlay on `/surf` and `/dj`
  (portal itself works in portrait).
- Browsers without WebGL2 or AudioWorklet get a friendly "needs a modern
  desktop browser" panel instead of a crash.

## PS2 renderer (`src/retro`)

- The scene renders into a `WebGLRenderTarget` with height **448px**
  (width = height × viewport aspect), nearest-filtered, then a fullscreen
  pass upscales to the canvas.
- The post pass does: RGB565-style quantization with 4×4 Bayer ordered dither,
  optional "PS2 trail" (blend 25% of the previous frame), slight gamma lift.
- `retroMaterial(material, opts)` patches three.js materials via
  `onBeforeCompile`: vertex-snap to a virtual 448-line grid (strength default
  0.35 — PS2 subtle, not PS1 wobble), and fog.
- Textures: max 256px, `NearestFilter`, no mipmaps unless a texture opts in.
- HUD/overlays are DOM at native resolution on top of the canvas (crisp).
  Fonts (Google Fonts, OFL): **Russo One** (display, italic-skewed via CSS)
  and **VT323** (numeric counters).
- Config object with sensible defaults; each experience can override
  (DJ close-up UI does not go through the low-res pass).

## Input layer (`src/shared/input`)

- Games read **named actions** (`carveLeft`, `stall`, `ollie`, `grabW`, …),
  never raw keys. Keyboard and on-screen touch controls both feed the map.
  Gamepad can be added later without touching game code.
- `ActionState` exposes `isDown(action)`, `pressedThisFrame(action)`,
  `releasedThisFrame(action)`, sampled once per simulation tick.

## Track pipeline

Source: `content/tracks/tracks.json` plus masters (WAV/AIFF) and artwork.

```jsonc
{
  "tracks": [{
    "id": "sunset-drive",            // kebab-case, unique
    "title": "Sunset Drive",
    "artist": "Zach Farrell",
    "file": "sunset-drive.wav",
    "artwork": "sunset-drive.jpg",   // square, ≥ 500px
    "bpm": 124.0,                    // exact, constant tempo
    "key": "8A",                     // Camelot
    "firstBeatSec": 0.052,           // time of the first downbeat
    "memoryCues": [32, 96],          // optional, in beats from firstBeat
    "surf": true                     // include in surf soundtrack
  }]
}
```

`npm run tracks` (`scripts/build-tracks.ts`, uses system `ffmpeg`, already installed) outputs per track to `public/tracks/<id>/`:

- `audio.m4a` — AAC 256 kbps stereo (plays in every target browser).
- `artwork.jpg` — 500×500 and `artwork-128.jpg`.
- `waveform.bin` — CDJ-style 3-band detail data: 150 bins/sec, each bin
  = 3 × uint8 (low < 250 Hz, mid 250 Hz–3 kHz, high > 3 kHz peak amplitude).
- `overview.bin` — same format, 1024 bins for the whole track.
- plus `public/tracks/manifest.json`: the metadata + duration + sample rate.

Beatgrids are derived at runtime from `bpm` + `firstBeatSec` (constant tempo
is a stated assumption for the user's own productions).

`scripts/make-test-tracks.ts` synthesizes 3 placeholder tracks (drum loop +
bass + chord stab at 120, 124, 128 BPM, ~3 min each) so all development and
tests work before real tracks are supplied.

## Testing

- Vitest: mode persistence, action map, manifest parsing, pipeline band-split
  and bin math (on synthesized signals with known content).
- Playwright smoke: `/`, `/surf`, `/dj` load with no console errors and the
  canvas produces non-blank frames; toggle navigates correctly.

## Out of scope

Resume/projects pages, analytics, deployment config (the app will be
Vercel-ready but not deployed as part of this work).
