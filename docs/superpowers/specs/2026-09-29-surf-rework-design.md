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
    down (over a few ticks).
- A held carve toward the lip / trough steers the board toward straight up /
  down the face and settles there (no fishtail); from near straight up or down
  it turns through down the line (toward the shoulder).

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

## Playtest 2 amendments (user feedback)

- **Camera:** close bird's-eye view from behind the rider — about 3–4 m behind along the direction of travel, 4–6 m above (always above the crest), looking down at the rider and a few metres ahead down the line; the rider is large in frame. Tube: behind the rider looking out.
- **Pumping:** a player pumping on a sensible line must be able to beat the section down the line; pumping is the primary speed tool. (Supersedes "pump-only dies" tuning.) No input is still caught in ~4–5 s. Pumping on the flats is weaker but no longer does nothing (supersedes design point "pumping only works on the face"); verified by Verification 7–9.
- **Background:** the horizon must be seamless — sea runs into haze and sky with no visible seam or band; sky gradient and fog match; distant water reads as water.


## Playtest 3 amendments (user feedback)

- **One continuous ocean:** the breaking wave must read as part of the same water body — no visible seam, height step, colour/shading jump, or gap between the wave mesh and the surrounding sea (in front, behind, and along the shoulder). Same water shading, foam and fog on both.
- **Realistic barrel:** from inside the tube the barrel is an open, roughly oval tunnel: the lip throws out and down into the trough behind the rider, while ahead the exit ("the eye") is clearly open — sky/shoulder visible through it. No sheet or curtain of water covering the exit. The tube camera shot must show the eye.
- **Horizon:** a clean, believable horizon — the sea meets a hazy sky with a soft gradient; no hard band, seam, stepped fog, or visible plane edge at any camera angle used in play.
