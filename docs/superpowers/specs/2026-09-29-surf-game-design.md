# Surf Game (Light Mode) — Design

Date: 2026-09-29 · Status: approved in brainstorming, pending spec review
Depends on: `2026-09-29-foundation-design.md`

A PS2-era homage to *Kelly Slater's Pro Surfer* (2002): one perfect reef wave
that never closes out, the player's own avatar, core tricks, run-until-wipeout
scoring. Technical impressiveness comes from the wave simulation and ride feel,
not polygon counts.

## Player-facing summary

1. Title screen (PS2 menu): pick **LEFT** or **RIGHT** (the wave mirrored).
2. "DROP IN" — the surfer is already up and dropping down the face near the pocket.
3. Ride as long as possible. Score tricks and barrels; build combos.
4. Run ends on a wipeout (or losing the wave). Results screen, 3-letter
   initials, local top-10. Enter to go again.

## Controls

| Input | On the face | In the air |
|---|---|---|
| ← / → | Carve (screen-relative: toward/away from the lip) | Spin (yaw) |
| ↑ | Pump (speed impulse; diminishing if spammed) | — |
| ↓ | Stall (tail drag → curl catches you) | — |
| Space | Ollie (pop off the face) | — |
| W / A / S / D (hold) | — | Grabs: Method / Rail / Stalefish / Indy |
| Esc | Pause | Pause |

Mobile (landscape): left-thumb 4-way pad (←→↑↓), right side OLLIE + 4 grab
buttons. All inputs go through the shared action layer.

## Wave engine (`src/surf/wave/`)

### Frame and coordinates
- The wave is **stationary in a wave frame** that translates along the reef
  at peel speed `Vp` (default 7 m/s). 1 unit = 1 m. In the frame: `x` = along
  the wave (+x toward the shoulder, curl at x = 0), `y` = up, `z` = toward shore.
- Because the shape is stationary in the frame but world points pass through it,
  any world point experiences swell → steepening → pitching lip → barrel →
  whitewater. That *is* a peeling wave, and it is endless by construction.
- Floating origin: the world (reef floor, islands, particles) scrolls
  past the frame; nothing ever reaches large coordinates.
- LEFT vs RIGHT = mirror `x` (and the camera side).

### Shape
- `profile(x, t) → Vec3` with `t ∈ [0, 1]` running from the trough in front
  of the wave (t = 0), up the face, over the crest, and out along the lip to
  the lip tip (t = 1).
- A single **hollowness** value `h(x)` blends between two reference
  cross-sections (swell ↔ pitching barrel), each defined as a Catmull-Rom
  curve through ~8 control points in `(z, y)`:
  - `x < −D` (D = tube depth, 5 m): broken — face replaced by a whitewater
    mound (foam material), height decaying further behind.
  - `−D ≤ x ≤ 0`: the tube — full barrel; the lip reaches over and lands in
    the trough at `x − D`.
  - `0 < x < Ls` (shoulder length 45 m): `h` smoothsteps 1 → 0 over
    `wave.hollowLength` ≈ 12 m, not the whole shoulder, so the open face
    beyond the curl stays visible on the pocket line (implementation note).
    `shoulderLength` still drives the zone, the height taper and the drive.
  - `x ≥ Ls`: unbroken swell, height tapering to 40% at 90 m.
- Wave height `H` default 2.4 m (overhead). All shape constants live in
  `surf/config.ts`.
- `profile` is **one TypeScript function**. The render mesh and the physics
  both use it — what you see is what you ride.
