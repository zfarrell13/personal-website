# Resume Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the site into a PS2-game-menu resume: home menu (FREE SURF pre-selected, RIDER PROFILE, CAREER MODE, TROPHY ROOM, CREDITS) over the live surf wave, with the three tracks playing continuously across every page and the game; the DJ booth and light/dark portal are removed.

**Architecture:** One persistent client "stage" in the root layout hosts the existing surf app; on `/surf` it runs the game, elsewhere it shows the title scene dimmed behind the page (attract mode). One global `MusicPlayer` singleton owns the audio element and a small Web Audio graph; the surf game drives its muffle/duck instead of owning music. Menu and sections are ordinary App Router routes rendering HTML panels from one typed content file.

**Tech Stack:** Next.js 16.3 App Router (read `node_modules/next/dist/docs/` before touching Next APIs — AGENTS.md), React 19, TypeScript strict, three.js, zustand, Vitest (+jsdom, @testing-library/react), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-resume-site-design.md`

## Global Constraints

- Menu order, exactly: FREE SURF (pre-selected), RIDER PROFILE, CAREER MODE, TROPHY ROOM, CREDITS. Routes: `/surf`, `/profile`, `/career`, `/trophies`, `/credits`. Nothing else ("that all we will have").
- Navigation: ↑↓ move, Enter/Space select, Esc/Backspace back to `/`; mouse, touch and phone work; visible focus.
- Music: the three tracks (content/tracks, `surf: true`) play as one continuous playlist across every page and in the game, never restarting on navigation; starts on the first user gesture; NOW PLAYING tag with skip and mute on every page; mute persisted (localStorage, try/catch).
- The surf game keeps its muffled-in-the-tube music effect and is quieter while paused.
- Same retro PS2 look (Russo One + VT323, `src/retro`). Section text on opaque panels, readable on phones (portrait and landscape), readable without WebGL; honour `prefers-reduced-motion`.
- All site content in `src/content/site.ts`, sample text marked "SAMPLE — replace me".
- The dev server on port 3000 is always running: never stop/restart it; e2e with `PW_PORT=3000` and a private `--output` directory.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; commit explicit paths only.

---

### Task 1: Remove the DJ booth and the light/dark portal

**Files:**
- Delete: `src/dj/**`, `src/app/dj/**`, `src/app/dev/dj-engine/**`, `src/portal/**`, `src/shared/ModeSwitch.tsx`, `src/shared/modeSwitch.module.css`, `src/shared/ModeIcons.tsx`, `src/shared/useMode.ts`, `scripts/build-worklets.ts`, `scripts/build-worklets.test.ts`, `scripts/copy-models.ts`, `scripts/copy-models.test.ts`, `content/models/**`, `tests/e2e/dj.spec.ts`, `tests/e2e/dj-engine.spec.ts`
- Modify: `src/shared/mode.ts` → reduce to `browserStorage()` only (rename file to `src/shared/storage.ts`; update imports in `src/surf/ui/TitleMenu.tsx`, `src/surf/ui/Results.tsx`, `src/surf/SurfApp.tsx`; delete `src/shared/mode.test.ts` and add `src/shared/storage.test.ts`)
- Modify: `src/surf/SurfApp.tsx` (drop `<ModeSwitch>`), `package.json` (scripts: `predev`/`prebuild` → `tsx scripts/ensure-tracks.ts` only; `typecheck` → `tsc --noEmit`; remove `worklets*`, `models`; dependency `signalsmith-stretch` removed), `tsconfig.json` (drop the worklets exclude), `.gitignore` (drop `public/worklets/`, `public/models/`, `public/vendor/`), `CREDITS.md` (drop the DJ booth section), `src/app/layout.tsx` (description → "Surf, career and projects — a PS2-style portfolio."), `src/app/page.tsx` (temporary: `redirect('/surf')` from `next/navigation` until Task 5), `tests/e2e/foundation.spec.ts` (drop the portal and mode-switch tests)
- Keep: `scripts/ensure-tracks.ts` and the track pipeline (feeds the playlist), `public/tracks-test` + `?tracks=test` (surf e2e may use it), `src/app/dev/retro`.

**Interfaces:**
- Produces: `browserStorage(): Storage | null` from `@/shared/storage` (same behaviour as today's `@/shared/mode` export).

- [ ] **Step 1: Write the failing test** — `src/shared/storage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage } from './storage';

describe('browserStorage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns null without a window', () => {
    expect(browserStorage()).toBeNull();
  });
  it('returns null when the localStorage getter throws', () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('blocked'); } }));
    expect(browserStorage()).toBeNull();
  });
  it('returns window.localStorage when available', () => {
    const ls = { getItem: () => null } as unknown as Storage;
    vi.stubGlobal('window', { localStorage: ls });
    expect(browserStorage()).toBe(ls);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/shared/storage.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Create `src/shared/storage.ts` with the `browserStorage` function copied verbatim from `src/shared/mode.ts`; update the three surf imports; then perform the deletions/modifications listed above. `grep -rn "src/dj\|@/dj\|portal\|ModeSwitch\|useMode\|shared/mode\|worklet\|signalsmith\|copy-models" src scripts tests package.json tsconfig.json` must return nothing (except historical docs).
- [ ] **Step 4:** `npm install` (lockfile drops signalsmith), `npm run typecheck`, `npx vitest run`, `PW_PORT=3000 npx playwright test tests/e2e/surf.spec.ts tests/e2e/foundation.spec.ts --output=<private>` → all green. `curl -s -o /dev/null -w '%{http_code}' localhost:3000/dj` → 404; `/` → redirects to `/surf`.
- [ ] **Step 5: Commit** — `git commit -m "chore: remove the DJ booth and the light/dark portal"` (explicit paths; use `git rm` for deletions).

---

### Task 2: Global music player

**Files:**
- Create: `src/site/music/Playlist.ts` (move from `src/surf/audio/Playlist.ts`, unchanged API; update imports; move its tests if any), `src/site/music/MusicPlayer.ts`, `src/site/music/MusicPlayer.test.ts`, `src/site/music/useMusic.ts`, `src/site/music/NowPlaying.tsx`, `src/site/music/NowPlaying.test.tsx`, `src/site/music/music.module.css`, `src/site/SiteShell.tsx` (client component wrapping `children` in the root layout; mounts `<NowPlaying/>` and the first-gesture listener)
- Modify: `src/app/layout.tsx` (body renders `<SiteShell>{children}</SiteShell>`)

**Interfaces:**
- Consumes: `loadManifest()` / `TrackEntry` from `@/shared/tracks`; `browserStorage()` from `@/shared/storage`.
- Produces (exact):

```ts
export interface MusicState {
  track: { id: string; title: string; artist: string } | null;
  playing: boolean;
  muted: boolean;
  /** Increments each time a new track starts (drives the NOW PLAYING pop). */
  trackKey: number;
}
export const MUTE_STORAGE_KEY = 'zf-music-muted';
export class MusicPlayer {
  constructor(deps?: Partial<MusicDeps>);
  /** Idempotent; call from a user gesture. Loads the manifest once, resumes the context, starts the playlist (unless muted). */
  start(): Promise<void>;
  skip(): void;
  setMuted(muted: boolean): void;
  /** Low-pass cutoff for game effects (tube muffle). 20000 = open. Smoothed. */
  setMuffleHz(hz: number): void;
  /** 0..1 volume multiplier for game effects (pause duck). Smoothed. */
  setDuck(level: number): void;
  getState(): MusicState;
  subscribe(listener: (s: MusicState) => void): () => void;
  dispose(): void;
}
export function getMusicPlayer(): MusicPlayer; // lazily created browser singleton
export interface MusicDeps {
  createAudio: () => HTMLAudioElement;
  createContext: () => AudioContext;
  loadTracks: () => Promise<readonly TrackEntry[]>;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  random: () => number;
}
```

Graph: `audio element → MediaElementSource → BiquadFilter(lowpass, 20000) → Gain(0.8 × duck × (muted ? 0 : 1)) → destination`. Behaviour to port from `SurfAudio` (music half): `ended` → next track; `error` → skip, at most one full cycle of failures in a row; `play()` AbortError ignored. Muted: element paused (no bandwidth), state `muted: true`; unmuting resumes (starting the playlist if never started).

- [ ] **Step 1: Write the failing tests** — `src/site/music/MusicPlayer.test.ts` with fakes (a `FakeAudio` class implementing `src`, `play()` (resolves, sets `paused=false`, fires `playing`), `pause()`, `addEventListener`, and a helper to fire `ended`/`error`; a `FakeContext` returning stub nodes with `connect()` returning the target and `frequency/gain` objects with `value` and `setTargetAtTime`). Cases:
  1. `start()` twice creates one audio element and one context; first track plays; state has `playing: true`, `track` set, `trackKey` 1.
  2. `ended` advances to a different track (`trackKey` 2); 3 tracks all play once per cycle (Playlist).
  3. `skip()` advances.
  4. `setMuted(true)` pauses, persists `'1'` under `MUTE_STORAGE_KEY`; a new player with that storage starts muted (no `play()` call) and `setMuted(false)` starts playback.
  5. Storage `getItem`/`setItem` throwing does not throw out of the player.
  6. `error` on every track stops after one cycle (no infinite loop).
  7. `setMuffleHz(800)` targets the filter frequency; `setDuck(0.3)` targets the gain to `0.8 × 0.3`.
  8. `subscribe` receives state changes and its returned function unsubscribes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `MusicPlayer` per the interface; `getMusicPlayer()` caches on `globalThis.__zfMusic` so React StrictMode double-mounts and route changes never create a second player. `useMusic()` = `useSyncExternalStore(p.subscribe, p.getState, () => INITIAL)`.
- [ ] **Step 4: NOW PLAYING tag** — `NowPlaying.tsx`: fixed bottom-right retro tag "NOW PLAYING · artist — title" with a SKIP (▶▶) button and a MUTE toggle (🔇/🔊 as text glyphs, `aria-pressed`); before the first gesture it shows "♪ PRESS ANY KEY FOR MUSIC" (clickable → `start()`); pops on `trackKey` change. `SiteShell` registers one-shot `pointerdown`/`keydown` listeners on `window` that call `getMusicPlayer().start()`. Test (`NowPlaying.test.tsx`, jsdom): renders the prompt before start, the track after a state change, SKIP calls `skip`, MUTE toggles `setMuted` and `aria-pressed`.
- [ ] **Step 5:** `npx vitest run src/site` green; `npm run typecheck`.
- [ ] **Step 6: Commit** — `feat(site): global music player with NOW PLAYING, skip and mute`.

---

### Task 3: The surf game uses the global player

**Files:**
- Modify: `src/surf/audio/SurfAudio.ts` (remove all music: element, playlist, `onTrack`, `musicGain`, `unannounced`, `musicFailures`; `start()` no longer takes tracks), `src/surf/audio/SurfAudio.test.ts`, `src/surf/game/SurfGame.ts` (no manifest load for music; in the frame update call `getMusicPlayer().setMuffleHz(<the same cutoff it sets on tubeLP>)`; on `pause()` → `setDuck(0.35)`, `resume()`/`start()` → `setDuck(1)`; `quitToTitle()`/dispose → `setMuffleHz(20000)`, `setDuck(1)`; DROP IN also calls `getMusicPlayer().start()` since it is a gesture), `src/surf/SurfApp.tsx` + `src/surf/ui/Overlays.tsx` (delete the game's `NowPlayingToast` and the `nowPlaying` store field — the site tag replaces it), `src/surf/state/store.ts`.
- Test: `src/surf/game/SurfGame.test.ts` (music hooks), `tests/e2e/surf.spec.ts` (anything that relied on the game toast).

**Interfaces:**
- Consumes: `getMusicPlayer()`, `MusicPlayer.setMuffleHz/setDuck/start` (Task 2). For tests, SurfGame takes an optional `music?: Pick<MusicPlayer, 'setMuffleHz' | 'setDuck' | 'start'>` in its options (default `getMusicPlayer()`), so tests inject a spy.

- [ ] **Step 1: Failing tests** — SurfGame with an injected music spy: entering the tube drives `setMuffleHz` below 20000 and leaving returns toward 20000; `pause()` → `setDuck(0.35)`; `resume()` → `setDuck(1)`; `quitToTitle()` → `setMuffleHz(20000)` and `setDuck(1)`. SurfAudio test: no `Audio` element is ever created.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/surf src/site`, typecheck, surf e2e green. Manual check via Playwright: DROP IN, the site NOW PLAYING tag shows a track; Esc pause → the tag stays, audio ducks (read `getMusicPlayer().getState()` via a debug hook `window.__music` exposed in dev only).
- [ ] **Step 5: Commit** — `feat(surf): game music comes from the site player (tube muffle, pause duck)`.

