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
    unchanged. (Playtest 6: the yaw rate now drops to 0 on the release tick — see below.) A held turn that reaches the trough carries on round the way it
    is turning (the bottom turn follows it, never fights it into the flats).
  - **Letting go always stops the turn** (superseded in detail by the playtest 6
    amendment below: no ease-out, no turning at all without a key) (playtest 4 bug: "if i hold the arrow
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

- **Playtest 6 amendment: release stops the turn** (user, verbatim: "im still
  experiencing stickyness of the turn arrow. when i let go during what i think the
  game thinks is a roundhouse, the character does not stop turning. there shouldnt
  be any automated turning. when i let go, the turning must stop"). Supersedes the
  playtest 4 "eases out over `carveLag`" release.
  - **On the tick a carve key is let go the yaw rate is 0.** Pressing a key still
    eases the rail in over `carveLag` (the weighty rail); releasing never eases out.
  - **With no carve key held nothing changes the board's yaw.** No rebound (it
    already needed the key), no snap / lip bite, no cutback memory turning, no
    bottom turn at the trough, no lip shed by rotation. The only turning without a
    key left is the air spin settle (the accepted landing assist). Landings, floater
    mounts / dismounts and drops off a face end restore a face velocity as before
    (leaving or rejoining the face, not a turn while riding).
  - **The rail holds the line.** With no carve key held the board's line — its angle
    in the face from along the wave (e1) toward up the face (eUp) — is latched on the
    release (or the first keyless tick, e.g. the drop-in or a landing) and held where
    the board goes: every force (gravity, wave drive, drag, a pump) only changes the
    speed along that line; the part across it is held by the rail (no sag). A board
    whose line climbs slows on it and can slide back down it tail first, its heading
    unchanged. Holding the stall (↓, a player input) is the one thing that may still
    flatten the held line (stall-to-barrel).
  - **Trough:** with no key held there is no auto bottom turn: the board bogs on the
    flats (`flatsDragMultiplier`) on its line until the player carves; carving there
    is the bottom turn (`bottomTurnRate`, `bottomTurnLoss`, as before).
  - **Lip:** with no key held and too slow to launch, nothing turns the board off
    the lip: gravity along a line that climbs into the lip slows it until it slides
    back down that line (a line along the lip runs along the top of the face).
    Letting go at the lip with up-face speed still launches; the cutback launch
    guard still applies.
  - **Heading:** the board's heading is its motion through the water as the
    physics sees it (v − water, the water sliding at −Vp·e1), so it is the held line
    exactly and doesn't jump on a press or a release where the hollow face tilts e1
    (it was v + Vp·x̂).
  - **No flips** (review fix): a board running tail first down its held line, or whose motion has
    just come through a stop, keeps pointing the way it did when a key is pressed (± the motion,
    whichever is nearer its last heading): carved while sliding back, it carves tail first. Holding
    the stall flattens the held line without ever flipping it. Tests: press while sliding back and
    stall on steep / backward lines, ≤ 15° per tick.
  - **Re-tuned to keep the targets' intent** (the release ease-out and the rail sag
    had been doing part of the work): `drag` 0.025 → 0.032 (no-input catch ≈ 4.6 s,
    unpumped lines still lost within 10 s, pumping targets met with margin);
    `roundhouseDeg` 150 → 130 (the ease-out used to add ≈ 20–25° to every cutback:
    the same two presses read ≈ 139°); the lineBot anticipates less (`ANTICIPATE`
    0.6 → 0.3: no overshoot carries its climbs on) and, on the flat bottom of the
    face (steepness < 0.3), never holds a turn past 50° of yaw (its 3D climb reads
    small there). Test scripts that relied on the auto bottom turn or the ease-out
    now carve those turns (camera cutback probes: the lip turn is held round to
    heading.x < −0.97, its bot tops out at 0.8 × crest; the non-reversing carve hands
    back to the lineBot; the roundhouse framing rides on with the lineBot after the
    exit). One-tick turning checks measure the board's yaw in the face (`faceYaw`),
    not the 3D heading, which also pitches with the surface (e.g. up the pocket wall).

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
8. No input is swallowed in 4–6 s (tuned ≈ 4.6 s since playtest 6); the same lines without pumps still
   lose the wave within 10 s.
