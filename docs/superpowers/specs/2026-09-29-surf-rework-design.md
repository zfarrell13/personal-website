# Surf Game Rework — Design Addendum

Date: 2026-09-29 · Status: approved by user (playtest feedback)
Amends: `2026-09-29-surf-game-design.md` (this document wins where they differ)

## Why

First playtest: "the right is a left, the left is a right, and there is little
to no maneuverability. The wave must be actively crashing, and the surfer must
pump to stay in front of the break. The perspective should be from behind the
surfer, not in front."

User choices: camera **behind, from the curl side**; difficulty **racy sections**;
carving **weighty / realistic**.

## 1. Side naming

- **RIGHT** = the wave peels to the surfer's right as they face the beach
  (standard surf convention). Facing shore (+z) with +y up, the surfer's right
  is −x in the current frame, so the current `'right'` is actually a left.
- Fix the mapping so the title's RIGHT/LEFT, the HUD, and the travel direction
  agree with the convention. A unit test asserts: on a RIGHT, the rider's travel
  direction dotted with the surfer's right-hand vector (forward = toward shore,
  up = +y) is > 0.

## 2. The break chases you

- Base peel speed `Vp` is tuned so that **with no input the curl catches the
  rider in ~4–5 s** (swallowed or forced into the tube), while **rhythmic pumping
  (≈1 pump/s) plus down-the-line carving holds or gains ground**.
- The mid-face "sticky" behaviour is removed (see §4); speed comes from gravity
  on drops, pumping, and good lines — not from a constant wave drive that parks
  the rider.
- Stalling still lets the curl catch you on purpose → barrel; pumping out of the
  barrel must be possible when started early enough.
- **Racy sections:** every 10–20 s (random, seeded per run) a section of the
  wave breaks faster for 3–5 s: `Vp` ramps up by 30–50% over ~0.5 s, holds, and
  ramps back. In the wave frame this is felt as the rider losing ground
  (frame acceleration). HUD shows "⚡ FAST SECTION" with a louder rumble. Surviving
  one scores a bonus ("SECTION MADE", 500).

## 3. Actively crashing visuals + audio

- The lip visibly throws and falls: an animated falling-lip spray curtain along
  the pitching section, continuous whitewater explosions and churn where the lip
  lands (x ∈ [−D, 0] and behind), feathering spray along the shoulder crest.
- The wave mesh's lip region animates (throw oscillation / turbulence) so the
  shape never reads as frozen; foam scrolls with the break.
- A low crashing rumble, volume/filter by distance to the impact zone; subtle
  camera shake near the impact.
- All driven by sim time (pause freezes it).

## 4. Weighty, realistic carving

- Rider can use the whole face (trough → lip). Remove the lift/damping that pins
  the rider at t ≈ 0.35–0.41.
- Turn radius grows with speed (rail carve), momentum carries through turns
  (carving redirects velocity rather than destroying it; small rail drag).
- Dropping converts height to speed; climbing converts speed to height.
- Bottom turn → top turn lines generate speed along the wave together with pumps.
- Crest launches, snaps (incl. apex-armed), floaters, tube, grabs/spins and
  landing rules keep their existing semantics, with these lip rules:
  - A climb into the top band (y ≥ `snapTopFrac` 0.7 × crest height) sets up a
    snap; the window to turn it is `snapWindow` 0.6 s, and a snap needs a
    ≥ 110° heading change while carving. One lip turn is one snap.
  - **Carving at the lip** (← or →, with a snap set up) is a lip turn, not a
    launch: the rider is held at the lip while the carve, `snapCarveBoost` 2×
    faster there, turns the board back down (carve-back toward the trough, or
    carve-through over the top). The board turns with the rail and never flips
    in one frame.
  - **Letting go of ← → at the lip launches** (arriving with up-face speed
    > `launchSpeed`), as does an ollie. Too slow, the lip sheds the rider back
    down (over a few ticks). (Playtest 4: not within 0.5 s of letting go of a
    cutback, still running back toward the curl — see the launch guard below.)