---

### Task 4: Persistent stage (the wave behind every page)

**Files:**
- Create: `src/site/Stage.tsx` (client; rendered once by `SiteShell`, fixed full-screen layer behind page content), `src/site/stageMode.ts` + `src/site/stageMode.test.ts`
- Modify: `src/surf/SurfApp.tsx` (prop `mode: 'play' | 'attract'`), `src/surf/game/SurfGame.ts` (method `setAttract(on: boolean)`: when on, quit any run to the title phase, ignore input, keep rendering the title camera), `src/app/surf/page.tsx` + `src/app/surf/SurfLoader.tsx` (the route renders only `<RotateDevice/>` and the WebGL-unsupported message; the canvas lives in the Stage), `src/site/SiteShell.tsx`, `src/surf/ui/surf.module.css` (attract dim: canvas `filter: brightness(0.55) saturate(0.9)` + a subtle vignette; no blur on phones)

**Interfaces:**
- `stageModeFor(pathname: string): 'play' | 'attract'` → `'play'` for `/surf` (and `/surf/…`), else `'attract'`.
- `SurfApp({ mode })`: in `'attract'` renders no TitleMenu/Hud/PauseMenu/Results/TouchControls/DebugPanel, canvas has `aria-hidden` and `pointer-events: none`; in `'play'` behaves exactly as today. The game is created once and never disposed on route changes.
- `prefers-reduced-motion`: Stage passes `reducedMotion` → `SurfGame.setFrozen(true)` renders one frame and stops the loop in attract mode (play mode unaffected).
- No WebGL2 (`src/retro/support.ts`): Stage renders nothing; `/surf` shows the existing SupportGate message.