9. Pump feel: a full-efficiency pump mid-face at riding speed (8–12 m/s) adds +1.5–3 m/s of world speed;
   spamming faster than ~0.35 s has diminishing returns (speed per second at 0.2 s < 80%, at 0.1 s < 50%
   of a 0.6 s rhythm); a pump low on the face or in the flats is weaker than mid-face but never nothing
   (`pumpFlatGain`: half strength on the flats, full from steepness 0.35); pumps do nothing in the air.
10. Slamming the trough and carving is a bottom turn, not a dead stop (playtest 6: with no key held
    there is no turn — the line holds and the flats bog the board down): the line swings toward along
    the wave (the way it is carved: from straight down, toward the shoulder) at `bottomTurnRate`, bleeding
    `bottomTurnLoss` per 90°; at 6 and 10 m/s the rider keeps ≥ 70% of its speed through the turn and
    the heading never changes > 15° in one tick. Once on the flats (t = 0) the board bogs down
    (`flatsDragMultiplier` × drag).
11. Camera cutback probes use genuine turns back toward the curl (a lip snap carve-back, or a carve
    past the fall line into a bottom turn), never a one-tick heading snap; far-out reversals must
    leave settled-line samples.
12. Roundhouse (playtest 4): a held carve from down the line at 8 and 12 m/s turns on past 180° without
    settling; released, the yaw rate is 0 from the release tick (playtest 6). At 8–12 m/s, a roundhouse — one held
    carve near the pocket, or two presses (cut back, let go, press into the lip) from x = 20–30 — emits
    one `roundhouse` (no snap, or one taken back), comes out down the line with ≤ 15° per tick, no faster
    than it went in, ends shallower than −D/2, and 0.5 s later (back on its line down the face) runs at
    ≥ 60% of the entry speed. A short turn into the foam rebounds without one. During a roundhouse the
    leaning rider is framed in every chase frame (chest |ndc y| ≤ 0.7, board ≤ 0.8) and seen in ≥ 90%
    of them.
13. Release (playtest 6): let go mid cutback, mid foam / lip rebound, at the lip with a snap armed, at
    the trough mid bottom turn, after a 3 s hold, and in the two-press gap and just after the re-press:
    the yaw rate is exactly 0 on every riding tick from the release and the board's yaw in the face
    changes by under 2° over the next 1 s; no ROUNDHOUSE for a turn let go of. With no key, the trough
    does not turn the board (< 2° over 0.5 s).

## Playtest 5 amendments: section peaks (user feedback)

User: "every fast section, there is a peak that starts to form ... that the user has to race towards
to make that section of the barrel. and the user can choose to air off of it if they want instead of
enter the barrel." Choices: it forms further ahead (15–25 m), missing it closes out on you, it is a
steeper ramp for a bigger air (SECTION AIR).

- **It forms.** When a fast section starts (every 10–20 s, seeded), a peak forms 15–25 m (seeded)
  down the line from the rider (frame x, at most `peak.maxSpawnX` 70) and grows over 2–3 s (seeded,
  smoothstep) to +35% height (`peak.height`). It is one temporary bump in the one wave shape:
  `WaveShape.heightScale` multiplies y by 1 + amp · (1 − u²)³, u = (x − peak x) / `peak.width` (7 m),
  so the physics, the camera's crest probes, the particles and the barrel rules all ride it, and the
  mesh gets the same formula in the vertex shader (`uPeak`, `wave/peak.ts`: position and the normal's
  inverse transpose; the geometry stays the rest shape). Same footprint, taller: a steeper face.
  Feathering spray comes off its crest while it stands.