- Helpers built on it: `surfacePoint(x, t)`, `tangents(x, t)` (∂/∂x, ∂/∂t via
  central differences), `normal(x, t)`, `closestParam(p, guess)` (Newton
  iteration from the previous tick's params, ≤ 4 iterations), `crestT(x)`,
  `steepness(x, t)`.

### Mesh and effects
- CPU grid 160 (x, spanning −30 m…+90 m, denser near the curl) × 64 (t);
  phones (coarse pointer) use 112 × 44 (implementation note). Rebuilt only when shape parameters change; per-frame vertex work limited
  to small ripple displacement + UV scrolling (foam flows with `Vp`).
- Vertex colors: deep teal trough → translucent-looking green face (fake
  subsurface via a view-angle term) → white crest/foam.
- Particles (instanced points, pooled): lip spray along the pitching lip,
  whitewater churn behind the curl, board spray from carves (rate ∝ speed ×
  turn rate), the tube "spit" burst when exiting the barrel.
- Environment: gradient sky dome, low sun + lens flare sprite, reef floor
  visible through water in front (vertex-colored), 2–3 island silhouettes,
  palms, a pier, gulls. Distance fog.

## Surfer physics (`src/surf/physics/`)

- Fixed timestep **120 Hz**; render interpolates between the last two states.
- State (wave frame): position `p`, velocity `v`, heading (board yaw on the
  surface), surface params `(x, t)`, mode `riding | airborne | wipeout`.
- **Riding:** each tick, forces act in the surface tangent plane, then `p` is
  re-projected onto the surface via `closestParam`:
  - Gravity projected onto the tangent plane.
  - **Face lift**: an up-the-face acceleration ∝ steepness × depth below
    the crest (the water climbing the face). Riding straight settles mid-face
    rather than sliding to the trough.
  - **Wave drive**: acceleration along +x ∝ local steepness. It is strongest in
    the pocket and weakest on the shoulder, so riding out to the shoulder slows
    you and pulls you back toward the pocket. This is the core gameplay loop.
  - Drag ∝ v² (plus the stall term).
  - Carving rotates `v` within the tangent plane at a rate that falls with
    speed (turn radius ∝ speed); holding a carve bleeds slight speed.
  - Pump: impulse along heading, efficiency
    `min(1, timeSinceLastPump / 0.6 s)`.
  - Stall: extra drag coefficient ×4 and the board visually tilts tail-down.
    The frame-relative x-velocity goes negative, so the curl catches you.
- **Crest:** reaching the end of the rideable face (`t ≥ crestT − ε` or
  `normal.y < 0.2`) with up-face speed `u` > 3 m/s launches you (airborne)
  with `vUp = clamp(u · airGain, 3, maxAirSpeed)`. Otherwise position clamps
  below the crest, and a heading reversal within 0.4 s at the crest scores a
  **Snap**. The snap is also armed at the apex of a climb above
  `physics.snapTopFrac` (0.85) of crest height (implementation note).
- **Ollie** (Space while riding): +4 m/s along the surface normal → airborne.
- **Airborne:** uses a wave-anchored air model (implementation note):
  position = an anchor point on the face that follows `x`, plus a height along
  a tilted axis `normalize(lerp(anchorUpNormal, worldUp, 0.5))`. It lands
  exactly on the face and airs never kick the rider out over the back.
  ←→ yaw at 540°/s (screen-relative, like carving). Grabs are held poses.
  Landing is tested each tick against the surface.
- **Landing** is clean when all of these hold:
  - board yaw is within 40° of the velocity direction, or of its reverse (a
    reverse landing auto-performs a Revert, which scores)
  - no grab has been held in the last 0.1 s
  - the landing point is on the face (`x > −D`), not in the whitewater
  - Otherwise the result is a wipeout.
- **Tube:** `inTube` when `−D ≤ x ≤ 1` and `t` is below 60% of the crest height.
  Being at `x < −D` means the surfer was swallowed, which is a wipeout.
- **Floater:** at `x < 0` near the crest of the collapsing section, you ride
  over the top and score per second. Dropping back onto the face lands it.
  Floater mount and dismount are silent anchored transitions (no launched or
  landed events; implementation note).
- **Lost the wave:** `x > 70` with frame-relative speed below the minimum for
  2 s ends the run as "Kicked out" (not a wipeout).
- All tunables live in `surf/config.ts`. A debug panel (`?debug`) exposes them
  live, alongside a wave-frame gizmo.

## Scoring (`src/surf/scoring/`)

| Trick | Base |
|---|---|
| Ollie | 100 |
| Snap (lip reversal) | 250 |
| Floater | 400 + 100/s |
| Barrel | 500/s (shown live as a tube timer) |
| Air spin 180 / 360 / 540 / 720 | 300 / 700 / 1200 / 1800 |
| Grab (Method, Rail, Stalefish, Indy) | 200 + 150 per 0.5 s held |
| Revert | 150 |

- **Combo:** every trick adds to the combo pot. The multiplier equals the
  number of distinct tricks in the combo.
  - The combo stays alive while another trick (or a carve over 60°) happens
    within 1.5 s.
  - When that window expires, the pot × multiplier is banked. A wipeout
    loses the unbanked pot.
- The same trick repeated within a combo scores half.
- **HUD:** score, combo pot × multiplier, trick-name ticker, tube timer, speed.

## Camera (`src/surf/camera/`)

- Default chase: positioned toward the shoulder side, slightly above and
  in front, looking back at the surfer with the curl behind (the classic
  KSPS framing). Critically damped springs on position and look target.
- Tube: drops low and tight. The camera sits ahead of the rider, looking back
  through the barrel mouth (implementation note; replaces "looks out toward
  the exit").
- Air: pulls back and up by ~40%.
- Wipeout: a brief underwater cut (a blue filter with bubbles), then fades
  to the results screen.

## Surfer character (`src/surf/character/`)

- Base: a CC0 low-poly rigged humanoid (Quaternius). It is recolored to the
  user's hair, skin and outfit, and credited in the credits file.
- The board is a procedural low-poly mesh whose graphic is a `CanvasTexture`
  (user-provided art or a text/logo design).
- Animation is a **procedural pose layer**. Each state (stance, carve lean
  L/R, crouch/tube, pump, stall, ollie pop, 4 grabs, spin tuck, landing
  absorb, wipeout tumble) defines bone rotation targets.
  Bones blend toward the targets with critically damped springs, and the
  lean amount scales with turn rate and speed. No baked animation clips
  are required.

## Audio (`src/surf/audio/`)

- **Music:** tracks from the shared manifest with `surf: true`, shuffled.
  A PS2-style "NOW PLAYING" toast appears on each track change.
- **Ocean ambience:** procedural (filtered noise with slow swells), so there
  are no assets to license.
- **Board spray:** a noise source whose band-pass frequency and gain follow
  speed and carve intensity.
- **Tube:** as tube depth increases, the music and spray crossfade through a
  low-pass (to 800 Hz) plus a short convolution reverb. Exiting ramps back
  with a spit whoosh.
- **Crowd hoots / trick stingers:** synthesized at runtime, no samples
  (implementation note). They play on big combos and barrels over 2 s.
- The master bus has a compressor.

## Architecture

```
SurfApp (React) ── mounts ──► SurfGame (TS class, owns loop)
  HUD components ◄── zustand store (score, combo, mode) ◄── SurfGame writes
SurfGame
  ├─ ActionState (shared input)
  ├─ Wave (shape + mesh + particles)
  ├─ Surfer (physics state machine) → uses Wave queries
  ├─ Scoring (consumes Surfer events: launched, landed, snap, tubeEnter…)
  ├─ Character (pose layer, reads Surfer state)
  ├─ CameraRig
  ├─ SurfAudio
  └─ RetroRenderer (shared)
```

- Physics emits typed **events**. Scoring, audio, particles and the camera
  subscribe to them, so nothing reaches into another module's state.
- React re-renders only the HUD, and at ≤ 15 Hz (throttled store writes).

## Performance targets

- 60 fps on an M1 MacBook Air at 448p internal resolution.
- ≥ 30 fps on a recent mid-range phone.
- Draw calls < 80, triangles < 150k.

## Testing

- **Vitest, wave:**
  - `profile` is continuous in `x` and `t`.
  - The crest is the max-y point for `x ≥ 0`.
  - `closestParam` round-trips `surfacePoint` to within 1 mm.
  - The mirror produces symmetric results.
- **Vitest, physics** (headless, scripted inputs):
  - A surfer riding straight stays on the surface and settles mid-face.
  - Stalling makes frame x-velocity negative, and `inTube` becomes true
    within 3 s.
  - Holding stall longer produces a "swallowed" wipeout.
  - Pump spam yields less speed than rhythmic pumping.
  - Launch at the crest produces `airborne`.
  - A 360 with aligned landing is clean; a 90° landing is a wipeout.
- **Vitest, scoring:** combo window, multiplier, repeat penalty, pot loss on
  wipeout.
- **Playwright:**
  - `/surf` boots, the menu is selectable, and the run starts.
  - Simulated keys produce a changing score and no console errors.

## Out of scope

Heats, careers, multiple breaks, gamepad (the action layer makes it easy
later), online leaderboards, and a paddle-in/takeoff sequence.

## Inputs needed from the user

The user's hair, skin and outfit colors (or a photo), board graphic ideas,
and which tracks have `surf: true`.