- [ ] **Step 1: Failing tests** — `stageMode.test.ts` (`/`→attract, `/career`→attract, `/surf`→play, `/surf?x`→play); SurfApp jsdom test with a mocked SurfGame: attract hides TitleMenu and HUD; switching to play shows TitleMenu; the game constructor runs once across a mode change; `setAttract(true)` called on attract.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** e2e (new `tests/e2e/site.spec.ts`): load `/`, wait for `window.__surf.frames > 10`; navigate client-side to `/surf` (click FREE SURF once Task 5 exists — for now `page.goto('/surf')` checks the title menu), assert `window.__surf` frame counter keeps increasing without resetting across a client-side navigation between two attract pages (use a temporary link or `router.push` via `window.next?.router` — if unavailable, defer this assertion to Task 7). Surf e2e green.
- [ ] **Step 5: Commit** — `feat(site): persistent surf stage behind every page (attract mode)`.

---

### Task 5: The title menu (home)

**Files:**
- Create: `src/site/menu.ts`, `src/site/menu.test.ts`, `src/site/TitleScreen.tsx`, `src/site/TitleScreen.test.tsx`, `src/site/site.module.css`, `src/site/sfx.ts` (tiny Web Audio blips: `menuMove()`, `menuSelect()`; use `getMusicPlayer()`'s context if started, else no-op), `src/site/useBackToMenu.ts`
- Modify: `src/app/page.tsx` (renders `<TitleScreen/>`; remove the Task 1 redirect)

**Interfaces:**

```ts
export interface MenuItem { id: 'surf' | 'profile' | 'career' | 'trophies' | 'credits'; label: string; href: string }
export const MENU: readonly MenuItem[] = [
  { id: 'surf', label: 'FREE SURF', href: '/surf' },
  { id: 'profile', label: 'RIDER PROFILE', href: '/profile' },
  { id: 'career', label: 'CAREER MODE', href: '/career' },
  { id: 'trophies', label: 'TROPHY ROOM', href: '/trophies' },
  { id: 'credits', label: 'CREDITS', href: '/credits' },
];
export const DEFAULT_INDEX = 0;
export function moveIndex(i: number, delta: -1 | 1, n = MENU.length): number; // wraps
```

- `useBackToMenu()`: on Esc/Backspace (not while focus is in an input) → `router.push('/')`.
- TitleScreen: "ZACH FARRELL" title (existing title style), subtitle from content (`site.profile.tagline`), menu buttons as `<Link>`s rendered in MENU order; selection state starts at FREE SURF (`data-selected`, focused on mount); ↑↓ move with `menuMove()`; Enter/Space activate with `menuSelect()`; hover/tap selects; "↑↓ SELECT · ENTER START" hint. Readable panel, phone portrait + landscape.
- `/surf`: Esc on the game's title (not during a run — the game's own pause handles that) goes back to `/`; add a "◀ MENU" button to the game's TitleMenu.