- **The race** (`sections.minRace`–`maxRace` 3.5–4.5 s, seeded). The fast section's boost
  (+45–50%, ramped in over 0.5 s) holds until the pitch. A world-fixed peak would approach the curl at
  the full peel speed and reach it by itself within the race for anyone near it (and anyone ahead of
  the curl would pass it): no race. So in the wave frame the peak drifts toward the curl at a
  constant `approach` chosen at spawn to pitch at xPitch = rider's x at the start − `allowance` × race
  time (≥ `minPitchX` 1 m, and at least `minApproach` 2 m/s × race time short of where it formed). The
  rider makes it by losing frame ground over the race no faster than `allowance` (3.3 m/s). Measured
  (headless, 12 seeds): pumping every 1 s on a lineBot line loses 2.0–2.2 m/s, a human rhythm
  (0.8–1.2 s) 1.7–3.0, every 1.3 s 2.2–3.2, every 2 s 2.8–4.1, no pumps 4.3–5.6. The coach shows
  ▲ PUMP! during the race whenever, on its current pace (frame-x change over 0.5 s), the rider would be
  more than 0.5 m short of xPitch at the pitch — at any distance from the curl.
- **The pitch** is a surge of peel speed that carries the curl to the peak: over max(`minSurge` 0.4 s,
  xPitch / `surgeSpeed` 25 m/s) the peak's frame x eases xPitch → 0 (smoothstep) and the peel runs that
  much faster on top of the boost, so every frame x moves back by xPitch (the camera's springs are
  shifted with the frame, so it doesn't trail). The bump blends back into the wave from the pitch to
  the end of the ramp down (smoothstep). The closing stretch from the curl to the peak throws its lip
  (spray along it through the surge, carried back with it, so it stays behind a rider who made it).
  - **Made** (frame x ≥ xPitch at the pitch): the rider comes out just ahead of the new curl, the
    barrel right behind; still up when the curl reaches the peak, SECTION MADE (500, as before). The
    existing barrel / swallow / tube-exit rules then apply as ever (stall into it or race on).
  - **Missed** (short of xPitch): the closing section lands on the rider when the curl passes them
    (frame x < 0, riding or in the air) or when the surge ends, whichever is first: wipeout
    **CLOSED OUT** (a swallow during it reads the same).
- **Air off it.** A launch (crest air or ollie) pops `physics.peakAirLift` (1) × the bump there
  faster, scaled by how high up the face it launches (none below `peakAirFrom` 0.4 of the crest
  height, full from `peakAirFull` 0.75): × 1.35 off the top of a full peak (the crest launch may then
  exceed `maxAirSpeed`) — the steeper ramp is what pops you, an ollie from the trough gets nothing. A
  launch off the peak's upper half (bump ≥ `peak.airOn` 0.5 × full height, while it stands or
  pitches) and off its upper face (a crest launch, or launched at ≥ `peak.airFromHeight` 0.6 × the
  crest height) that lands clean scores SECTION AIR (750) on top of the air's tricks, once per peak.
- **Far down the line** (review fix): if a peak 15–25 m ahead of the rider would form past
  `maxSpawnX` (70), that section has no peak — it is a plain fast section (the boost through the race
  time, then the ramp down; no pitch, nothing to make). A peak always forms 15–25 m ahead.
- **After the pitch** (review fix): the coach's x history is shifted with the surge (as the camera is),
  and after SECTION MADE it stays quiet for `madeGrace` (1.5 s) — the rider is in front of the new
  barrel on purpose. The scenery's `travel` is blended between sim steps like the rider (no stepping
  at surge speeds; the pier will reuse it).
- `window.__surf.peak` exposes phase / x / amp / xPitch / made; `?debug` adds `window.__surfBot` (a
  lineBot autopilot for screenshots) and the `peak.height` / `peak.allowance` sliders. The frame / time
  math lives in `PeelController` (a pure function of time since the section began and the rider's x
  then) and `SectionDirector` (headless: the game and the tests drive it) — a world-fixed feature
  (e.g. a pier) moves through the frame at −(live peel speed), surge included.

