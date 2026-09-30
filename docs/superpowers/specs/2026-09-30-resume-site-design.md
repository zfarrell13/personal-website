# Resume Site — PS2 Game-Menu Design

Date: 2026-09-30 · Status: approved by user in chat
Supersedes: the light/dark "portal" in `2026-09-29-foundation-design.md` and the whole of `2026-09-29-dj-booth-design.md` (the DJ booth is removed). The surf game specs stay in force.

## Why

User: "now i feel like i need to make this more of a resume website now. i only actually want to use the surf game, not the dj one. i do want to keep the songs playing though." They chose the PS2 game-menu approach, with FREE SURF as the default, then RIDER PROFILE, CAREER MODE (the resume), TROPHY ROOM (portfolio projects), CREDITS (contact) — "that all we will have".

## 1. Structure and navigation

| Menu item (in this order) | Route | Content |
|---|---|---|
| FREE SURF (pre-selected) | `/surf` | The surf game's own title (LEFT/RIGHT, GUIDE, DROP IN) and the game |
| RIDER PROFILE | `/profile` | Player card: photo, name, title, location, short bio, what I'm looking for, a few skill stat bars |
| CAREER MODE | `/career` | Resume: "seasons" newest first — role, company, dates, 3–4 wins each; select to expand; DOWNLOAD RESUME (PDF) at the top |
| TROPHY ROOM | `/trophies` | Portfolio: trophy grid — image, name, one-liner, stack, PLAY/VIEW + CODE links; select for a detail card with the longer story; the surf game is the first trophy |
| CREDITS | `/credits` | Email, LinkedIn, GitHub, resume PDF, music credits, styled as rolling game credits |

- Home `/` is the title menu: **ZACH FARRELL** in the title style over the live breaking wave; the menu above, FREE SURF pre-selected (Enter/click drops straight into `/surf`).
- Every section is a real route with real HTML (shareable links, readable without playing, crawlable).
- Navigation like a PS2 menu: ↑↓ move, Enter/Space select, Esc/Backspace back to the menu; menu-move and select sounds; mouse, touch and phone all work. Focus is visible and the order follows the menu. From the game, the existing pause/quit returns to the menu.
- Nothing else: no extra sections, no light/dark toggle.

## 2. Look

- Same retro PS2 language as the surf game (Russo One + VT323, chunky outlines, the retro renderer).
- One persistent 3D stage: the surf scene lives in the root layout and survives route changes. Home and the sections show it in an attract/title camera, dimmed/blurred behind the UI; FREE SURF hands the same scene to the game (no reload between menu and game).
- Honour `prefers-reduced-motion` (freeze the background / hold a still frame). Phones keep the existing mesh/particle reductions; the section pages must stay readable if WebGL is unavailable (plain dark background fallback).
- Readability first: section text sits on solid/opaque panels over the wave; body text ≥ 16 px equivalent on phones.

## 3. Music

- The three tracks (content/tracks) play as one continuous playlist across every page and in the game, never restarting on navigation.
- Starts on the first user gesture (browsers block autoplay); a small **NOW PLAYING** tag with skip and mute on every page; mute choice remembered (localStorage, try/catch).
- One global player owns the audio element and its Web Audio graph. The game no longer owns music; it drives the player's effects instead (the existing muffled-in-the-tube low-pass, and quieter while paused), so those features survive.

## 4. Content

- All site content in one typed file `src/content/site.ts` (under `src/` so it imports as `@/content/site`) (profile, seasons, trophies, links, resume PDF path, photo path), filled with clearly marked sample text ("SAMPLE — replace me") the user replaces later. Photo and PDF slots under `public/` with placeholders.
- Page metadata (title/description/OG) derived from the same file.

## 5. Removed

- The DJ booth: `/dj`, `/dev/dj-engine`, `src/dj/**`, the worklet build step and Signalsmith vendor copy, the booth model copy step, DJ e2e specs, DJ-only credits.
- The light/dark portal and in-game mode switch (`src/portal`, `src/shared/ModeSwitch`, mode storage).
- Kept: the track pipeline (it feeds the playlist) and anything the surf game uses. All removed code stays in git history.

## Verification

- Unit tests: menu navigation model (order, default selection FREE SURF, wrap/clamp, back), content file shape, music player (continuity across route changes, gesture start, skip, mute persistence, game effect hooks).
- e2e: `/` shows the menu with FREE SURF selected and Enter goes to `/surf`; each section route renders its content and Esc returns to `/`; music keeps playing across `/` → `/career` → `/surf` (same track, position advancing); no DJ routes remain (404); surf e2e still green.
- Screenshots desktop 1280×720 and phone landscape/portrait of every screen, read and checked for readability.
- Lighthouse-style sanity on a section page: no console errors, text readable without WebGL.