- [ ] **Step 1: Failing tests** — `menu.test.ts`: order and labels exactly as above; `DEFAULT_INDEX` is FREE SURF; `moveIndex` wraps both ways. `TitleScreen.test.tsx` (jsdom, mocked router): FREE SURF is selected and focused initially; ArrowDown selects RIDER PROFILE; Enter pushes its href; ArrowUp from FREE SURF wraps to CREDITS.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** e2e in `tests/e2e/site.spec.ts`: `/` shows five items in order with FREE SURF selected; Enter → `/surf` and the game title menu shows; "◀ MENU" returns to `/`. Screenshots 1280×720, 844×390, 390×844 read and described.
- [ ] **Step 5: Commit** — `feat(site): PS2 title menu home (FREE SURF first)`.

---

### Task 6: Content and the four section screens

**Files:**
- Create: `src/content/types.ts`, `src/content/site.ts`, `src/content/site.test.ts`, `src/site/SectionScreen.tsx` (shared chrome: section title bar, opaque panel, "◀ MENU" + Esc via `useBackToMenu`), `src/app/profile/page.tsx`, `src/app/career/page.tsx`, `src/app/trophies/page.tsx`, `src/app/credits/page.tsx`, `src/site/sections/{Profile,Career,Trophies,Credits}.tsx` (+ one jsdom test file `sections.test.tsx`), `public/site/photo-placeholder.svg`, `public/site/resume-sample.pdf` (a one-page placeholder PDF saying "SAMPLE RESUME — replace me"), `public/site/trophies/*.svg` placeholders (retro gradient + label)