Verification (playtest 5): the bump is C1 along the wave (no height / normal jump between columns 5 cm
apart) and changes smoothly frame to frame through a whole section (< 8 cm per 120 Hz tick at any
point); the shader formula's CPU twin on the rest mesh lands on the peaked profile (< 0.1 mm) with
normals within 2°; crestT is unchanged by it; the peak forms 15–25 m ahead, grows over 2–3 s, races
3.5–4.5 s and is at the curl when the surge ends; steady pumping (1 / s) and a human rhythm make the
section on 8 seeds (SECTION MADE, just ahead of the new curl), no pumps from the start of the race is
CLOSED OUT on 8 seeds (during the surge), and so is a rider short of it in the air; a crest air off
the top of a full peak goes ≥ 1 m higher than the same air at 8 and 10 m/s, an ollie ≥ 0.5 m; SECTION
AIR scores once per peak and not off the wave beside it; the barrel eye stays open (5.5°) with the
largest leftover bump at the curl; the boost tests keep their intent (the hardest race costs a 1 / s
pumper ≥ 9 m: the boost now holds 3–4 s to the pitch, not 4–5 s); e2e: a fast section raises a peak
ahead of the rider (hook.peak) and the run ends on the results screen; screenshots (both sides): the
peak rising, the pitch, a made section with the new barrel behind, short of the peak with the coach,
CLOSED OUT, SECTION AIR.

### Playtest 5: charged ollie

User: "pressing the space bar down should be a crouch (prepare for jump), releasing the space bar
should be the jump (ollie)"; "go higher the longer you hold Space".

- Space (or the touch OLLIE button) **down crouches**: a fresh press on the face (not on a floater)
  starts loading the ollie; the rider blends into the "load" pose at once (deeper as it loads:
  `SurferState.ollieCharge` 0…1) and keeps riding and carving normally. **Up pops it**: ollieImpulse ×
  a gain from `ollieTapGain` (0.8, a tap: a little lower than the old ollie) rising linearly to
  `ollieFullGain` (1.35) at `ollieChargeTime` (0.5 s) and holding there (no penalty for holding on). A
  press and release inside one tick is a tap.
- In the air the key does nothing; one pressed in the air (or held from it into the landing) never
  loads — it must be let go and pressed again on the face. Leaving the face (a crest launch, a drop,
  a wipeout) cancels a load. A pause / resume, losing window focus, or a held touch OLLIE taken by
  the OS (pointercancel / lost capture) drops a load without a pop (review fix). Landing rules (spin
  latch etc.) are unchanged. The load pose weighs at most 0.75 (review fix), so a bottom / top turn
  posture still reads underneath a full load.