- ~~A held carve toward the lip / trough steers the board toward straight up /
  down the face and settles there (no fishtail); from near straight up or down
  it turns through down the line (toward the shoulder).~~ Superseded by the
  playtest 4 amendment below.
- **Playtest 4 amendment: roundhouse** (user: "the turn stops, and almost forces
  the surfer to go back straight… I should be able to do a roundhouse carve all
  of the way back towards the lip, and carve off the lip as well").
  - A held carve keeps turning the same way for as long as it is held: up the
    face, round past straight up, back toward the curl and on round. Its
    rotation sense is latched when the key goes down (the key's toward-the-lip /
    toward-the-trough meaning at that moment); there is no settling straight
    up / down and no swing toward the shoulder. Let go and the yaw rate eases to
    0 (`carveLag`): the board holds its line. Rate, lag and `carveBleed` are
    unchanged. A held turn that reaches the trough carries on round the way it
    is turning (the bottom turn follows it, never fights it into the flats).
  - **Letting go always stops the turn** (playtest 4 bug: "if i hold the arrow
    for too long, the roundhouse is held, even if i take my finger off"). With
    no carve key down nothing turns the board: a rebound in progress ends at
    once (no ROUNDHOUSE for a bounce let go of; the cutback is remembered for a
    re-press), any extra bite (snap at the lip, rebound) is dropped at once, and
    the plain carve rate left eases out over `carveLag` exactly as any release
    (below 0.1 rad/s within ≈ 4 × `carveLag`, ≤ ≈ 30° more of carve yaw). The
    only turning without a key is the physical bottom-out turn at the trough
    (bounded, Verification 10), the lip shedding a too-slow board, and the air
    spin settle.
  - Cutback: the carve yaw since the board last ran down the line is tracked
    across releases (cut back, let go, run at the curl, press again). It is
    forgotten once the board runs down the line again (after running back, or
    with no turn held its way), or after `cutbackMemory` (1.5 s) running back
    toward the curl without a rebound.
  - Rebound: running back toward the curl with a carve held, the board is
    bounced round, back down the line, at `reboundBoost` (2) × the carve rate
    (≤ 15° per tick), when it
    - reaches the whitewater (frame x ≤ `foamReboundX` 3, not inside the barrel
      and not deeper than −D/2; a foam rebound carried past −D/2 is lost to the
      curl, with no roundhouse), or
    - turns up into the lip: a toward-the-lip turn in the top band
      (y ≥ `snapTopFrac` × crest) or at the crest, or — for a key pressed while
      running back with a cutback of ≥ 90° under way — anywhere on the face
      (the second half of the figure-8).

    **Which way it turns:** off the lip, always up and over (the way a
    toward-the-lip turn runs when heading back). In the foam, the shorter way:
    a line still climbing goes up and over; one already dropping carries on
    down and round (a strict up-into-the-foam bounce from a dropping line takes
    ≈ 270° and swallowed the rider in probes). The foam bleeds
    `roundhouseRebound` (0.05) of the speed per 180°, but as it runs with the
    break it pushes a slower board up toward `foamCarry` (1) × the peel speed
    at `foamPush` (15 m/s²). A rebound ends with the line running down the
    line, dropping 30° below flat, and the wave throws the board on with
    `reboundKick` (2 m/s). **Ruling:** a roundhouse never exits faster than the
    cutback went in — the push and the kick restore speed toward the cutback's
    entry speed, never beyond it (it costs a little speed). Carving at the lip never launches. A rebound spends
    the held key: held on, the board holds its new line until the key is let go.
  - **Launch guard (user ruling):** for `cutbackLaunchGuard` (0.5 s) after
    letting go of a cutback (≥ 90° under way), while still running back toward
    the curl, letting go at the lip does **not** launch — there is time to
    press again and carve off it. Everywhere else, letting go at the lip still
    launches.
  - ROUNDHOUSE: a cutback of ≥ `roundhouseDeg` (150°) that ends in a rebound,
    as one held carve or as two presses, at any distance from the curl, emits
    `roundhouse` (with degrees) and scores 500. **It replaces the snap (user
    ruling):** a snap that turns the board back toward the curl waits, at most
    `snapDeferMax` (0.35 s); a ROUNDHOUSE in that time drops it. Otherwise it
    scores (ticker and spray burst) when the cutback ends or the wait runs out,
    whichever is first, and a ROUNDHOUSE later out of the same cutback takes
    it back from the unbanked pot (`replacesSnap`). A wipeout first shows a
    waiting snap, then loses it with the pot. The HUD ticker shows
    "Roundhouse"; the spray bursts as for a snap. A plain cutback (or a short
    turn into the foam) rebounds without it.
  - Camera: the chase swings round behind the new line as on any cutback; the
    keys keep their meaning while held (the existing latch). Two guards keep the
    rider seen through a reversal: the chase tilts its look target (never its
    position) to keep the drawn rider — leaning into the turn as Character.ts
    banks the body, `clamp(turnRate · |v| · 0.04, ±0.6)` — with the chest within
    0.7, the board within 0.8 and the head within 0.8 of the half-screen from
    the centre (clear of the HUD). It is not only for reversals: in ordinary
    riding (lineBot S-turns) it also nudges the view in about 3–6% of chase
    frames, by at most 5–7°, when the leaned head on a hard carve nears its
    limit (accepted). And in the pocket (x ≤ `pocketX`) the view
    cuts straight to the tube / pocket view when the chase's line of sight to
    the rider is blocked by the pitching lip. In the pocket, board spray (and
    the snap / roundhouse burst) is kept down as in the tube, so spray thrown
    just before that cut doesn't sit at the lens over the rider.

## 5. Camera: behind, from the curl side

- Chase camera sits **behind the rider on the curl side and high** (above the
  local crest height + margin so it never clips the lip or whitewater), looking
  **past the rider down the line** toward the shoulder; the crashing curl is
  below/near the camera, the face rises beside the rider.
- In the tube: the camera drops in **behind** the rider inside the barrel,
  looking out toward the exit (supersedes the Task 17 "ahead, looking back"
  ruling).
- Air: pulls back/up; wipeout: underwater cut (unchanged).
- Camera springs are weighty but responsive; no clipping into water/lip in any
  state (tested via ray/visibility probes).

## Verification

Headless (Vitest, real Surfer + WaveShape + CameraRig):
1. No input → swallowed/caught within ~5 s (and not in < 2 s).
2. Scripted rhythmic pumping + down-the-line carving keeps the rider ahead of
   the curl for ≥ 30 s at base peel.
3. During a fast section, the same effort loses ground; stronger effort survives.
4. From speed, a full bottom → top traverse of the face is achievable in ≤ 1.5 s;
   turn radius increases with speed.
5. Camera: behind the rider on the curl side (frame x < rider x, looking toward
   +x on a travel-+x wave), above the local crest height, never inside water;
   rider visible (raycast) ≥ 90% of chase frames.
6. Side naming test (§1).
Browser: screenshots (riding, fast section, tube, air) inspected; e2e suite green.

Pumping targets (playtest 2, Task 2b — headless, `lineBot` + scripted inputs, frame x = ground on the curl):
7. A human-like rhythm — pumps at irregular 0.8–1.2 s gaps (seeded, 8 seeds) while carving a moderate
   line (slope 0.2 and 0.3) — gains ≥ 10 m on the curl in 20 s (median); started further down the line
   (x = 25) it loses no ground over 20 s. Pumping every 0.5–0.7 s on a slope-0.3 line gains ≥ 10 m in 20 s;
   every 0.6 s on a straight-ish line (slope 0.15) at least holds for 30 s. (Replaces the old
   "pumping alone, no carving, dies in < 7 s" test.)
8. No input is swallowed in 4–6 s (tuned ≈ 5.0 s); the same lines without pumps still lose the wave
   within 10 s.
9. Pump feel: a full-efficiency pump mid-face at riding speed (8–12 m/s) adds +1.5–3 m/s of world speed;
   spamming faster than ~0.35 s has diminishing returns (speed per second at 0.2 s < 80%, at 0.1 s < 50%
   of a 0.6 s rhythm); a pump low on the face or in the flats is weaker than mid-face but never nothing
   (`pumpFlatGain`: half strength on the flats, full from steepness 0.35); pumps do nothing in the air.
10. Slamming the trough is a bottom turn, not a dead stop: the line swings toward along the wave (the
    way it already runs; from straight down, toward the shoulder) at `bottomTurnRate`, bleeding
    `bottomTurnLoss` per 90°; at 6 and 10 m/s the rider keeps ≥ 70% of its speed through the turn and
    the heading never changes > 15° in one tick. Once on the flats (t = 0) the board bogs down
    (`flatsDragMultiplier` × drag).
11. Camera cutback probes use genuine turns back toward the curl (a lip snap carve-back, or a carve
    past the fall line into a bottom turn), never a one-tick heading snap; far-out reversals must
    leave settled-line samples.
12. Roundhouse (playtest 4): a held carve from down the line at 8 and 12 m/s turns on past 180° without
    settling; released, the yaw rate dies within a few `carveLag`. At 8–12 m/s, a roundhouse — one held
    carve near the pocket, or two presses (cut back, let go, press into the lip) from x = 20–30 — emits
    one `roundhouse` (no snap, or one taken back), comes out down the line with ≤ 15° per tick, no faster
    than it went in, ends shallower than −D/2, and 0.5 s later (back on its line down the face) runs at
    ≥ 60% of the entry speed. A short turn into the foam rebounds without one. During a roundhouse the
    leaning rider is framed in every chase frame (chest |ndc y| ≤ 0.7, board ≤ 0.8) and seen in ≥ 90%
    of them.

## Playtest 2 amendments (user feedback)

- **Camera:** close bird's-eye view from behind the rider — about 3–4 m behind along the direction of travel, 4–6 m above (always above the crest), looking down at the rider and a few metres ahead down the line; the rider is large in frame. Tube: behind the rider looking out.
- **Pumping:** a player pumping on a sensible line must be able to beat the section down the line; pumping is the primary speed tool. (Supersedes "pump-only dies" tuning.) No input is still caught in ~4–5 s. Pumping on the flats is weaker but no longer does nothing (supersedes design point "pumping only works on the face"); verified by Verification 7–9.
- **Background:** the horizon must be seamless — sea runs into haze and sky with no visible seam or band; sky gradient and fog match; distant water reads as water.


## Playtest 3 amendments (user feedback)

- **One continuous ocean:** the breaking wave must read as part of the same water body — no visible seam, height step, colour/shading jump, or gap between the wave mesh and the surrounding sea (in front, behind, and along the shoulder). Same water shading, foam and fog on both.
- **Realistic barrel:** from inside the tube the barrel is an open, roughly oval tunnel: the lip throws out and down into the trough behind the rider, while ahead the exit ("the eye") is clearly open — sky/shoulder visible through it. No sheet or curtain of water covering the exit. The tube camera shot must show the eye.
- **Horizon:** a clean, believable horizon — the sea meets a hazy sky with a soft gradient; no hard band, seam, stepped fog, or visible plane edge at any camera angle used in play.

## Implementation notes (plan `2026-09-29-surf-rework.md` and the playtest rounds after it)

These notes record how the addendum and the three rounds of playtest amendments were read. The live values are in `src/surf/config.ts`.

- **Sides.** The canonical frame (the rider travels +x, the shore is +z) is a LEFT. A RIGHT is the mirrored frame (`sideSign('right') = −1`), so a RIGHT peels to the surfer's right as they face the beach. High scores saved before the fix keep their old (inverted) side label.
- **The break chases.** Vp is 8 m/s. The sticky face is gone (no lift or face damping). With no input the rider is swallowed in about 5 s: the e2e test asserts more than 2 s, and the unit tests assert the window. Rail grip is 85% from 5 m/s. Carving, pumping and drag act on the board's world velocity. The carve yaw rate is `carveRate / (1 + speed / carveHalfSpeed)`, eased with a 0.12 s lag, so the turn radius grows with speed. Slamming the trough is a bottom turn (`bottomTurnRate`, `bottomTurnLoss`), not a stop. The flats bog the board down (`flatsDragMultiplier`).
- **Pumping** (playtest 2 supersedes "pumps only work on the face"). A pump's net gain scales with the face steepness: half strength on the flats, full from steepness 0.35. Spamming nets less than a rhythm (`pumpCost`). Pumping about once a second on a sensible line beats a fast section.
- **Stall to barrel.** A stall sets the rail: full grip at any speed, and the up/down motion on the face dies away (`stallHold`), so the rider waits on the face for the curl. Being tubed also requires being under the lip (`tubeUnderLip`). Holding the stall until the barrel closes gets you swallowed. Letting go early and pumping gets you out.
- **Fast sections.** They are seeded per run and exposed as `window.__surf.seed`. The boost is 0.45–0.5 and the hold is 4–5 s, within the design's +30–50% for 3–5 s. They show a ⚡ FAST SECTION callout, and making one scores a 500-point SECTION MADE (a combo trick, lost to a wipeout inside the combo window).
- **Crashing wave.** The lip throws up and out only, never into the eye, and foam scrolls with the live peel. The water adds a falling-lip curtain, impact explosions and churn over the impact zone, shoulder feathering, and rooster-tail spray on hard carves with bursts on snaps and cutbacks. Drops near the lens fade and shrink, and point sizes are capped, so the tube view stays readable. The rumble follows impact distance and fast sections. Shake peaks near the impact zone. All of it runs on sim time, so pausing freezes it.
- **One ocean, open barrel** (playtest 3). The wave and the sea are one surface with one water material, and an opaque sea floor replaces the translucent sea plane. The open-barrel lip tip hangs high and recedes through a feathering stage ahead of the curl, so the eye is open from the tube camera. The horizon is a shader sky whose haze is the fog colour. The e2e horizon test asserts no step, band or dip.
- **Regular stance.** The rider always surfs regular (left foot forward). On a LEFT the body is mirrored (the board is not), so they ride backside, and the toe/heel carve poses flip.
- **Landing assist.** A carve key held from the face doesn't spin in the air until it is pressed again. A released spin settles to the nearest half turn. The landing window is ±60°. A grab held into the landing is let go 0.15 s before touchdown.
- **Camera.** The chase is a close bird's-eye view behind the rider along their eased travel direction. It stays above the local crest and looks ahead down the line. It swings behind the actual travel on a cutback. The **tube view is a cut**, not a glide (a glide from above the lip would pass through it). It is on whenever there is a spot behind the rider in the barrel's air that sees them. That spot uses an 85° lens, looks past the rider with the eye beside them, is kept inside the barrel's profile, and is never behind `tubeMinX`. When the barrel closes and no spot is left, the camera **holds the last tube pose** (easing with the rider while it stays good, otherwise locked off). A pose that can no longer be held becomes the swallow's **underwater cut, a moment early**. The camera holds still while paused.
- **Coach.** This is a pure sim-time model (`src/surf/game/coach.ts`). It shows ▲ PUMP! within 8 m of the curl while the rider is losing ground, and ▲ PUMP OUT! in the tube. It hides on a clear gain, beyond 11 m, on a stall, in the air or on a wipeout. The prompt beats once a second after each pump. GUIDE ON/OFF (G on the title) is saved in localStorage. It is exposed as `window.__surf.coach`.
- **Touch** (resume-site integration). The action pad is two columns hugging the right edge: METHOD / RAIL, STALE / INDY, with OLLIE in the corner. The old three-wide pad reached over the rider's board in the phone tube view. The title shows a short touch legend on coarse pointers, because the keyboard help ran off a phone held landscape.
- **Verification.** Camera probes (`CameraRig.test.ts`) cover the chase, the tube view (rider seen and in frame, eye open), no whip or jump up to the swallow, and never under the water. e2e (`tests/e2e/surf.spec.ts`) covers the no-input catch timing (over 2 s, SWALLOWED BY THE BARREL), the chase shot with `peel === 8`, holding ↓ cutting to the tube view, the coach, the budget and the horizon.