**Interfaces:**

```ts
export interface SiteContent {
  profile: { name: string; title: string; location: string; tagline: string; bio: string[]; lookingFor: string; photo: string; stats: { label: string; value: number /* 0..10 */ }[] };
  career: { resumePdf: string; seasons: { role: string; company: string; start: string; end: string | 'Present'; location?: string; wins: string[]; stack?: string[] }[] };
  trophies: { id: string; name: string; oneLiner: string; image: string; stack: string[]; links: { label: 'PLAY' | 'VIEW' | 'CODE'; href: string }[]; story: string[] }[];
  credits: { email: string; links: { label: string; href: string }[]; music: { title: string; artist: string }[] };
}
export const site: SiteContent; // SAMPLE data, every string that is placeholder starts with "SAMPLE"
```

- The first trophy is the surf game itself (real content: name "Kelly-style Surf Game", links PLAY → `/surf`, CODE → the repo URL `https://github.com/zfarrell13/personal-website`), the rest SAMPLE. `credits.music` lists the three real tracks (from content/tracks/tracks.json titles/artists). `profile.name` = "Zach Farrell", `credits.email` SAMPLE.
- Root layout `metadata` (title, description, Open Graph) derived from `site.profile` (name, title, tagline). Each page exports `metadata` (title `"<Section> — Zach Farrell"`), is a server component rendering `<SectionScreen title=…>` + the section component (client only where interaction is needed: Career expand/collapse, Trophy detail).
- CAREER MODE: seasons newest first (sort by `start` desc), each a button row (role · company · dates) expanding to wins + stack; DOWNLOAD RESUME (PDF) at the top.
- TROPHY ROOM: responsive grid of trophy cards; selecting opens a detail panel (dialog semantics, Esc closes the dialog first, then the next Esc goes to the menu).
- RIDER PROFILE: player card (photo, name, title, location, tagline, bio paragraphs, looking-for), stat bars (0–10 as retro meters; reuse `src/retro/ui/Meter.tsx`).
- CREDITS: rolling-credits styled list (static under reduced motion): email (mailto), links, resume PDF, "SOUNDTRACK" with the three tracks, "BUILT WITH" line.
- Keyboard: ↑↓ move between focusable items within a section (roving focus on the list), Enter activates, Esc back.