- Verification: no ollie on the press, the ollie on the release; apex height monotonic in hold time
  and capped (a full load > 2× a tap's height; a tap below and a full load ≥ 1.5× the old ollie);
  the load pose weight while held; the key held from the air and a crest launch while loading never
  pop; touch and keyboard give the same input; e2e: Space held shows the load pose while riding, the
  release pops and the ollie scores.

### Playtest 5: lip lean

User: "the steeper the face, the further he should be leaning back (away from the wave)".

- Riding (not in the air, on a floater or wiping out), the drawn body's up blends from the surface
  normal toward world up by `LEAN_BACK` (0.5) × smoothstep(`LEAN_FROM` 0.35, 1, steepness)
  (`character/lean.ts`; steepness = sin of the face angle, 1 when vertical or overhanging): on a
  near-vertical lip face the rider stands leaned back out over the flats (about 45° from upright)
  instead of sticking straight out from the face. The body pivots back on its feet — about the line
  through the two soles on the deck, after the feet are planted — so the feet stay where they stand
  and the board stays on the face; the angle eases in (no snap when a face end tips the normal). It
  sits on top of the pose layer (bottom / top turn postures unchanged), the turn bank and the backside
  mirror. The camera's framing guard (`riderUp`) models it.
- Verification (both rigs, both sides): the lean back from the normal is monotonic in steepness (0 on
  a flat face); on a vertical face the body is within 50° of upright, > 35° back from the normal and
  still leaning toward shore; the soles stay within 1 cm of where they stand on a flat face; a
  one-tick tip of the normal eases in over several frames; no lean in a trick air; screenshots at the
  top of the face from the chase camera.

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
- **Fast sections.** They are seeded per run and exposed as `window.__surf.seed`. The boost is 0.45–0.5 and holds through the 3.5–4.5 s race to the section peak (playtest 5; it was a 4–5 s hold), within the design's +30–50% for 3–5 s. They show a ⚡ FAST SECTION callout, and making one — on or past the peak at its pitch, still up after the surge — scores a 500-point SECTION MADE (a combo trick, lost to a wipeout inside the combo window).
- **Crashing wave.** The lip throws up and out only, never into the eye, and foam scrolls with the live peel. The water adds a falling-lip curtain, impact explosions and churn over the impact zone, shoulder feathering, and rooster-tail spray on hard carves with bursts on snaps and cutbacks. Drops near the lens fade and shrink, and point sizes are capped, so the tube view stays readable. The rumble follows impact distance and fast sections. Shake peaks near the impact zone. All of it runs on sim time, so pausing freezes it.
- **One ocean, open barrel** (playtest 3). The wave and the sea are one surface with one water material, and an opaque sea floor replaces the translucent sea plane. The open-barrel lip tip hangs high and recedes through a feathering stage ahead of the curl, so the eye is open from the tube camera. The horizon is a shader sky whose haze is the fog colour. The e2e horizon test asserts no step, band or dip.
- **Regular stance.** The rider always surfs regular (left foot forward). On a LEFT the body is mirrored (the board is not), so they ride backside, and the toe/heel carve poses flip.
- **Landing assist.** A carve key held from the face doesn't spin in the air until it is pressed again. A released spin settles to the nearest half turn. The landing window is ±60°. A grab held into the landing is let go 0.15 s before touchdown.
- **Camera.** The chase is a close bird's-eye view behind the rider along their eased travel direction. It stays above the local crest and looks ahead down the line. It swings behind the actual travel on a cutback. The **tube view is a cut**, not a glide (a glide from above the lip would pass through it). It is on whenever there is a spot behind the rider in the barrel's air that sees them. That spot uses an 85° lens, looks past the rider with the eye beside them, is kept inside the barrel's profile, and is never behind `tubeMinX`. When the barrel closes and no spot is left, the camera **holds the last tube pose** (easing with the rider while it stays good, otherwise locked off). A pose that can no longer be held becomes the swallow's **underwater cut, a moment early**. The camera holds still while paused.
- **Coach.** This is a pure sim-time model (`src/surf/game/coach.ts`). It shows ▲ PUMP! within 8 m of the curl while the rider is losing ground, and ▲ PUMP OUT! in the tube. It hides on a clear gain, beyond 11 m, on a stall, in the air or on a wipeout. The prompt beats once a second after each pump. GUIDE ON/OFF (G on the title) is saved in localStorage. It is exposed as `window.__surf.coach`.
- **Touch** (resume-site integration). The action pad is two columns hugging the right edge: METHOD / RAIL, STALE / INDY, with OLLIE in the corner. The old three-wide pad reached over the rider's board in the phone tube view. The title shows a short touch legend on coarse pointers, because the keyboard help ran off a phone held landscape.
- **Verification.** Camera probes (`CameraRig.test.ts`) cover the chase, the tube view (rider seen and in frame, eye open), no whip or jump up to the swallow, and never under the water. e2e (`tests/e2e/surf.spec.ts`) covers the no-input catch timing (over 2 s, SWALLOWED BY THE BARREL), the chase shot with `peel === 8`, holding ↓ cutting to the tube view, the coach, the budget and the horizon.