- [ ] **Step 1: Failing tests** — `site.test.ts`: content shape (non-empty, stats 0..10, every trophy has ≥1 link, first trophy links PLAY → `/surf`, seasons sort newest first via an exported `seasonsNewestFirst()`), every placeholder string starts with "SAMPLE" except the allowed real fields. `sections.test.tsx`: each section renders its heading and content; Career expands a season on Enter; Trophies opens and Esc closes the detail.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** e2e: each route renders (heading visible, text readable), "◀ MENU"/Esc returns to `/`; with WebGL disabled (`--disable-webgl` context or `page.addInitScript` stubbing `getContext` → null) sections still render readable text. Screenshots of all four at 1280×720, 844×390, 390×844, read and described.
- [ ] **Step 5: Commit** — `feat(site): rider profile, career mode, trophy room and credits`.

---

### Task 7: Integration

**Files:**
- Modify/Create: `tests/e2e/site.spec.ts` (full flows), `README.md` (what the site is, how to edit `src/content/site.ts`, how to add tracks, dev/test commands), `CREDITS.md`, `docs/superpowers/specs/2026-09-30-resume-site-design.md` (implementation notes)

- [ ] **Step 1: e2e flows** —
  1. `/` → ArrowDown ×2 → Enter → `/career`; Esc → `/`; FREE SURF → `/surf` → DROP IN → playing → Esc pause → quit → "◀ MENU" → `/`.
  2. Music continuity (launch arg `--autoplay-policy=no-user-gesture-required` is already set): click on `/` to start music; record `window.__music.getState().track.id` and the audio element `currentTime`; navigate `/` → `/career` → `/surf` client-side; the same track id and a strictly larger `currentTime`; one audio element in the document/player.
  3. `/dj` and `/dev/dj-engine` return 404.
  4. No console errors on any route.
- [ ] **Step 2:** Full suite: `npx vitest run`, `npm run typecheck`, `PW_PORT=3000 npx playwright test --output=<private>` all green; `npm run build` succeeds (use a separate `distDir` via env if the dev server locks `.next`, or run the build in a git worktree copy).
- [ ] **Step 3:** Screenshot tour (desktop, phone landscape, phone portrait) of `/`, each section, `/surf` title and a riding frame; read them; fix anything unreadable.
- [ ] **Step 4:** README + CREDITS + spec implementation notes. **Commit** — `docs: resume site README and credits`.
