# Surf Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the first playtest. Standard RIGHT/LEFT naming. A break that actively chases the rider, with pumping, rail carving and racy fast sections. A visibly crashing lip. A chase camera behind the rider from the curl side.

**Architecture:** Same engine and module boundaries as the surf game. `Surfer` still steps a wave-frame state machine at 120 Hz against the single `WaveShape.profile`; its riding forces are rebuilt around the board's motion *through the water* (rail grip, eased carve, face-only pumps, no lift). A new pure `PeelController` drives the peel speed (seeded fast sections), and `SurfGame` feeds it to the surfer as a frame acceleration. `CameraRig` gets a crest-aware chase goal, a tube *cut* and an impact shake. The crash is rendered with shader lip animation, new particle emitters, and a rumble layer in `SurfAudio`, all on the sim clock.

**Tech Stack:** TypeScript 5.9 strict, three.js 0.186, zustand 5, React 19 / Next.js 16, Web Audio, Vitest 5 (+ jsdom), Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-29-surf-rework-design.md` (binding; amends `docs/superpowers/specs/2026-09-29-surf-game-design.md`, which still holds everywhere the addendum is silent).

## Global Constraints

- The addendum wins where it differs from the original spec; everything else in the original spec and in `docs/superpowers/plans/2026-09-29-surf-game.md` Global Constraints still holds (1 unit = 1 m; wave frame +x toward the shoulder with the curl at x = 0, +y up, +z toward shore; ONE `profile(x, t)` for physics and render; fixed 120 Hz physics; all tunables in `src/surf/config.ts`; typed `EventBus` only; no React under `src/surf/` except `*.tsx`; HUD writes ≤ 15 Hz; **draw calls < 80, triangles < 150k**; `RetroRenderer` + `retroMaterial`; StrictMode-clean disposal).
- **RIGHT** = the wave peels to the surfer's right as they face the beach. Facing shore (+z) with +y up the surfer's right is −x, so the canonical frame is a LEFT and a RIGHT is mirrored. Test: on a RIGHT, travel · right-hand > 0.
- **With no input the curl catches the rider in ~4–5 s (and not in < 2 s)**; rhythmic pumping (≈ 1/s) + down-the-line carving holds ≥ 30 s at base peel.
- **Racy sections:** every 10–20 s (random, seeded per run) Vp ramps up 30–50% over ~0.5 s, holds 3–5 s, ramps back; HUD "⚡ FAST SECTION" + louder rumble; surviving one scores **"SECTION MADE", 500**.
- **Crashing:** falling-lip spray curtain along the pitching section, whitewater explosions and churn where the lip lands (x ∈ [−D, 0] and behind), feathering along the shoulder crest, animated lip mesh, foam scrolling with the break, distance-driven rumble, subtle shake near impact — **all on sim time (pause freezes it)**.
- **Carving:** whole face usable (trough → lip); turn radius grows with speed; momentum carries through turns (small rail drag); drops convert height to speed, climbs speed to height. **Crest launches, snaps (incl. apex-armed), floaters, tube, grabs/spins and landing rules keep their existing semantics** (the wave-anchored air model is untouched).
- **Camera:** chase behind the rider on the curl side, above the local crest + margin, looking past the rider down the line; tube = behind the rider inside the barrel looking out; air pulls back/up; wipeout underwater cut unchanged; weighty but responsive springs; never in the water or the lip; rider visible ≥ 90% of chase frames.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## How this plan was made (read this first)

Every number and every code block here was **prototyped and verified before writing**. A scratch copy of `build/v1` was reworked and probed headlessly with the real `Surfer`, `WaveShape`, wave mesh and `CameraRig` until all six Verification criteria passed. It was playtested in Chromium with screenshots, and the full e2e suite passed there (13/13). The plan was then **replayed task by task on a fresh copy of HEAD**: each "fail" run failed, each "pass" run passed, `tsc` was clean after every task, and each commit captured every changed file. The replayed tree is byte-identical to the prototype. Apply the edits exactly as written. Every "replace" block occurs exactly once in its file at that point in the plan.

## Tuned numbers (prototyped)

| What | Value | Measured result |
|---|---|---|
| Base peel `wave.peelSpeed` | **8 m/s** (was 7) | — |
| No input | drop-in (x 3.5, t 0.5) | tube entry 2.97 s, **swallowed 4.80 s** |
| S-turns + pump every 1 s | `lineBot` defaults (low 0.35, high 0.6, slope 0.15) | riding at 35 s, mean world speed 9.2 m/s |
| Same lines, no pumps | — | swallowed ≈ 7.4 s |
| Drag / drive | `drag 0.03` (quadratic, vs the water), `drive 1.8 × steepness` along +x | drive < drag at pace everywhere (1.8 < 1.92), so nothing parks the rider |
| Pump | `pumpImpulse 3`, `pumpCost 0.25`, `pumpPeriod 0.6`, net × `smoothstep(0.1, 0.5, steepness)` | spam (0.1 s) 9.4 m/s vs rhythm (0.6 s) 11.4 m/s mean |
| Rail | `railGrip 0.85` from `gripSpeed 5` m/s; `carveBleed 0.5` | — |
| Turn-rate model | yaw rate → `carve × 4 / (1 + speed/10)` rad/s, eased with `carveLag 0.12` s | radius 3.2 m @ 6, 5.4 m @ 9, 8.0 m @ 12 m/s; trough → 85% crest in 0.77–1.0 s |
| Crest | `crestShed 1` m/s (too slow to launch → pushed back down) | slow climb no longer balances on the ridge |
| Fast sections | gap 10–20 s, hold 3–5 s, boost 0.3–0.5, ramp 0.5 s | 1.4×/4 s: base effort loses 11.6 m; pump every 0.6 s survives (−6.3 m); 1.5×/5 s survivable (−11.9 m) |
| Barrel | stall while carving, release at x ≤ 3, pump every 0.6 s | 2.3 s barrel, then out |
| Camera chase | offset (−6, +2.2, +2) m, look rider + (5, 0.4, 0), floor = max(crestY(cam.x), crestY(rider.x)) + 1.2 m; springs 4 / 6 | 30 s ride: 100% behind / down the line / above crest / rider seen; 0 wet |
| Camera tube | cut in 0.2 s / out 0.15 s; 2.2 m behind, 0.8 m off the face, x ≥ −6; springs 20; also when riding at x ≤ 3 below 0.6 × crest | no-input 100%, barrel 100% of tube frames |
| Shake | 0.06 m over x ∈ [−D, 0], fading over 8 m, sim clock | — |
| Rumble | gain (0.06 + 0.3·near²)(1 + 0.8·fast), cutoff 140 + 360·near + 260·fast Hz, near = 1 − d/30 | — |
| Particles | lip 240/s, bursts 9/s × 16, churn 140/s, feather 70/s; near fade 0.8–2.5 m; point cap 6% of render height | 14–17 draw calls, ≈ 52k triangles |

## Design points interpreted (also written into the addendum in Task 6)

1. **"Not a constant wave drive that parks the rider"**: lift and face damping are removed, and a steepness-weighted pocket drive (≤ 1.8 m/s²) stays as the "good lines generate speed" term. It is weaker than the drag at pace even on the steepest face, so there is no parking equilibrium.
2. **Pumping only works on the face.** Needed: otherwise pumping straight along the flats outran the curl forever and carving didn't matter.
3. **The board's heading is its world direction** (`v + Vp·x̂`); carve/pump/grip/drag act on it. Needed so a rider losing ground doesn't point or pump toward the curl; it also makes going vertical cost ground (the racy tension).
4. **"Caught" = swallowed** (x < −D). Being forced into the tube happens earlier (≈ 3.0 s).
5. **"The same effort loses ground; stronger effort survives"**: base = S-turns + 1 pump/s; stronger = the same lines pumping every 0.6 s.
6. **SECTION MADE** is a combo trick (500 into the pot, multiplier-eligible).
7. **"The camera drops in behind the rider inside the barrel"** is a **cut**, because a glide cannot reach that spot without passing through the lip. The tube view also covers riding low in the pocket, where the lip hides the rider from any above-the-crest camera.
8. **Verification 5 "≥ 90% of chase frames"** is asserted on a 30 s S-turn ride and on the no-input ride (both 100%). When a rider climbs high in the pocket, the chase view sees them 86% of the time; this is inherent to a camera above the lip, and not asserted.
9. The drop-in moves from (4, 0.55) to (3.5, 0.5): closer to the curl for the 4–5 s catch, and out from under the lip for the behind camera.
10. The key mapping (`carveFromKeys`) ends where it started, because the side flip and the camera flip cancel. Task 1 flips it temporarily so every commit stays screen-correct.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/surf/wave/mirror.ts` | side sign (RIGHT mirrored) | 1 |
| `src/surf/physics/input.ts` | screen-relative carve mapping | 1, 3 |
| `src/surf/physics/Surfer.ts` | riding physics: water-relative motion, rail, carve, pumps, shed, `setPeelSpeed` | 2 |
| `src/surf/physics/lineBot.ts` (new) | test-support scripted rider | 2 |
| `src/surf/camera/CameraRig.ts` | chase/tube/underwater shots, crest floor, cut logic, shake | 3 |
| `src/surf/wave/impact.ts` (new) | distance to the impact zone (camera shake, rumble) | 3 |
| `src/surf/math/random.ts` (new) | `mulberry32` (shared by audio and sections) | 4 |
| `src/surf/wave/PeelController.ts` (new) | seeded fast-section schedule → peel speed | 4 |
| `src/surf/scoring/Scoring.ts`, `state/store.ts`, `ui/Hud.tsx` | SECTION MADE, `fastSection`, callout | 4 |
| `src/surf/render/waveGeometry.ts`, `waveMaterial.ts`, `WaveMesh.ts` | `aLip`, lip throw, foam by travel | 5 |
| `src/surf/render/Particles.ts` | curtain, bursts, feathering, near fade | 5 |
| `src/surf/audio/synth.ts`, `SurfAudio.ts` | rumble | 5 |
| `src/surf/game/SurfGame.ts` | wiring (rig ← wave/clock, peel, water travel, rumble) | 3, 4, 5 |
| `src/surf/config.ts`, `game/debugParams.ts`, `game/debugHook.ts` | tunables, sliders, hook | 2, 3, 4 |
| `tests/e2e/surf.spec.ts`, `README.md`, addendum | integration + docs | 6 |

---

### Task 1: Side naming: RIGHT peels to the surfer's right

**Files:**
- Modify: `src/surf/wave/mirror.ts` (`sideSign`)
- Modify: `src/surf/physics/input.ts` (`carveFromKeys`)
- Test: `src/surf/wave/mirror.test.ts`, `src/surf/physics/input.test.ts`, `src/surf/camera/CameraRig.test.ts` (side literals swapped)

**Interfaces:**
- Consumes: nothing new.
- Produces: `sideSign(side: Side): 1 | -1` now returns **+1 for `'left'`** (canonical frame, rider travels +x) and **−1 for `'right'`**. `frameToView` and `SurfGame` (`frame.scale.x = sideSign(side)`) are unchanged and follow it. `carveFromKeys(left, right, side)` keeps its signature; its side mapping flips here (old shoulder-side camera) and flips back in Task 3 (new behind camera).

- [ ] **Step 1: Write the failing tests**

The canonical frame (rider travels +x, shore +z) is currently labelled RIGHT, but a surfer facing the beach (+z, up +y) has their right hand at forward × up = −x, so it is really a LEFT. The new test pins the convention from the design (§1).

Replace the whole of `src/surf/wave/mirror.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { frameToView, sideSign } from './mirror';
import { WaveShape } from './WaveShape';

describe('mirror', () => {
  it('produces symmetric results for LEFT and RIGHT', () => {
    const w = new WaveShape(structuredClone(SURF_CONFIG.wave));
    const l = new Vector3();
    const r = new Vector3();
    for (const x of [-10, -3, 0, 5, 30, 80]) {
      for (const t of [0, 0.3, 0.7, 1]) {
        const p = w.surfacePoint(x, t);
        frameToView(p, 'left', l);
        frameToView(p, 'right', r);
        expect(l.x).toBeCloseTo(-r.x, 9);
        expect(l.y).toBe(r.y);
        expect(l.z).toBe(r.z);
      }
    }
  });
  it('matches the frame group transform (scale.x = sideSign)', () => {
    const p = new Vector3(12, 1.4, 2.2);
    const viaMatrix = p.clone().applyMatrix4(new Matrix4().makeScale(sideSign('left'), 1, 1));
    expect(frameToView(p, 'left', new Vector3()).equals(viaMatrix)).toBe(true);
    expect(frameToView(p, 'right', new Vector3()).equals(p.clone().applyMatrix4(new Matrix4().makeScale(sideSign('right'), 1, 1)))).toBe(true);
    expect(sideSign('left')).toBe(1);
    expect(sideSign('right')).toBe(-1);
  });
  it("a RIGHT peels to the surfer's right as they face the beach (standard naming), a LEFT to their left", () => {
    // The rider travels +x in the canonical frame; facing shore (+z) with +y up, their right hand is forward × up.
    const travel = new Vector3(1, 0, 0);
    const rightHand = new Vector3(0, 0, 1).cross(new Vector3(0, 1, 0));
    expect(frameToView(travel, 'right', new Vector3()).dot(rightHand)).toBeGreaterThan(0);
    expect(frameToView(travel, 'left', new Vector3()).dot(rightHand)).toBeLessThan(0);
  });
});
```

With the existing shoulder-side camera, the canonical frame (now a LEFT) has the lip on screen-right, so → = toward the lip on a LEFT. Swap the sides in the input tests:

Replace the whole of `src/surf/physics/input.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ActionState } from '@/shared/input/ActionState';
import { EventBus, type SurfEvent } from './events';
import { carveFromKeys, readSurferInput, SURF_BINDINGS, type SurfAction } from './input';

describe('carveFromKeys (screen-relative)', () => {
  it('→ turns toward the lip on a LEFT and away on a RIGHT', () => {
    expect(carveFromKeys(false, true, 'left')).toBe(1);
    expect(carveFromKeys(false, true, 'right')).toBe(-1);
    expect(carveFromKeys(true, false, 'left')).toBe(-1);
    expect(carveFromKeys(true, true, 'left')).toBe(0);
  });
});

describe('readSurferInput', () => {
  it('maps actions to a physics input with edges and the first held grab', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.keyDown('Space');
    a.keyDown('KeyS');
    a.keyDown('KeyD');
    a.keyDown('ArrowDown');
    a.tick();
    const i = readSurferInput(a, 'left');
    expect(i).toEqual({ carve: 1, spin: 1, pump: false, stall: true, ollie: true, grab: 'stalefish' });
    a.tick();
    expect(readSurferInput(a, 'right').ollie).toBe(false);
    expect(readSurferInput(a, 'right').carve).toBe(-1);
  });

  it('spin is screen-relative like carving: → spins the same way on screen on both sides', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.tick();
    expect(readSurferInput(a, 'left').spin).toBe(1);
    expect(readSurferInput(a, 'right').spin).toBe(-1);
    a.keyUp('ArrowRight');
    a.keyDown('ArrowLeft');
    a.tick();
    expect(readSurferInput(a, 'left').spin).toBe(-1);
    expect(readSurferInput(a, 'right').spin).toBe(1);
  });
});

describe('EventBus', () => {
  it('delivers typed events to type and wildcard subscribers, and unsubscribes', () => {
    const bus = new EventBus<SurfEvent>();
    const snap = vi.fn();
    const any = vi.fn();
    const off = bus.on('snap', snap);
    bus.onAny(any);
    bus.emit({ type: 'snap', time: 1 });
    bus.emit({ type: 'tubeEnter', time: 2 });
    expect(snap).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
    off();
    bus.emit({ type: 'snap', time: 3 });
    expect(snap).toHaveBeenCalledTimes(1);
  });
});
```

The camera tests compare frame coordinates with view coordinates of the canonical side; swap every `'right'`/`'left'` literal so they keep testing the canonical frame (the file is rewritten in Task 3):

```bash
perl -pi -e "s/'right'/'__R__'/g; s/'left'/'right'/g; s/'__R__'/'left'/g; s/for a LEFT/for a RIGHT/g" src/surf/camera/CameraRig.test.ts
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surf/wave/mirror.test.ts src/surf/physics/input.test.ts src/surf/camera/CameraRig.test.ts`

Expected: FAIL — `a RIGHT peels to the surfer's right …` (dot product < 0), `sideSign('left')` is −1, the swapped input and camera expectations fail.

- [ ] **Step 3: Flip the side sign and the key mapping**

In `src/surf/wave/mirror.ts`, replace:

```ts
/** +1 for a RIGHT (canonical frame), −1 for a LEFT (x mirrored). */
export const sideSign = (side: Side): 1 | -1 => (side === 'right' ? 1 : -1);
```

with:

```ts
/**
 * +1 for a LEFT (canonical frame), −1 for a RIGHT (x mirrored). The canonical wave peels toward +x;
 * a surfer facing the beach (+z) with +y up has their right hand toward −x, so a RIGHT (peeling to
 * the surfer's right) is the mirrored frame.
 */
export const sideSign = (side: Side): 1 | -1 => (side === 'left' ? 1 : -1);
```

In `src/surf/physics/input.ts`, replace:

```ts
/**
 * Screen-relative carve: the chase camera sits on the shoulder side, so on a
 * RIGHT the lip is screen-right; the LEFT is mirrored, so → turns down the face.
 */
export function carveFromKeys(left: boolean, right: boolean, side: Side): number {
  const raw = (right ? 1 : 0) - (left ? 1 : 0);
  return side === 'right' ? raw : -raw;
}
```

with:

```ts
/**
 * Screen-relative carve: the chase camera sits on the shoulder side of the canonical
 * frame (a LEFT), so on a LEFT the lip is screen-right; the RIGHT is mirrored, so →
 * turns down the face. (Task 3's behind-the-rider camera flips this back.)
 */
export function carveFromKeys(left: boolean, right: boolean, side: Side): number {
  const raw = (right ? 1 : 0) - (left ? 1 : 0);
  return side === 'left' ? raw : -raw;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surf/wave/mirror.test.ts src/surf/physics/input.test.ts src/surf/camera/CameraRig.test.ts`

Expected: PASS.

Run: `npx vitest run src/surf`

Expected: PASS (all surf tests; `SurfGame` sets `frame.scale.x = sideSign(side)`, so the whole scene follows).

- [ ] **Step 5: Commit**

```bash
git add src/surf/wave/mirror.ts \
  src/surf/wave/mirror.test.ts \
  src/surf/physics/input.ts \
  src/surf/physics/input.test.ts \
  src/surf/camera/CameraRig.test.ts
git commit -m "$(cat <<'EOF'
fix(surf): RIGHT peels to the surfer's right (standard naming)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Physics rebalance: the break chases you, weighty rail carving

**Files:**
- Modify: `src/surf/physics/Surfer.ts` (riding forces, carve, pump, crest shed, trough, heading, `setPeelSpeed`)
- Modify: `src/surf/config.ts` (`wave.peelSpeed`, `physics` block)
- Modify: `src/surf/game/debugParams.ts` (new physics sliders)
- Create: `src/surf/physics/lineBot.ts` (test support: scripted S-turn rider)
- Test: `src/surf/physics/Surfer.test.ts`, `src/surf/math/math.test.ts`, `src/surf/camera/CameraRig.test.ts` (obsolete real-mesh blocks removed)

**Interfaces:**
- Consumes: Task 1 (nothing API-wise).
- Produces:
  - `Surfer.peelSpeed: number` (getter) and `Surfer.setPeelSpeed(vp: number): void` — changes the peel speed; the frame velocity shifts by ≈ −Δ along x (world velocity kept). `reset()` sets it to `wave.params.peelSpeed`.
  - `SurferState.heading` is now the board's direction **through the water** (world velocity `v + vp·x̂`), `SurferState.turnRate` the eased carve yaw rate.
  - `lineBot(surfer: Surfer, wave: WaveShape, o: { pumpEvery: number; low?: number; high?: number; slope?: number }): (dt: number) => SurferInput` (defaults low 0.35, high 0.6, slope 0.15) — used by the Surfer and camera tests.
  - `SURF_CONFIG.physics` loses `lift`, `faceDamping`; gains `railGrip 0.85`, `gripSpeed 5`, `carveLag 0.12`, `pumpMinSteepness 0.1`, `pumpFullSteepness 0.5`, `crestShed 1`; retuned `drive 1.8`, `drag 0.03`, `carveRate 4`, `carveHalfSpeed 10`, `carveBleed 0.5`, `pumpImpulse 3`. `SURF_CONFIG.wave.peelSpeed` 7 → **8**.

- [ ] **Step 1: Add the test driver (a scripted rider)**

`lineBot` rides down-the-line S-turns: bottom turn when below `low` × crest height, top turn above `high`, carving until the board climbs/drops at `|heading.y| = slope`, pumping every `pumpEvery` s. It is test support only (like `character/testRigs.ts`).

Create `src/surf/physics/lineBot.ts`:

```ts
import type { WaveShape } from '../wave/WaveShape';
import { NO_INPUT, type SurferInput } from './input';
import type { Surfer } from './Surfer';

export interface LineBotOptions {
  /** Pump every this many seconds (0 = never). */
  pumpEvery: number;
  /** Bottom turn when below this fraction of the crest height … */
  low?: number;
  /** … top turn when above it. */
  high?: number;
  /** Carve until the board climbs / drops this steeply (|heading.y|). */
  slope?: number;
}

/**
 * Test support (not used by the game): a scripted rider doing down-the-line S-turns
 * (bottom turn → top turn) with rhythmic pumps. Returns a per-tick input function.
 */
export function lineBot(surfer: Surfer, wave: WaveShape, o: LineBotOptions): (dt: number) => SurferInput {
  const { pumpEvery, low = 0.35, high = 0.6, slope = 0.15 } = o;
  let climbing = true;
  let since = 0;
  const input: SurferInput = { ...NO_INPUT };
  return (dt) => {
    const s = surfer.state;
    const frac = s.p.y / wave.crestY(s.param.x);
    if (climbing && frac > high) climbing = false;
    else if (!climbing && frac < low) climbing = true;
    const hy = s.heading.y;
    let carve = climbing ? (hy < slope ? 1 : 0) : hy > -slope ? -1 : 0;
    // Never turn back toward the curl.
    if (s.heading.x < 0 && carve !== 0) carve = climbing ? -1 : 1;
    since += dt;
    input.pump = pumpEvery > 0 && since >= pumpEvery;
    if (input.pump) since = 0;
    input.carve = carve;
    return input;
  };
}
```

- [ ] **Step 2: Write the failing physics tests**

These encode the design's Verification 1–4 with the prototyped numbers (see "Tuned numbers"). The old "settles mid-face" test is replaced (the design removes that stickiness); the snap setups are now given as world motion because the board heading is its world direction.

In `src/surf/physics/Surfer.test.ts`, replace:

```ts
import { NO_INPUT, type SurferInput } from './input';
```

with:

```ts
import { NO_INPUT, type SurferInput } from './input';
import { lineBot } from './lineBot';
```

In `src/surf/physics/Surfer.test.ts`, replace:

```ts
describe('Surfer — riding', () => {
  it('riding straight stays on the surface and settles mid-face', () => {
    const { wave, s, surfer } = setup();
    const onSurface = new Vector3();
    let worst = 0;
    for (let i = 0; i < 20 * 120; i++) {
      surfer.step(NO_INPUT, DT);
      expect(s.mode).toBe('riding');
      wave.profile(s.param.x, s.param.t, onSurface);
      worst = Math.max(worst, onSurface.distanceTo(s.p));
    }
    expect(worst).toBeLessThan(1e-6);
    const frac = s.p.y / wave.crestY(s.param.x);
    expect(frac).toBeGreaterThan(0.3);
    expect(frac).toBeLessThan(0.7);
  });

  it('stalling drives frame x-velocity negative and puts you in the tube within 3 s', () => {
    const { s, run, events } = setup();
    run(1); // let the drop-in settle
    let sawNegative = false;
    let tubeAt = -1;
    for (let i = 0; i < 3 * 120 && tubeAt < 0; i++) {
      run(DT, () => ({ stall: true }));
      if (s.v.x < 0) sawNegative = true;
      if (s.inTube) tubeAt = i * DT;
    }
    expect(sawNegative).toBe(true);
    expect(tubeAt).toBeGreaterThanOrEqual(0);
    expect(events.some((e) => e.type === 'tubeEnter')).toBe(true);
  });

  it('holding the stall longer gets you swallowed', () => {
    const { s, run, events } = setup();
    run(1);
    run(12, () => ({ stall: true }));
    expect(s.mode).toBe('wipeout');
    expect(s.wipeoutReason).toBe('swallowed');
    expect(events.at(-1)).toMatchObject({ type: 'wipeout', reason: 'swallowed' });
  });

  it('pump spam yields less speed than rhythmic pumping', () => {
    const spam = setup();
    spam.run(1);
    spam.run(6, (i) => ({ pump: i % 12 === 0 }));
    const rhythm = setup();
    rhythm.run(1);
    rhythm.run(6, (i) => ({ pump: i % 72 === 0 }));
    expect(rhythm.s.v.length()).toBeGreaterThan(spam.s.v.length() + 0.3);
  });

  it('carving toward the lip climbs the face (vs a no-carve control from the identical state)', () => {
    const climb = (carve: number) => {
      const h = setup();
      h.run(1);
      const y0 = h.s.p.y;
      h.run(0.4, () => ({ carve }));
      return h.s.p.y - y0;
    };
    const straight = climb(0);
    expect(climb(1)).toBeGreaterThan(straight + 0.03);
    expect(climb(-1)).toBeLessThan(straight - 0.03);
  });
});
```

with:

```ts
describe('Surfer — riding', () => {
  it('no input: stays on the surface and the curl swallows the rider after 3.5–5.2 s (never under 2 s)', () => {
    const { wave, s, surfer } = setup();
    const onSurface = new Vector3();
    let worst = 0;
    let caught = -1;
    for (let i = 0; i < 20 * 120 && caught < 0; i++) {
      surfer.step(NO_INPUT, DT);
      if (s.mode !== 'riding') caught = s.time;
      else worst = Math.max(worst, wave.profile(s.param.x, s.param.t, onSurface).distanceTo(s.p));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(s.wipeoutReason).toBe('swallowed');
    expect(caught).toBeGreaterThanOrEqual(3.5);
    expect(caught).toBeLessThanOrEqual(5.2);
  });

  it('rhythmic pumping (1/s) plus down-the-line S-turns stays ahead of the curl for 30 s at base peel', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 1 });
    let minX = Infinity;
    for (let i = 0; i < 30 * 120; i++) {
      h.surfer.step(bot(DT), DT);
      if (h.s.time > 2) minX = Math.min(minX, h.s.param.x);
    }
    expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
    expect(minX).toBeGreaterThan(-h.cfg.wave.tubeDepth);
  });

  it('the same lines without pumping lose the wave within 10 s', () => {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    h.run(10, () => bot(DT));
    expect(h.s.mode).toBe('wipeout');
    expect(h.s.wipeoutReason).toBe('swallowed');
  });

  /** Lines + pumps for 20 s with a 1.4× fast section from 8 s (0.5 s ramps, 4 s hold). */
  function fastSection(pumpEvery: number) {
    const h = setup();
    const bot = lineBot(h.surfer, h.wave, { pumpEvery });
    const base = h.cfg.wave.peelSpeed;
    let xStart = NaN;
    let xEnd = NaN;
    for (let i = 0; i < 20 * 120; i++) {
      const u = h.s.time + DT - 8;
      const k = u < 0 || u > 5 ? 0 : u < 0.5 ? u / 0.5 : u > 4.5 ? (5 - u) / 0.5 : 1;
      if (u >= 0 && Number.isNaN(xStart)) xStart = h.s.param.x;
      if (u >= 5 && Number.isNaN(xEnd)) xEnd = h.s.param.x;
      h.surfer.setPeelSpeed(base * (1 + 0.4 * k));
      h.surfer.step(bot(DT), DT);
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    const survived = h.s.mode === 'riding' || h.s.mode === 'airborne';
    return { survived, lost: survived ? xStart - xEnd : Infinity };
  }

  it('a fast section: the base effort loses ≥ 5 m of ground; pumping every 0.6 s survives it and loses less', () => {
    const base = fastSection(1);
    const hard = fastSection(0.6);
    expect(base.lost).toBeGreaterThanOrEqual(5);
    expect(hard.survived).toBe(true);
    expect(hard.lost).toBeLessThan(base.lost - 3);
  });

  it('stalling drives frame x-velocity negative and puts you in the tube within 3 s', () => {
    const { s, run, events } = setup();
    run(1); // let the drop-in settle
    let sawNegative = false;
    let tubeAt = -1;
    for (let i = 0; i < 3 * 120 && tubeAt < 0; i++) {
      run(DT, () => ({ stall: true }));
      if (s.v.x < 0) sawNegative = true;
      if (s.inTube) tubeAt = i * DT;
    }
    expect(sawNegative).toBe(true);
    expect(tubeAt).toBeGreaterThanOrEqual(0);
    expect(events.some((e) => e.type === 'tubeEnter')).toBe(true);
  });

  it('holding the stall longer gets you swallowed', () => {
    const { s, run, events } = setup();
    run(1);
    run(12, () => ({ stall: true }));
    expect(s.mode).toBe('wipeout');
    expect(s.wipeoutReason).toBe('swallowed');
    expect(events.at(-1)).toMatchObject({ type: 'wipeout', reason: 'swallowed' });
  });

  it('stall while carving into the pocket, release as the curl arrives and pump out: a ≥ 1 s barrel, then out and still riding', () => {
    const h = setup();
    const warmUp = lineBot(h.surfer, h.wave, { pumpEvery: 1 });
    const stallLine = lineBot(h.surfer, h.wave, { pumpEvery: 0 });
    const pumpOut = lineBot(h.surfer, h.wave, { pumpEvery: 0.6 });
    let released = false;
    let tube = 0;
    for (let i = 0; i < 16 * 120; i++) {
      if (h.s.time >= 6 && h.s.param.x <= 3) released = true;
      const input = h.s.time < 6 ? warmUp(DT) : released ? pumpOut(DT) : { ...stallLine(DT), stall: true };
      h.surfer.step(input, DT);
      if (h.s.inTube) tube += DT;
      if (h.s.mode === 'wipeout' || h.s.mode === 'kickedOut') break;
    }
    expect(tube).toBeGreaterThanOrEqual(1);
    expect(h.events.some((e) => e.type === 'tubeExit')).toBe(true);
    expect(h.s.mode === 'riding' || h.s.mode === 'airborne').toBe(true);
  });

  it('pump spam yields less speed than rhythmic pumping (same lines)', () => {
    const meanSpeed = (pumpEvery: number) => {
      const h = setup();
      const bot = lineBot(h.surfer, h.wave, { pumpEvery });
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 8 * 120; i++) {
        h.surfer.step(bot(DT), DT);
        if (h.s.time > 2) {
          sum += h.surfer.worldSpeed(h.surfer.peelSpeed);
          n++;
        }
      }
      return sum / n;
    };
    expect(meanSpeed(0.6)).toBeGreaterThan(meanSpeed(0.1) + 1);
  });

  it('a pump on the flats does nothing; on the face it adds speed along the board (vs a no-pump control)', () => {
    const gain = (t: number) => {
      const pumped = trimming(6, 15, t);
      const control = trimming(6, 15, t);
      pumped.surfer.step({ ...NO_INPUT, pump: true }, DT);
      control.surfer.step(NO_INPUT, DT);
      return pumped.surfer.worldSpeed(pumped.surfer.peelSpeed) - control.surfer.worldSpeed(control.surfer.peelSpeed);
    };
    expect(Math.abs(gain(0))).toBeLessThan(0.05);
    expect(gain(0.4)).toBeGreaterThan(1.5);
  });

  /** Mid-face at (15, 0.4), running down the line at world speed `speed`. */
  function trimming(speed: number, x = 15, t = 0.4) {
    const h = setup();
    h.surfer.reset(x, t);
    h.s.v.set(speed - h.surfer.peelSpeed, 0, 0).addScaledVector(h.s.normal, -(speed - h.surfer.peelSpeed) * h.s.normal.x);
    return h;
  }

  it('carving toward the lip climbs the face (vs a no-carve control from the identical state)', () => {
    const climb = (carve: number) => {
      const h = trimming(10);
      const y0 = h.s.p.y;
      h.run(0.4, () => ({ carve }));
      return h.s.p.y - y0;
    };
    const straight = climb(0);
    expect(climb(1)).toBeGreaterThan(straight + 0.1);
    expect(climb(-1)).toBeLessThan(straight - 0.1);
  });

  it.each([8, 15, 25])('from speed, trough → top of the face (85% of the crest) in ≤ 1.5 s (x = %d)', (x) => {
    const h = trimming(10, x, 0.2);
    let top = -1;
    for (let i = 0; i < 3 * 120 && top < 0; i++) {
      h.run(DT, () => ({ carve: 1 }));
      if (h.s.mode === 'airborne' || h.s.p.y >= 0.85 * h.wave.crestY(h.s.param.x)) top = h.s.time;
    }
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(1.5);
  });

  it('the turn radius grows with speed', () => {
    const radius = (speed: number) => {
      const h = trimming(speed, 30, 0.35);
      h.run(DT);
      const h0 = h.s.heading.clone();
      let path = 0;
      for (let i = 0; i < 60; i++) {
        path += h.surfer.worldSpeed(h.surfer.peelSpeed) * DT;
        h.run(DT, () => ({ carve: 1 }));
      }
      return path / h0.angleTo(h.s.heading);
    };
    const r6 = radius(6);
    const r9 = radius(9);
    const r12 = radius(12);
    expect(r9).toBeGreaterThan(r6 * 1.3);
    expect(r12).toBeGreaterThan(r9 * 1.3);
  });

  it('the board points along its motion through the water, even while losing ground to the curl', () => {
    const h = trimming(6); // frame v.x = 6 − Vp < 0
    h.run(DT);
    expect(h.s.v.x).toBeLessThan(0);
    const world = new Vector3(h.s.v.x + h.surfer.peelSpeed, h.s.v.y, h.s.v.z).normalize();
    expect(h.s.heading.x).toBeGreaterThan(0.9);
    expect(h.s.heading.angleTo(world)).toBeLessThan(1e-6);
  });

  it('a faster peel costs the rider ground, not world speed: frame v.x drops by ≈ Δ, v stays on the surface', () => {
    const h = trimming(10);
    const vx0 = h.s.v.x;
    const world0 = h.surfer.worldSpeed(h.surfer.peelSpeed);
    h.surfer.setPeelSpeed(h.cfg.wave.peelSpeed + 3);
    expect(h.surfer.peelSpeed).toBe(h.cfg.wave.peelSpeed + 3);
    expect(h.s.v.x).toBeCloseTo(vx0 - 3, 1);
    expect(h.s.v.dot(h.s.normal)).toBeCloseTo(0, 9);
    expect(h.surfer.worldSpeed(h.surfer.peelSpeed)).toBeCloseTo(world0, 1);
  });
});
```

In `src/surf/physics/Surfer.test.ts`, replace:

```ts
  // x = 15: the open face (apex-armed snap near the top); x = 4: the steep section by the curl (armed at the face edge).
  it.each([15, 4])('snaps when carving through a reversal at the crest (x = %d)', (x) => {
    const h = setup();
    h.surfer.reset(x, 0.4);
    const n = h.wave.normal(x, 0.4);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(3, 0, 0).addScaledVector(up, 3); // reaches the crest below launch speed
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'launched')).toBe(false);
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
  });
```

with:

```ts
  // x = 15: the open face (apex-armed snap near the top); x = 4: the steep section by the curl (armed at the face edge).
  // The climb is given as world motion (along the line, up the face) and arrives below launch speed.
  it.each([
    [15, 3, 3],
    [4, 2, 4],
  ])('snaps when carving through a reversal at the crest (x = %d)', (x, along, upFace) => {
    const h = setup();
    h.surfer.reset(x, 0.4);
    const n = h.wave.normal(x, 0.4);
    const up = new Vector3().crossVectors(n, new Vector3(1, 0, 0)).normalize();
    h.s.v.set(along - h.surfer.peelSpeed, 0, 0).addScaledVector(up, upFace);
    h.run(1.5, () => ({ carve: 1 }));
    expect(h.events.some((e) => e.type === 'launched')).toBe(false);
    expect(h.events.some((e) => e.type === 'snap')).toBe(true);
  });
```

In `src/surf/math/math.test.ts`, replace:

```ts
peelSpeed: 7, tubeDepth
```

with:

```ts
peelSpeed: 8, tubeDepth
```

The two real-mesh camera blocks at the end of `CameraRig.test.ts` assert the old camera against the old physics ("riding straight for 10 s" is impossible by design now: with no input the curl takes the rider in < 5 s). Task 3 rewrites that file with new probes; remove them here:

In `src/surf/camera/CameraRig.test.ts`, replace:

```ts
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { buildWaveGeometry, columnsX } from '../render/waveGeometry';
import { WaveShape } from '../wave/WaveShape';
```

with:

```ts
import { PerspectiveCamera, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
```

In `src/surf/camera/CameraRig.test.ts` (it runs to the end of the file), delete this block:

```ts

describe('CameraRig in the barrel (real wave mesh, real surfer)', () => {
  /**
   * Stall into the tube and ride it. After the chase → tube move the rider must
   * stay visible (no wave surface between camera and board or chest), on screen,
   * and the camera must never be under the water surface.
   */
  function rideTube(releaseAfter: number | null) {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
    const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
    front.updateMatrixWorld();
    const cam = new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, cfg.camera);
    rig.snap(surfer.state, 'left');
    const s = surfer.state;
    const ray = new Raycaster();
    const target = new Vector3();
    const dir = new Vector3();
    const UP = new Vector3(0, 1, 0);
    const ndc = new Vector3();
    const blocked = (h: number) => {
      target.copy(s.p).addScaledVector(s.normal, h);
      dir.subVectors(target, rig.pos);
      const dist = dir.length();
      ray.set(rig.pos, dir.normalize());
      ray.far = dist - 0.2;
      return ray.intersectObject(front, false).length > 0;
    };
    let entered = -1;
    let firstVisible = -1;
    let hiddenAfter = 0;
    let wet = 0;
    let tubeFrames = 0;
    for (let f = 0; f < 60 * 8; f++) {
      const t = entered < 0 ? 0 : (f - entered) / 60;
      const stall = f >= 60 && (releaseAfter === null || entered < 0 || t < releaseAfter);
      for (let k = 0; k < 2; k++) surfer.step({ ...NO_INPUT, stall }, 1 / 120);
      rig.update(s, s.p, 'left', false, 1 / 60);
      if (s.mode !== 'riding' || (entered >= 0 && !s.inTube)) break;
      if (!s.inTube) continue;
      if (entered < 0) entered = f;
      tubeFrames++;
      cam.updateMatrixWorld();
      ndc.copy(s.p).addScaledVector(s.normal, 0.9).project(cam);
      const seen = !blocked(0.2) && !blocked(0.9) && ndc.z < 1 && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9;
      if (seen && firstVisible < 0) firstVisible = (f - entered) / 60;
      if (!seen && firstVisible >= 0) hiddenAfter++;
      ray.set(rig.pos, UP);
      ray.far = 50;
      const above = ray.intersectObject(front, false)[0];
      if (above && above.face!.normal.y > 0) wet++;
    }
    return { tubeFrames, firstVisible, hiddenAfter, wet };
  }

  // With hollowLength 12 the approach face is more open and the move settles at 0.50 s (0.35 s on the old 45 m fade).
  it('holding the stall until swallowed: rider in view within 0.55 s of entering, and stays in view', () => {
    const r = rideTube(null);
    expect(r.tubeFrames).toBeGreaterThan(60);
    expect(r.firstVisible).toBeGreaterThanOrEqual(0);
    expect(r.firstVisible).toBeLessThan(0.55);
    expect(r.hiddenAfter).toBe(0);
    expect(r.wet).toBe(0);
  });

  // Released after 0.3 s the rider now climbs out of the barrel (height rule); 0.6 s commits them to a deep ride.
  it('stall in, then let go and ride deep: the rider stays in view', () => {
    const r = rideTube(0.6);
    expect(r.tubeFrames).toBeGreaterThan(180);
    expect(r.firstVisible).toBeLessThan(0.55);
    expect(r.hiddenAfter).toBe(0);
    expect(r.wet).toBe(0);
  });
});

describe('chase framing on the open face (real wave mesh, real surfer)', () => {
  it('riding straight for 10 s: the lip stays ≥ 1.8 m off the board and the chase camera sees the chest ≥ 90% of frames', () => {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
    const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
    front.updateMatrixWorld();
    const rig = new CameraRig(new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650), cfg.camera);
    rig.snap(surfer.state, 'left');
    const s = surfer.state;
    const ray = new Raycaster();
    const from = new Vector3();
    const dir = new Vector3();
    let frames = 0;
    let chestSeen = 0;
    let minClearance = Infinity;
    for (let f = 0; f < 60 * 10; f++) {
      for (let k = 0; k < 2; k++) surfer.step(NO_INPUT, 1 / 120);
      rig.update(s, s.p, 'left', false, 1 / 60);
      expect(s.mode).toBe('riding');
      // Skip the drop-in (0.5 s): the rider starts at x = 4, t 0.55, right under the lip, and dives to the face.
      if (f < 30 || s.p.x <= 1) continue;
      frames++;
      // Clearance: first wave surface straight out along the normal from just above the board.
      from.copy(s.p).addScaledVector(s.normal, 0.05);
      ray.set(from, s.normal);
      ray.far = 10;
      const hit = ray.intersectObject(front, false)[0];
      minClearance = Math.min(minClearance, hit ? hit.distance + 0.05 : Infinity);
      from.copy(s.p).addScaledVector(s.normal, 0.9);
      dir.subVectors(from, rig.pos);
      const dist = dir.length();
      ray.set(rig.pos, dir.normalize());
      ray.far = dist - 0.2;
      if (ray.intersectObject(front, false).length === 0) chestSeen++;
    }
    expect(frames).toBeGreaterThan(450);
    expect(minClearance).toBeGreaterThanOrEqual(1.8);
    expect(chestSeen / frames).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/surf/physics/Surfer.test.ts src/surf/math/math.test.ts`

Expected: FAIL — `h.surfer.setPeelSpeed is not a function`, `peelSpeed` is 7, the no-input rider never gets swallowed, the S-turn/fast-section/traverse/radius/heading expectations fail.

- [ ] **Step 4: Retune the config**

In `src/surf/config.ts`, replace:

```ts
    peelSpeed: 7,
```

with:

```ts
    peelSpeed: 8,
```

In `src/surf/config.ts`, replace:

```ts
    /** Face lift gain; equilibrium depth fraction = gravity / lift (0.5 → mid-face). */
    lift: 19.62,
    /** Damps sliding back down the face (1/s), settling oscillation; climbing is undamped so speed carries you to the lip. */
    faceDamping: 1.5,
    /** Wave drive gain along +x, multiplied by local steepness (m/s²). */
    drive: 3.25,
    /** Quadratic drag against the water (moving at −Vp in the frame). */
    drag: 0.045,
    stallDragMultiplier: 4,
    /** Carve yaw rate = carveRate / (1 + speed / carveHalfSpeed) (rad/s). */
    carveRate: 3.2,
    carveHalfSpeed: 12,
    /** Speed bled while a carve is held (m/s²). */
    carveBleed: 0.8,
    pumpImpulse: 1.6,
    /** Fixed speed cost per pump: spamming (low efficiency) nets less than rhythm. */
    pumpCost: 0.25,
    pumpPeriod: 0.6,
    /** Upward normal speed at the crest needed to launch (m/s). */
    launchSpeed: 3,
```

with:

```ts
    /** Fraction of the cross-line gravity the rail holds at speed ≥ gripSpeed (0 = no rail, 1 = perfect trim). */
    railGrip: 0.85,
    gripSpeed: 5,
    /** Wave drive gain along +x, multiplied by local steepness (m/s²). */
    drive: 1.8,
    /** Quadratic drag against the water (moving at −Vp in the frame). */
    drag: 0.03,
    stallDragMultiplier: 4,
    /** Carve yaw rate = carveRate / (1 + speed / carveHalfSpeed) (rad/s); turn radius = speed / rate grows with speed. */
    carveRate: 4,
    carveHalfSpeed: 10,
    /** The yaw rate eases toward its target with this time constant (s): a weighty rail. */
    carveLag: 0.12,
    /** Speed bled while a carve is held (m/s²). */
    carveBleed: 0.5,
    pumpImpulse: 3,
    /** Fixed speed cost per pump: spamming (low efficiency) nets less than rhythm. */
    pumpCost: 0.25,
    pumpPeriod: 0.6,
    /** A pump's net gain scales with the face steepness: none below pumpMinSteepness (the flats), full above pumpFullSteepness. */
    pumpMinSteepness: 0.1,
    pumpFullSteepness: 0.5,
    /** Upward normal speed at the crest needed to launch (m/s). */
    launchSpeed: 3,
    /** Reaching the top of the face too slow to launch pushes the rider back down at this speed (m/s). */
    crestShed: 1,
```

- [ ] **Step 5: Rework the riding physics in `Surfer.ts`**

What changes and why (all prototyped):
- **No lift / face damping.** The rider can use the whole face. Speed comes from gravity along the board's line, the pocket drive (`drive × steepness` along +x), pumps and lines.
- **The board runs through the water.** `rel = v − water` with the water sliding along the surface's x-tangent `e1` at −Vp. Drag, rail grip, carving, pumping and the heading all act on `rel` (the board's world velocity). This is also why a rider losing ground no longer points and pumps toward the curl. Projecting −Vp·x̂ instead would give the water an up-face part wherever the face is skewed in x, a hidden lift that pinned slow riders at the lip.
- **Rail grip.** 85% of the cross-line gravity is held once `|rel| ≥ gripSpeed`: a fast board holds its line and sags slowly, a slow one slides down.
- **Weighty carve.** The yaw rate eases toward `carve × carveRate / (1 + |rel| / carveHalfSpeed)` with time constant `carveLag`; turn radius `|rel| / rate` grows with speed (measured 3.2 m at 6 m/s → 5.4 m at 9 m/s → 8.0 m at 12 m/s).
- **Pumps work the face.** The net gain `(pumpImpulse × eff − pumpCost)` scales by `smoothstep(pumpMinSteepness, pumpFullSteepness, steepness)`: nothing on the flats. Without this, pumping alone (no carving) rode the flats forever.
- **Crest shed.** Reaching the top too slow to launch pushes the rider back down at `crestShed` m/s. On the unpitched swell the crest is flat, so the old clamp let a slow rider balance on the ridge.
- **Bottoming out.** At t = 0 (the flats) the component heading further out is removed.
- **Drop-in** at (x 3.5, t 0.5): closer to the curl (the catch lands at 4.8 s), and not under the pitching lip, so the behind camera sees the rider from the first frame.
- **`setPeelSpeed`.** A frame acceleration: frame velocities shift by −Δ along x.

In `src/surf/physics/Surfer.ts`, replace:

```ts
import { clamp, DEG, wrapAngle } from '../math/scalar';
```

with:

```ts
import { clamp, DEG, smoothstep, wrapAngle } from '../math/scalar';
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
const DROP_IN = { x: 4, t: 0.55, along: 2, down: 4 };
```

with:

```ts
const DROP_IN = { x: 3.5, t: 0.5, along: 2, down: 4 };
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
  private readonly axis = new Vector3();
  private anchorT = 0;
```

with:

```ts
  private readonly axis = new Vector3();
  private readonly water = new Vector3();
  private readonly rel = new Vector3();
  private anchorT = 0;
  /** Current peel speed (m/s): the water moves at −vp along x in the wave frame. */
  private vp = 0;
  /** Carve yaw rate (rad/s), easing toward the input's target. */
  private yawRate = 0;
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    s.param.x = x;
    this.crestMemo.x = NaN;
```

with:

```ts
    s.param.x = x;
    this.vp = this.wave.params.peelSpeed;
    this.yawRate = 0;
    this.crestMemo.x = NaN;
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    s.v.copy(this.e1).multiplyScalar(DROP_IN.along).addScaledVector(this.eUp, -DROP_IN.down);
    s.heading.copy(s.v).normalize();
```

with:

```ts
    s.v.copy(this.e1).multiplyScalar(DROP_IN.along).addScaledVector(this.eUp, -DROP_IN.down);
    this.headingFromMotion(s.heading);
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
  step(input: SurferInput, dt: number): void {
```

with:

```ts
  /** Current peel speed (m/s). */
  get peelSpeed(): number {
    return this.vp;
  }

  /**
   * Change the peel speed. The wave frame moves at the peel speed, so a faster peel shifts every
   * frame velocity by −Δ along x (the rider's world velocity is unchanged): the curl gains on them.
   */
  setPeelSpeed(vp: number): void {
    const d = vp - this.vp;
    if (d === 0) return;
    this.vp = vp;
    const s = this.state;
    if (s.mode === 'riding') {
      s.v.x -= d;
      s.v.addScaledVector(s.normal, -s.v.dot(s.normal));
    } else if (s.mode === 'airborne') {
      this.path.vx -= d;
      this.path.va -= d;
      s.v.x -= d;
    }
  }

  step(input: SurferInput, dt: number): void {
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
  /** Crest param and height at column x, memoized (crestT is expensive). */
```

with:

```ts
  /**
   * The board points along its motion through the water: the world velocity v + vp·x̂ (the wave frame
   * only translates, so world directions are frame directions). Kept when that is too slow to tell.
   */
  private headingFromMotion(out: Vector3, horizontal = false): void {
    const v = this.state.v;
    const x = v.x + this.vp;
    const y = horizontal ? 0 : v.y;
    const len = Math.hypot(x, y, v.z);
    if (len > this.cfg.minSpeed) out.set(x / len, y / len, v.z / len);
    else if (horizontal) out.set(out.x, 0, out.z).normalize();
  }

  /** Crest param and height at column x, memoized (crestT is expensive). */
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    // --- forces in the tangent plane ---
    const a = this.acc.set(0, -c.gravity, 0);
    a.addScaledVector(n, -a.dot(n));
    const steep = w.steepness(s.param.x, s.param.t);
    if (!s.floating) {
      const crestY = this.crestAt(s.param.x).y;
      const depth = clamp((crestY - s.p.y) / Math.max(crestY, 0.1), 0, 1);
      a.addScaledVector(this.eUp, c.lift * steep * depth);
      // Damp sliding back down only: climbing keeps its speed, so a fast climb reaches the lip.
      a.addScaledVector(this.eUp, -c.faceDamping * Math.min(0, s.v.dot(this.eUp)));
    }
    a.addScaledVector(this.e1, c.drive * steep);
    const water = this.tmp.set(-w.params.peelSpeed, 0, 0);
    water.addScaledVector(n, -water.dot(n));
    const rel = this.tmp2.subVectors(s.v, water);
    const dragK = c.drag * (s.stalling ? c.stallDragMultiplier : 1);
    a.addScaledVector(rel, -dragK * rel.length());
    const speed0 = s.v.length();
    if (input.carve !== 0 && speed0 > 1e-3) a.addScaledVector(s.v, (-c.carveBleed * Math.abs(input.carve)) / speed0);
    s.v.addScaledVector(a, dt);

    // --- carve: rotate v about the normal; toward the lip = +carve ---
    const sp = s.v.length();
    const omega = c.carveRate / (1 + sp / c.carveHalfSpeed);
    const dir = s.v.dot(this.e1) >= 0 ? 1 : -1;
    const ang = input.carve * omega * dir * dt;
    if (ang !== 0) s.v.applyAxisAngle(n, ang);
    s.turnRate = ang / dt;
    this.trackCarve(input.carve, Math.abs(ang));

    // --- pump: efficiency min(1, since/period), minus a fixed cost ---
    if (input.pump) {
      const eff = Math.min(1, s.sincePump / c.pumpPeriod);
      const target = Math.max(0, sp + c.pumpImpulse * eff - c.pumpCost);
      if (sp > 1e-3) s.v.multiplyScalar(target / sp);
      else s.v.copy(this.e1).multiplyScalar(target);
      s.sincePump = 0;
      this.emit({ type: 'pump', time: s.time, efficiency: eff });
    } else {
      s.sincePump += dt;
    }
```

with:

```ts
    // --- forces in the tangent plane. The water moves at −vp along x in the wave frame; the board
    // runs through it with rel = v − water, which is its world velocity (and its heading). ---
    // The water slides along the surface at constant t (e1), never up or down the face: projecting
    // −vp·x̂ instead would give it an up-face part wherever the face is skewed in x (a hidden lift).
    const water = this.water.copy(this.e1).multiplyScalar(-this.vp);
    const rel = this.rel.subVectors(s.v, water);
    const a = this.acc.set(0, -c.gravity, 0);
    a.addScaledVector(n, -a.dot(n));
    const speed0 = rel.length();
    if (!s.floating && speed0 > 1e-3) {
      // Rail grip: the rail holds the part of gravity across the board's line (fully from gripSpeed
      // up); the part along the line turns height into speed and back, the slip lets it sag.
      const grip = c.railGrip * clamp((speed0 - c.minSpeed) / (c.gripSpeed - c.minSpeed), 0, 1);
      const line = this.tmp2.copy(rel).multiplyScalar(1 / speed0);
      a.multiplyScalar(1 - grip).addScaledVector(line, a.dot(line) * grip);
    }
    const steep = w.steepness(s.param.x, s.param.t);
    a.addScaledVector(this.e1, c.drive * steep);
    const dragK = c.drag * (s.stalling ? c.stallDragMultiplier : 1);
    a.addScaledVector(rel, -dragK * speed0);
    if (input.carve !== 0 && speed0 > 1e-3) a.addScaledVector(rel, (-c.carveBleed * Math.abs(input.carve)) / speed0);
    s.v.addScaledVector(a, dt);
    rel.subVectors(s.v, water);

    // --- carve: rotate the board's line about the normal; toward the lip = +carve. The yaw rate
    // eases toward carve × carveRate / (1 + speed / carveHalfSpeed) with lag carveLag (a weighty
    // rail); the turn radius speed / rate grows with speed. ---
    const sp = rel.length();
    const dir = rel.dot(this.e1) >= 0 ? 1 : -1;
    const target = input.carve * (c.carveRate / (1 + sp / c.carveHalfSpeed)) * dir;
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt / c.carveLag));
    const ang = this.yawRate * dt;
    if (ang !== 0) rel.applyAxisAngle(n, ang);
    s.turnRate = this.yawRate;
    this.trackCarve(input.carve, Math.abs(ang));

    // --- pump: along the board's line, efficiency min(1, since/period), minus a fixed cost. A pump
    // works the face: the net gain scales with the local steepness (a pump on the flats does nothing). ---
    if (input.pump) {
      const eff = Math.min(1, s.sincePump / c.pumpPeriod);
      const face = smoothstep(c.pumpMinSteepness, c.pumpFullSteepness, steep);
      const speed = Math.max(0, sp + (c.pumpImpulse * eff - c.pumpCost) * face);
      if (sp > 1e-3) rel.multiplyScalar(speed / sp);
      else rel.copy(this.e1).multiplyScalar(speed);
      s.sincePump = 0;
      this.emit({ type: 'pump', time: s.time, efficiency: eff });
    } else {
      s.sincePump += dt;
    }
    s.v.addVectors(rel, water);
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
        w.profile(s.param.x, s.param.t, s.p);
        w.normal(s.param.x, s.param.t, n);
        s.v.addScaledVector(n, -s.v.dot(n));
      }
    }
    if (s.v.lengthSq() > c.minSpeed * c.minSpeed) s.heading.copy(s.v).normalize();

    // --- snap arming on the open face: the climb tops out near the crest without reaching the face
    // edge (lift fades to zero there), so the apex of a climb into the top band arms it too.
```

with:

```ts
        w.profile(s.param.x, s.param.t, s.p);
        w.normal(s.param.x, s.param.t, n);
        s.v.addScaledVector(n, -s.v.dot(n));
        if (s.param.t <= 0) {
          // Bottomed out on the flats in front of the wave: the part heading further out is lost.
          this.frameAt(s.param.x, 0);
          const out = s.v.dot(this.eUp);
          if (out < 0) s.v.addScaledVector(this.eUp, -out);
        }
      }
    }
    this.headingFromMotion(s.heading);

    // --- snap arming on the open face: a climb can top out near the crest without reaching the face
    // edge, so the apex of a climb into the top band arms it too.
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    const up = s.v.dot(out);
    if (up > 0) s.v.addScaledVector(out, -up);
```

with:

```ts
    // Too slow to launch: the lip sheds the rider back down the face (no balancing on the ridge).
    const up = s.v.dot(out);
    if (up > -c.crestShed) s.v.addScaledVector(out, -up - c.crestShed);
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    s.turnRate = 0;
    s.stalling = false;
    this.atCrest = false;
    this.snapArmed = false;
    this.nearTop = false;
    this.topPending = false;
    this.grabs = [];
    const hx = s.v.x;
    const hz = s.v.z;
    const h = Math.hypot(hx, hz);
    if (h > 1e-3) s.heading.set(hx / h, 0, hz / h);
    else s.heading.set(s.heading.x, 0, s.heading.z).normalize();
```

with:

```ts
    s.turnRate = 0;
    this.yawRate = 0;
    s.stalling = false;
    this.atCrest = false;
    this.snapArmed = false;
    this.nearTop = false;
    this.topPending = false;
    this.grabs = [];
    this.headingFromMotion(s.heading, true);
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    if (a.kind === 'drop') s.v.addScaledVector(this.eUp, Math.min(0, a.vu));
    if (s.v.lengthSq() > 1e-6) s.heading.copy(s.v).normalize();
```

with:

```ts
    if (a.kind === 'drop') s.v.addScaledVector(this.eUp, Math.min(0, a.vu));
    this.headingFromMotion(s.heading);
```

In `src/surf/physics/Surfer.ts`, replace:

```ts
    s.v.copy(this.e1).multiplyScalar(a.va).addScaledVector(this.eUp, vu).multiplyScalar(c.landingSpeedKeep);
    if (s.v.lengthSq() > 1e-6) s.heading.copy(s.v).normalize();
```

with:

```ts
    s.v.copy(this.e1).multiplyScalar(a.va).addScaledVector(this.eUp, vu).multiplyScalar(c.landingSpeedKeep);
    this.headingFromMotion(s.heading);
```

- [ ] **Step 6: Expose the new tunables in the debug panel**

In `src/surf/game/debugParams.ts`, replace:

```ts
  ['physics.lift', 10, 30, 0.1],
  ['physics.faceDamping', 0, 4, 0.1],
```

with:

```ts
  ['physics.railGrip', 0, 1, 0.01],
  ['physics.gripSpeed', 1, 10, 0.5],
```

In `src/surf/game/debugParams.ts`, replace:

```ts
  ['physics.carveHalfSpeed', 4, 30, 1],
```

with:

```ts
  ['physics.carveHalfSpeed', 4, 30, 1],
  ['physics.carveLag', 0.02, 0.5, 0.01],
```

In `src/surf/game/debugParams.ts`, replace:

```ts
  ['physics.pumpImpulse', 0, 4, 0.1],
  ['physics.pumpCost', 0, 1, 0.05],
```

with:

```ts
  ['physics.pumpImpulse', 0, 5, 0.1],
  ['physics.pumpCost', 0, 1, 0.05],
  ['physics.pumpFullSteepness', 0.2, 1, 0.05],
  ['physics.crestShed', 0, 3, 0.1],
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/surf/physics src/surf/math`

Expected: PASS — including no-input catch 4.8 s, 30 s S-turn ride, fast section (base effort loses ≈ 11.6 m, pumping every 0.6 s survives losing ≈ 6.3 m), barrel 2.3 s then out, traverse 0.8–1.0 s, radius growth. All existing air / floater / snap / kick-out tests still pass unchanged.

Run: `npx vitest run src/surf`

Expected: PASS (debug-panel ranges include the new defaults).

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/surf/physics/Surfer.ts \
  src/surf/physics/Surfer.test.ts \
  src/surf/physics/lineBot.ts \
  src/surf/config.ts \
  src/surf/math/math.test.ts \
  src/surf/game/debugParams.ts \
  src/surf/camera/CameraRig.test.ts
git commit -m "$(cat <<'EOF'
feat(surf): the break chases you — no sticky face, rail carving, face pumps, Vp 8

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Camera: behind the rider from the curl side, tube cut, shake

**Files:**
- Replace: `src/surf/camera/CameraRig.ts`
- Create: `src/surf/wave/impact.ts`
- Modify: `src/surf/config.ts` (`camera` block)
- Modify: `src/surf/game/debugParams.ts` (camera sliders)
- Modify: `src/surf/physics/input.ts` (key mapping back for the new camera)
- Modify: `src/surf/game/SurfGame.ts` (rig gets the wave and the sim clock; `hook.shot`)
- Modify: `src/surf/game/debugHook.ts` (`shot`)
- Test: `src/surf/camera/CameraRig.test.ts` (replaced), `src/surf/physics/input.test.ts` (restored), `src/surf/game/SurfGame.test.ts`

**Interfaces:**
- Consumes: `lineBot` (Task 2, tests only), `Surfer` physics (Task 2), `sideSign` (Task 1).
- Produces:
  - `type CameraShot = 'chase' | 'tube' | 'underwater'`; `interface CrestProbe { crestY(x: number): number }`.
  - `cameraGoal(s: Pick<SurferState, 'p' | 'normal' | 'mode' | 'launchKind'>, side: Side, shot: CameraShot, wave: CrestProbe | null, out: CameraGoal, tubeMinX?: number): CameraGoal` (VIEW coordinates).
  - `new CameraRig(camera: PerspectiveCamera, cfg: SurfConfig['camera'], wave: CrestProbe & { params: { tubeDepth: number } })`; `rig.update(s, renderP, side, underwater, dt, time = 0)`; `rig.shot: CameraShot`; `rig.snap(s, side)`.
  - `shakeOffset(t: number, amp: number, out: Vector3): Vector3`; `shakeAmplitude(x: number, tubeDepth: number, maxAmp: number, fade = 8): number`.
  - `impactDistance(x: number, tubeDepth: number): number` in `src/surf/wave/impact.ts` (used again by audio in Task 5).
  - `SURF_CONFIG.camera`: `stiffness 4, lookStiffness 6, fov 62, tubeCutIn 0.2, tubeCutOut 0.15, tubeStiffness 20, pocketX 3, pocketHeightFrac 0.6, tubeMinX −6, shake 0.06` (`tubeBlendFloor` / `tubeBlendRate` removed).
  - `SurfDebugHook.shot: string`.

- [ ] **Step 1: Write the failing camera tests**

The new probes ride the real `Surfer` on the real wave mesh with the real rig (canonical frame = LEFT) and check every rendered frame. The design's Verification 5 is covered by the first probe (a 30 s S-turn ride). The other probes cover the no-input ride, where the tube view takes over as the curl arrives, and a barrel. A final test ties the → key to the side of the screen the lip is on, for both sides.

The tube view is a **cut**, entered after 0.2 s in the barrel and left 0.15 s after exiting. The chase camera sits above the lip, and the barrel's only opening is the mouth ahead of the rider, so any glide from the chase position into the barrel behind the rider would pass through the lip. The tube view also covers riding low in the pocket (x ≤ 3, below 0.6 × crest height). There the pitching lip hides the rider from any above-the-crest viewpoint: prototyped chase visibility in the pocket was 80% without this rule.

Replace the whole of `src/surf/camera/CameraRig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { SURF_CONFIG, type Side } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { carveFromKeys, NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { buildWaveGeometry, columnsX } from '../render/waveGeometry';
import { frameToView } from '../wave/mirror';
import { WaveShape } from '../wave/WaveShape';
import { CAMERA_FAR, CAMERA_OFFSETS, cameraGoal, CameraRig, shakeAmplitude, shakeOffset } from './CameraRig';

function world() {
  const cfg = structuredClone(SURF_CONFIG);
  const wave = new WaveShape(cfg.wave);
  const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
  return { cfg, wave, surfer, s: surfer.state };
}
const goal = () => ({ pos: new Vector3(), look: new Vector3() });

describe('cameraGoal', () => {
  it('chase: behind the rider on the curl side, in front of the face, above the local crest, looking down the line', () => {
    const { wave, s } = world(); // canonical frame = a LEFT: the rider travels +x
    const g = cameraGoal(s, 'left', 'chase', wave, goal());
    expect(g.pos.x).toBeLessThan(s.p.x);
    expect(g.pos.z).toBeGreaterThan(s.p.z);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(g.pos.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(s.p.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.look.x).toBeGreaterThan(s.p.x);
  });
  it('mirrors exactly for a RIGHT', () => {
    const { wave, s } = world();
    for (const shot of ['chase', 'tube', 'underwater'] as const) {
      const l = cameraGoal(s, 'left', shot, wave, goal());
      const r = cameraGoal(s, 'right', shot, wave, goal());
      expect(r.pos.x).toBeCloseTo(-l.pos.x, 9);
      expect(r.pos.y).toBeCloseTo(l.pos.y, 9);
      expect(r.pos.z).toBeCloseTo(l.pos.z, 9);
      expect(r.look.x).toBeCloseTo(-l.look.x, 9);
    }
  });
  it('tube: inside the barrel behind the rider (off the face along its normal), looking out down the line', () => {
    const { wave, s } = world();
    s.p.set(-2, 0.8, 2);
    s.normal.set(0, 0.3, 1).normalize();
    const g = cameraGoal(s, 'left', 'tube', wave, goal());
    expect(g.pos.x).toBeCloseTo(s.p.x - CAMERA_OFFSETS.tube.back, 9);
    expect(g.pos.z).toBeGreaterThan(s.p.z);
    expect(g.look.x).toBeGreaterThan(s.p.x);
  });
  it('never puts a tube camera behind tubeMinX (the barrel is closed there)', () => {
    const { wave, s } = world();
    s.p.x = -4.5;
    expect(cameraGoal(s, 'left', 'tube', wave, goal(), -6).pos.x).toBe(-6);
    expect(cameraGoal(s, 'right', 'tube', wave, goal(), -6).pos.x).toBe(6);
    expect(cameraGoal(s, 'left', 'chase', wave, goal(), -6).pos.x).toBeCloseTo(-4.5 + CAMERA_OFFSETS.chase.pos.x, 9);
  });
  it('pulls back and up by ~40% in a trick air', () => {
    const { s } = world();
    const ground = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    const air = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    expect(air.length() / ground.length()).toBeGreaterThan(1.35);
    expect(air.y).toBeGreaterThan(ground.y);
  });
  it('keeps the riding camera in a silent air (launchKind null)', () => {
    const { wave, s } = world();
    const ground = cameraGoal(s, 'left', 'chase', wave, goal()).pos.clone();
    s.mode = 'airborne';
    s.launchKind = null;
    expect(cameraGoal(s, 'left', 'chase', wave, goal()).pos.distanceTo(ground)).toBeCloseTo(0, 9);
  });
});

describe('camera shake', () => {
  it('is full over the impact zone [−D, 0] and fades to nothing 8 m away', () => {
    expect(shakeAmplitude(-2, 5, 0.06)).toBe(0.06);
    expect(shakeAmplitude(4, 5, 0.06)).toBeCloseTo(0.03, 9);
    expect(shakeAmplitude(-9, 5, 0.06)).toBeCloseTo(0.03, 9);
    expect(shakeAmplitude(20, 5, 0.06)).toBe(0);
  });
  it('is deterministic in sim time and bounded by amp·√3', () => {
    const a = shakeOffset(3.21, 0.1, new Vector3());
    expect(shakeOffset(3.21, 0.1, new Vector3()).equals(a)).toBe(true);
    for (let t = 0; t < 5; t += 0.013) expect(shakeOffset(t, 0.1, new Vector3()).length()).toBeLessThanOrEqual(0.1 * Math.sqrt(3) + 1e-9);
    expect(shakeOffset(1, 0, new Vector3()).length()).toBe(0);
  });
});

describe('CameraRig', () => {
  it('eases toward the chase goal', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    rig.snap(s, 'left');
    s.p.x += 5;
    const before = rig.pos.clone();
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.x).toBeGreaterThan(before.x);
    for (let i = 0; i < 600; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'chase', wave, goal()).pos)).toBeLessThan(0.01);
  });
  it('cuts to the tube view after tubeCutIn s in the barrel and back after tubeCutOut s out of it', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    rig.snap(s, 'left');
    s.inTube = true;
    s.p.set(-1, 0.6, 2);
    const frames = (sec: number) => {
      for (let i = 0; i < Math.round(sec * 60); i++) rig.update(s, s.p, 'left', false, 1 / 60);
    };
    frames(SURF_CONFIG.camera.tubeCutIn - 0.05);
    expect(rig.shot).toBe('chase');
    frames(0.1);
    expect(rig.shot).toBe('tube');
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'tube', wave, goal(), SURF_CONFIG.camera.tubeMinX).pos)).toBeLessThan(1e-9); // a cut, not a glide
    s.inTube = false;
    s.p.set(6, 1.2, 2.5); // out on the open face (beyond the pocket)
    frames(SURF_CONFIG.camera.tubeCutOut + 0.05);
    expect(rig.shot).toBe('chase');
  });
  it("the underwater cut drops the springs' velocity: the next shot eases from rest", () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    rig.snap(s, 'left');
    s.p.x += 40;
    for (let i = 0; i < 10; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    s.mode = 'wipeout';
    rig.update(s, s.p, 'left', true, 1 / 60);
    const cut = rig.pos.clone();
    s.mode = 'riding';
    s.p.x -= 10;
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.x).toBeLessThan(cut.x);
  });
  it('extends the far plane past the sky dome (600 m) and sun sprite (500 m)', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    new CameraRig(cam, SURF_CONFIG.camera, new WaveShape(structuredClone(SURF_CONFIG.wave)));
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(650);
    expect(cam.far).toBeGreaterThanOrEqual(650);
  });
});

/**
 * Ride the real surfer against the real wave mesh with the real rig (canonical frame = LEFT) and
 * probe every rendered frame: where the camera is, whether it is under the water, and whether the
 * rider's chest is on screen with no wave surface in between.
 */
function probe(drive: (surfer: Surfer, wave: WaveShape) => (dt: number) => SurferInput, seconds: number) {
  const { cfg, wave, surfer, s } = world();
  const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
  front.updateMatrixWorld();
  const cam = new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650);
  const rig = new CameraRig(cam, cfg.camera, wave);
  rig.snap(s, 'left');
  const input = drive(surfer, wave);
  const ray = new Raycaster();
  const chest = new Vector3();
  const dir = new Vector3();
  const ndc = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const r = { chase: 0, chaseSeen: 0, behind: 0, lookingDownTheLine: 0, aboveCrest: 0, tube: 0, tubeSeen: 0, frames: 0, seen: 0, wet: 0 };
  for (let f = 0; f < seconds * 60; f++) {
    for (let k = 0; k < 2; k++) surfer.step(input(1 / 120), 1 / 120);
    rig.update(s, s.p, 'left', false, 1 / 60, s.time);
    if (s.mode !== 'riding' && s.mode !== 'airborne') break;
    cam.updateMatrixWorld();
    chest.copy(s.p).addScaledVector(s.normal, 0.9);
    dir.subVectors(chest, cam.position);
    const dist = dir.length();
    ray.set(cam.position, dir.normalize());
    ray.far = dist - 0.2;
    ndc.copy(chest).project(cam);
    const seen = ray.intersectObject(front, false).length === 0 && ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95;
    ray.set(cam.position, UP);
    ray.far = 50;
    const above = ray.intersectObject(front, false)[0];
    if (above && above.face!.normal.y > 0) r.wet++;
    r.frames++;
    if (seen) r.seen++;
    if (rig.shot === 'chase') {
      r.chase++;
      if (seen) r.chaseSeen++;
      if (cam.position.x < s.p.x) r.behind++;
      if (rig.look.x > cam.position.x) r.lookingDownTheLine++;
      if (cam.position.y > wave.crestY(cam.position.x)) r.aboveCrest++;
    } else if (rig.shot === 'tube') {
      r.tube++;
      if (seen) r.tubeSeen++;
    }
  }
  return r;
}

describe('CameraRig on the real wave (ray / visibility probes)', () => {
  it('a 30 s S-turn ride: every chase frame is behind the rider, looking down the line, above the crest; the rider is seen ≥ 90%; never under water', () => {
    const r = probe((surfer, wave) => lineBot(surfer, wave, { pumpEvery: 1 }), 30);
    expect(r.chase).toBeGreaterThan(1500);
    expect(r.behind).toBe(r.chase);
    expect(r.lookingDownTheLine).toBe(r.chase);
    expect(r.aboveCrest).toBe(r.chase);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.wet).toBe(0);
  });
  it('no input until swallowed: chase then tube view, rider seen ≥ 90% of chase frames and ≥ 90% overall, never under water', () => {
    const r = probe(() => () => NO_INPUT, 10);
    expect(r.tube).toBeGreaterThan(0);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.seen / r.frames).toBeGreaterThanOrEqual(0.9);
    expect(r.wet).toBe(0);
  });
  it('a barrel (stall while carving, release as the curl arrives, pump out): the tube view sees the rider ≥ 90%, never under water', () => {
    const r = probe((surfer, wave) => {
      const warmUp = lineBot(surfer, wave, { pumpEvery: 1 });
      const stallLine = lineBot(surfer, wave, { pumpEvery: 0 });
      const pumpOut = lineBot(surfer, wave, { pumpEvery: 0.6 });
      let released = false;
      return (dt) => {
        const st = surfer.state;
        if (st.time >= 6 && st.param.x <= 3) released = true;
        return st.time < 6 ? warmUp(dt) : released ? pumpOut(dt) : { ...stallLine(dt), stall: true };
      };
    }, 16);
    expect(r.tube).toBeGreaterThan(60);
    expect(r.tubeSeen / r.tube).toBeGreaterThanOrEqual(0.9);
    expect(r.wet).toBe(0);
  });
});

describe('screen-relative carving matches the camera', () => {
  it.each(['left', 'right'] as const)('on a %s, the → key (carve +1 = toward the lip) is the side of the screen the lip is on', (side: Side) => {
    const { wave, surfer, s } = world();
    const bot = lineBot(surfer, wave, { pumpEvery: 1 });
    for (let i = 0; i < 3 * 120; i++) surfer.step(bot(1 / 120), 1 / 120);
    const cam = new PerspectiveCamera(SURF_CONFIG.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, SURF_CONFIG.camera, wave);
    rig.snap(s, side);
    cam.updateMatrixWorld();
    // Up the face at the rider = toward the lip: the surface point a little higher in t.
    const lip = wave.profile(s.param.x, Math.min(1, s.param.t + 0.05));
    const riderScreen = frameToView(s.p, side, new Vector3()).project(cam).x;
    const lipScreen = frameToView(lip, side, new Vector3()).project(cam).x;
    const lipOnRight = lipScreen > riderScreen;
    expect(carveFromKeys(false, true, side) === 1).toBe(lipOnRight);
  });
});
```

The new camera looks down the line from behind, so on a RIGHT (mirrored frame) the face rises on screen-right: → = toward the lip on a RIGHT again. Restore the input tests to their pre-Task-1 content:

Replace the whole of `src/surf/physics/input.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ActionState } from '@/shared/input/ActionState';
import { EventBus, type SurfEvent } from './events';
import { carveFromKeys, readSurferInput, SURF_BINDINGS, type SurfAction } from './input';

describe('carveFromKeys (screen-relative)', () => {
  it('→ turns toward the lip on a RIGHT and away on a LEFT', () => {
    expect(carveFromKeys(false, true, 'right')).toBe(1);
    expect(carveFromKeys(false, true, 'left')).toBe(-1);
    expect(carveFromKeys(true, false, 'right')).toBe(-1);
    expect(carveFromKeys(true, true, 'right')).toBe(0);
  });
});

describe('readSurferInput', () => {
  it('maps actions to a physics input with edges and the first held grab', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.keyDown('Space');
    a.keyDown('KeyS');
    a.keyDown('KeyD');
    a.keyDown('ArrowDown');
    a.tick();
    const i = readSurferInput(a, 'right');
    expect(i).toEqual({ carve: 1, spin: 1, pump: false, stall: true, ollie: true, grab: 'stalefish' });
    a.tick();
    expect(readSurferInput(a, 'left').ollie).toBe(false);
    expect(readSurferInput(a, 'left').carve).toBe(-1);
  });

  it('spin is screen-relative like carving: → spins the same way on screen on both sides', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.tick();
    expect(readSurferInput(a, 'right').spin).toBe(1);
    expect(readSurferInput(a, 'left').spin).toBe(-1);
    a.keyUp('ArrowRight');
    a.keyDown('ArrowLeft');
    a.tick();
    expect(readSurferInput(a, 'right').spin).toBe(-1);
    expect(readSurferInput(a, 'left').spin).toBe(1);
  });
});

describe('EventBus', () => {
  it('delivers typed events to type and wildcard subscribers, and unsubscribes', () => {
    const bus = new EventBus<SurfEvent>();
    const snap = vi.fn();
    const any = vi.fn();
    const off = bus.on('snap', snap);
    bus.onAny(any);
    bus.emit({ type: 'snap', time: 1 });
    bus.emit({ type: 'tubeEnter', time: 2 });
    expect(snap).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
    off();
    bus.emit({ type: 'snap', time: 3 });
    expect(snap).toHaveBeenCalledTimes(1);
  });
});
```

In `src/surf/game/SurfGame.test.ts`, replace:

```ts
    expect(rigUpdate).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'right', false, expect.any(Number));
```

with:

```ts
    expect(rigUpdate).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'right', false, expect.any(Number), expect.any(Number));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surf/camera src/surf/physics/input.test.ts src/surf/game/SurfGame.test.ts`

Expected: FAIL — `shakeAmplitude` / `shakeOffset` are not exported, `cameraGoal` has the old signature, the chase goal is on the shoulder side, the key mapping is inverted, `rig.update` gets 5 arguments.

- [ ] **Step 3: Implement the camera**

Create `src/surf/wave/impact.ts`:

```ts
/** Distance (m, along x) from frame x to the impact zone x ∈ [−D, 0], where the lip lands. */
export function impactDistance(x: number, tubeDepth: number): number {
  return x > 0 ? x : x < -tubeDepth ? -tubeDepth - x : 0;
}
```

Replace the whole of `src/surf/camera/CameraRig.ts`:

```ts
import { Vector3, type PerspectiveCamera } from 'three';
import type { Side, SurfConfig } from '../config';
import { springStepVec3 } from '../math/spring';
import type { SurferState } from '../physics/Surfer';
import { impactDistance } from '../wave/impact';
import { frameToView } from '../wave/mirror';

/**
 * Offsets from the surfer in the canonical frame (+x = down the line toward the shoulder, +z shore).
 * The chase sits BEHIND the rider on the curl side, in front of the face and high, looking past the
 * rider down the line; its height is floored above the local crest so it never clips the lip.
 */
export const CAMERA_OFFSETS = {
  chase: { pos: new Vector3(-6, 2.2, 2), look: new Vector3(5, 0.4, 0) },
  /** Camera floor above the crest height under the camera and under the rider (m). */
  crestClearance: 1.2,
  /** Tube: inside the barrel behind the rider (along the rider's normal = into the tube), looking out the mouth. */
  tube: { back: 2.2, lift: 0.8, look: new Vector3(4, 0.5, 0) },
  underwater: { pos: new Vector3(2, -1.4, 3), look: new Vector3(0, -0.6, 0) },
  /** Air: chase offset × this, plus `airLift` up. */
  airScale: 1.4,
  airLift: 1.5,
} as const;

/** Camera far plane (m): must clear the sky dome (600 m) and sun sprite (500 m). */
export const CAMERA_FAR = 650;

export interface CameraGoal {
  pos: Vector3;
  look: Vector3;
}

export type CameraShot = 'chase' | 'tube' | 'underwater';

/** What the goal needs from the wave: the crest height of a column (frame x). */
export interface CrestProbe {
  crestY(x: number): number;
}

type Subject = Pick<SurferState, 'p' | 'normal' | 'mode' | 'launchKind'>;

/**
 * Where the camera wants to be (VIEW coordinates, i.e. already mirrored) for a shot.
 * Only a TRICK air (launchKind set) pulls back; silent floater mount/dismount/drop airs do not.
 * `tubeMinX` (frame x) keeps the tube camera inside the barrel (it is closed behind x = −D).
 */
export function cameraGoal(s: Subject, side: Side, shot: CameraShot, wave: CrestProbe | null, out: CameraGoal, tubeMinX = -Infinity): CameraGoal {
  const O = CAMERA_OFFSETS;
  if (shot === 'underwater') {
    out.pos.copy(s.p).add(O.underwater.pos);
    out.look.copy(s.p).add(O.underwater.look);
  } else if (shot === 'tube') {
    out.pos.copy(s.p).addScaledVector(s.normal, O.tube.lift);
    out.pos.x = Math.max(out.pos.x - O.tube.back, tubeMinX);
    out.look.copy(s.p).add(O.tube.look);
  } else {
    out.pos.copy(O.chase.pos);
    if (s.mode === 'airborne' && s.launchKind !== null) {
      out.pos.multiplyScalar(O.airScale);
      out.pos.y += O.airLift;
    }
    out.pos.add(s.p);
    if (wave) out.pos.y = Math.max(out.pos.y, wave.crestY(out.pos.x) + O.crestClearance, wave.crestY(s.p.x) + O.crestClearance);
    out.look.copy(s.p).add(O.chase.look);
  }
  frameToView(out.pos, side, out.pos);
  frameToView(out.look, side, out.look);
  return out;
}

/** Deterministic camera shake (m) at sim time `t`: a sum of incommensurate sines, |offset| ≤ amp·√3. */
export function shakeOffset(t: number, amp: number, out: Vector3): Vector3 {
  return out.set(
    amp * (0.6 * Math.sin(t * 37.1) + 0.4 * Math.sin(t * 61.7 + 1.3)),
    amp * (0.6 * Math.sin(t * 43.3 + 2.1) + 0.4 * Math.sin(t * 71.9)),
    amp * (0.6 * Math.sin(t * 29.3 + 0.7) + 0.4 * Math.sin(t * 53.9 + 2.9)),
  );
}

/**
 * Shake amplitude for a camera at frame x: full within the impact zone x ∈ [−D, 0] (where the lip
 * lands), fading to zero `fade` metres outside it.
 */
export function shakeAmplitude(x: number, tubeDepth: number, maxAmp: number, fade = 8): number {
  return maxAmp * Math.max(0, 1 - impactDistance(x, tubeDepth) / fade);
}

/**
 * Critically damped springs on camera position and look target. The tube view is a CUT (the chase
 * camera sits above the lip; any glide into the barrel would pass through it), entered after the rider
 * has been in the tube for `tubeCutIn` s and left after `tubeCutOut` s out of it; the underwater
 * wipeout is also a cut.
 */
export class CameraRig {
  readonly pos = new Vector3();
  readonly look = new Vector3();
  shot: CameraShot = 'chase';
  private readonly vPos = new Vector3();
  private readonly vLook = new Vector3();
  private readonly shake = new Vector3();
  private inFor = 0;
  private outFor = 0;
  private readonly goal: CameraGoal = { pos: new Vector3(), look: new Vector3() };
  private readonly subject: Subject = { p: new Vector3(), normal: new Vector3(0, 1, 0), mode: 'riding', launchKind: null };

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly cfg: SurfConfig['camera'],
    private readonly wave: CrestProbe & { params: { tubeDepth: number } },
  ) {
    if (camera.far < CAMERA_FAR) {
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }

  snap(s: SurferState, side: Side): void {
    this.shot = 'chase';
    this.inFor = 0;
    this.outFor = 0;
    this.track(s, s.p);
    cameraGoal(this.subject, side, 'chase', this.wave, this.goal);
    this.cut();
    this.apply(0);
  }

  /** `renderP` = the interpolated surfer position being drawn; `time` = sim clock (drives the shake). */
  update(s: SurferState, renderP: Vector3, side: Side, underwater: boolean, dt: number, time = 0): void {
    const c = this.cfg;
    // The tube view also covers riding low in the pocket, under the pitching lip: from above the
    // crest the lip hides the rider there.
    const tubed = s.mode === 'riding' && (s.inTube || (s.p.x <= c.pocketX && s.p.x >= -this.wave.params.tubeDepth && s.p.y < c.pocketHeightFrac * this.wave.crestY(s.p.x)));
    this.inFor = tubed ? this.inFor + dt : 0;
    this.outFor = tubed ? 0 : this.outFor + dt;
    const shot: CameraShot = underwater ? 'underwater' : this.shot === 'tube' ? (this.outFor >= c.tubeCutOut ? 'chase' : 'tube') : this.inFor >= c.tubeCutIn ? 'tube' : 'chase';
    this.track(s, renderP);
    cameraGoal(this.subject, side, shot, this.wave, this.goal, c.tubeMinX);
    if (shot !== this.shot || shot === 'underwater') this.cut();
    else {
      const k = shot === 'tube' ? c.tubeStiffness : c.stiffness;
      springStepVec3(this.pos, this.vPos, this.goal.pos, k, dt);
      springStepVec3(this.look, this.vLook, this.goal.look, shot === 'tube' ? c.tubeStiffness : c.lookStiffness, dt);
    }
    this.shot = shot;
    const x = side === 'right' ? -this.pos.x : this.pos.x;
    this.apply(shot === 'underwater' ? 0 : shakeAmplitude(x, this.wave.params.tubeDepth, c.shake), time);
  }

  private track(s: SurferState, p: Vector3): void {
    this.subject.p.copy(p);
    this.subject.normal.copy(s.normal);
    this.subject.mode = s.mode;
    this.subject.launchKind = s.launchKind;
  }

  /** Hard cut to the goal: no spring velocity carries over into the new shot. */
  private cut(): void {
    this.pos.copy(this.goal.pos);
    this.look.copy(this.goal.look);
    this.vPos.set(0, 0, 0);
    this.vLook.set(0, 0, 0);
  }

  private apply(amp: number, time = 0): void {
    shakeOffset(time, amp, this.shake);
    this.camera.position.copy(this.pos).add(this.shake);
    this.camera.lookAt(this.look);
  }
}
```

In `src/surf/config.ts`, replace:

```ts
  camera: {
    stiffness: 4.5,
    lookStiffness: 7,
    fov: 62,
    /** Tube blend target on entry (rises with depth to 1); higher = the camera commits to the barrel sooner. */
    tubeBlendFloor: 0.9,
    /** Tube blend spring rate (1/s, ≈ 2 / settle time). */
    tubeBlendRate: 12,
    /** Position/look spring rate at full tube blend (lerps from `stiffness`). */
    tubeStiffness: 20,
    /** Frame x the tube camera never goes behind: the barrel is too thin to see from past x ≈ −4.5. */
    tubeMinX: -4,
  },
```

with:

```ts
  camera: {
    /** Chase position spring rate (1/s, ≈ 2 / settle time): weighty but responsive. */
    stiffness: 4,
    lookStiffness: 6,
    fov: 62,
    /** The tube view cuts in after the rider has been in the barrel this long (s) … */
    tubeCutIn: 0.2,
    /** … and back out after this long out of it (s). */
    tubeCutOut: 0.15,
    /** Position/look spring rate in the tube view (tight: the barrel is small). */
    tubeStiffness: 20,
    /** Riding at x ≤ pocketX below pocketHeightFrac × crest height (under the lip) also uses the tube view. */
    pocketX: 3,
    pocketHeightFrac: 0.6,
    /** Frame x the tube camera never goes behind: the closed barrel collapses into foam past x ≈ −D − 1. */
    tubeMinX: -6,
    /** Peak camera shake (m) in the impact zone where the lip lands. */
    shake: 0.06,
  },
```

In `src/surf/game/debugParams.ts`, replace:

```ts
  ['camera.tubeBlendFloor', 0, 1, 0.05],
  ['camera.tubeBlendRate', 2, 30, 0.5],
  ['camera.tubeStiffness', 2, 40, 1],
```

with:

```ts
  ['camera.tubeCutIn', 0, 1, 0.05],
  ['camera.tubeCutOut', 0, 1, 0.05],
  ['camera.tubeStiffness', 2, 40, 1],
  ['camera.shake', 0, 0.3, 0.01],
```

In `src/surf/physics/input.ts`, replace:

```ts
/**
 * Screen-relative carve: the chase camera sits on the shoulder side of the canonical
 * frame (a LEFT), so on a LEFT the lip is screen-right; the RIGHT is mirrored, so →
 * turns down the face. (Task 3's behind-the-rider camera flips this back.)
 */
export function carveFromKeys(left: boolean, right: boolean, side: Side): number {
  const raw = (right ? 1 : 0) - (left ? 1 : 0);
  return side === 'left' ? raw : -raw;
}
```

with:

```ts
/**
 * Screen-relative carve: the chase camera sits behind the rider looking down the
 * line, so on a RIGHT the face (and the lip) rises on screen-right and → turns
 * toward the lip; on a LEFT the face is on screen-left, so → turns down the face.
 */
export function carveFromKeys(left: boolean, right: boolean, side: Side): number {
  const raw = (right ? 1 : 0) - (left ? 1 : 0);
  return side === 'right' ? raw : -raw;
}
```

In `src/surf/game/debugHook.ts`, replace:

```ts
  fps: number;
}
```

with:

```ts
  fps: number;
  /** Camera shot: 'chase' | 'tube' | 'underwater'. */
  shot: string;
}
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
triangles: 0, fps: 60 };
```

with:

```ts
triangles: 0, fps: 60, shot: 'chase' };
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.rig = new CameraRig(this.camera, SURF_CONFIG.camera);
```

with:

```ts
    this.rig = new CameraRig(this.camera, SURF_CONFIG.camera, this.wave);
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.rig.update(s, this.renderP, this.side, underwater, dt);
```

with:

```ts
    this.rig.update(s, this.renderP, this.side, underwater, dt, this.waterTime);
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    hook.fps = Math.round(this.fps);
```

with:

```ts
    hook.fps = Math.round(this.fps);
    hook.shot = this.rig.shot;
```

The shake is driven by the water clock (`waterTime`), which only advances with the sim, so a pause freezes it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surf/camera src/surf/physics/input.test.ts src/surf/game/SurfGame.test.ts`

Expected: PASS. Prototyped probe results: S-turn ride 1800/1800 chase frames behind + looking down the line + above the crest, rider seen 100%; no-input ride 100% chase / 100% tube; barrel ride 100% of tube-view frames; 0 wet frames anywhere.

Run: `npx vitest run src/surf`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/surf/camera/CameraRig.ts \
  src/surf/camera/CameraRig.test.ts \
  src/surf/wave/impact.ts \
  src/surf/config.ts \
  src/surf/game/debugParams.ts \
  src/surf/physics/input.ts \
  src/surf/physics/input.test.ts \
  src/surf/game/SurfGame.ts \
  src/surf/game/SurfGame.test.ts \
  src/surf/game/debugHook.ts
git commit -m "$(cat <<'EOF'
feat(surf): chase camera behind the rider from the curl side, tube cut, impact shake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Peel chase: racy fast sections, HUD callout, SECTION MADE

**Files:**
- Create: `src/surf/math/random.ts` (`mulberry32` moves here)
- Modify: `src/surf/audio/synth.ts` (re-export `mulberry32`)
- Create: `src/surf/wave/PeelController.ts`, `src/surf/wave/PeelController.test.ts`
- Modify: `src/surf/config.ts` (`sections` block)
- Modify: `src/surf/physics/events.ts` (`fastSection`, `sectionMade`)
- Modify: `src/surf/scoring/Scoring.ts` (`Section Made` 500)
- Modify: `src/surf/state/store.ts`, `src/surf/ui/Hud.tsx`, `src/surf/ui/surf.module.css` (⚡ FAST SECTION)
- Modify: `src/surf/game/SurfGame.ts`, `src/surf/game/debugHook.ts`, `src/surf/game/debugParams.ts`
- Test: `src/surf/scoring/Scoring.test.ts`, `src/surf/ui/ui.test.tsx`, `src/surf/game/SurfGame.test.ts`

**Interfaces:**
- Consumes: `Surfer.setPeelSpeed(vp)` / `Surfer.peelSpeed` (Task 2); `rig.shot` hook (Task 3).
- Produces:
  - `mulberry32(seed: number): () => number` in `src/surf/math/random.ts` (still re-exported by `audio/synth.ts`).
  - `class PeelController { speed: number; level: number; boost: number; readonly active: boolean; constructor(wave: { peelSpeed: number }, cfg: SurfConfig['sections']); reset(seed: number): void; update(t: number): 'start' | 'end' | null }`.
  - `SURF_CONFIG.sections = { minGap 10, maxGap 20, minHold 3, maxHold 5, minBoost 0.3, maxBoost 0.5, ramp 0.5 }`.
  - `SurfEvent` gains `{ type: 'fastSection'; time: number; boost: number }` and `{ type: 'sectionMade'; time: number }`.
  - `TrickName` gains `'Section Made'`; `TRICK_BASE.sectionMade = 500`.
  - `SurfHudState.fastSection: boolean` (store), rendered by `Hud` as `data-testid="fast-section"`.
  - `SurfGame.peel: PeelController` (public, read-only field); `SurfDebugHook.peel: number`, `SurfDebugHook.fast: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/surf/wave/PeelController.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { PeelController } from './PeelController';

const make = () => {
  const wave = { peelSpeed: SURF_CONFIG.wave.peelSpeed };
  return { wave, peel: new PeelController(wave, structuredClone(SURF_CONFIG.sections)) };
};

/** Step 120 Hz sim time for `seconds`, recording transitions and speeds. */
function run(peel: PeelController, seconds: number) {
  const starts: number[] = [];
  const ends: number[] = [];
  const speeds: number[] = [];
  for (let i = 1; i <= seconds * 120; i++) {
    const t = i / 120;
    const tr = peel.update(t);
    if (tr === 'start') starts.push(t);
    if (tr === 'end') ends.push(t);
    speeds.push(peel.speed);
  }
  return { starts, ends, speeds };
}

describe('PeelController', () => {
  it('starts every run at the base peel speed with no section on', () => {
    const { wave, peel } = make();
    peel.reset(1);
    expect(peel.update(0)).toBeNull();
    expect(peel.speed).toBe(wave.peelSpeed);
    expect(peel.active).toBe(false);
  });

  it('schedules fast sections 10–20 s apart, 3–5 s at +30–50% with 0.5 s ramps', () => {
    const { wave, peel } = make();
    peel.reset(42);
    const { starts, ends, speeds } = run(peel, 300);
    expect(starts.length).toBeGreaterThanOrEqual(10);
    expect(starts[0]!).toBeGreaterThanOrEqual(10);
    expect(starts[0]!).toBeLessThanOrEqual(20);
    for (let k = 0; k < ends.length; k++) {
      const len = ends[k]! - starts[k]!;
      expect(len).toBeGreaterThanOrEqual(3 + 1 - 1e-6); // hold + two ramps
      expect(len).toBeLessThanOrEqual(5 + 1 + 1e-6);
      if (k + 1 < starts.length) {
        expect(starts[k + 1]! - ends[k]!).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(starts[k + 1]! - ends[k]!).toBeLessThanOrEqual(20 + 1e-6);
      }
    }
    const peak = Math.max(...speeds);
    expect(peak).toBeGreaterThanOrEqual(wave.peelSpeed * 1.3 - 1e-9);
    expect(peak).toBeLessThanOrEqual(wave.peelSpeed * 1.5 + 1e-9);
    // Ramps: never more than boost/ramp per second (0.5 s from base to peak).
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i]! - speeds[i - 1]!)).toBeLessThanOrEqual((wave.peelSpeed * 0.5) / 0.5 / 120 + 1e-9);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = make();
    const b = make();
    a.peel.reset(7);
    b.peel.reset(7);
    expect(run(a.peel, 120).starts).toEqual(run(b.peel, 120).starts);
    const d = make();
    d.peel.reset(7);
    const e = make();
    e.peel.reset(8);
    expect(run(d.peel, 120).starts).not.toEqual(run(e.peel, 120).starts);
  });

  it('follows live edits of the base peel speed', () => {
    const { wave, peel } = make();
    peel.reset(3);
    wave.peelSpeed = 6;
    peel.update(1);
    expect(peel.speed).toBe(6);
  });
});
```

Append to the end of `src/surf/scoring/Scoring.test.ts`:

```ts
describe('fast sections', () => {
  it('surviving a fast section awards SECTION MADE (500) into the combo', () => {
    const bus = new EventBus<SurfEvent>();
    const onAward = vi.fn();
    const scoring = new Scoring(SURF_CONFIG.scoring, { onAward });
    scoring.attach(bus);
    bus.emit({ type: 'fastSection', time: 1, boost: 0.4 });
    expect(scoring.pot).toBe(0);
    bus.emit({ type: 'sectionMade', time: 5 });
    expect(onAward).toHaveBeenCalledWith({ name: 'Section Made', points: 500, repeated: false });
    scoring.update(7, false);
    expect(scoring.score).toBe(500);
  });
});
```

In `src/surf/ui/ui.test.tsx`, replace:

```tsx
    expect(screen.getByText('Air 360 +700')).toBeTruthy();
  });
});
```

with:

```tsx
    expect(screen.getByText('Air 360 +700')).toBeTruthy();
  });
  it('flashes ⚡ FAST SECTION while a fast section is on', () => {
    const store = createSurfStore();
    render(<Hud store={store} />);
    expect(screen.queryByTestId('fast-section')).toBeNull();
    act(() => store.setState({ fastSection: true }));
    expect(screen.getByTestId('fast-section').textContent).toBe('⚡ FAST SECTION');
    act(() => store.setState({ fastSection: false }));
    expect(screen.queryByTestId('fast-section')).toBeNull();
  });
});
```

In `src/surf/game/SurfGame.test.ts`, replace:

```ts
  it('dispose during load does not attach the character or leave the title phase', async () => {
```

with:

```ts
  it('a fast section speeds up the peel, flashes the HUD and pays SECTION MADE when the rider survives it', async () => {
    const saved = { ...SURF_CONFIG.sections };
    Object.assign(SURF_CONFIG.sections, { minGap: 0.1, maxGap: 0.1, minHold: 0.2, maxHold: 0.2, minBoost: 0.4, maxBoost: 0.4, ramp: 0.1 });
    try {
      const { game, store } = await playing();
      const s = game.surfer.state;
      const peels: number[] = [];
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.mode = 'riding';
        s.time += dt;
        peels.push(game.surfer.peelSpeed);
      });
      const events: string[] = [];
      game.bus.onAny((e) => events.push(e.type));
      for (let i = 0; i < 12; i++) frame(); // 0.2 s: the section is on
      for (let i = 0; i < 4; i++) frame(); // let the throttled HUD writer flush
      expect(store.getState().fastSection).toBe(true);
      expect(Math.max(...peels)).toBeCloseTo(SURF_CONFIG.wave.peelSpeed * 1.4, 6);
      for (let i = 0; i < 30; i++) frame(); // past the end of the 0.4 s section
      expect(events).toContain('fastSection');
      expect(events).toContain('sectionMade');
      expect(store.getState().ticker.map((t) => t.text)).toContain('Section Made');
      game.dispose();
    } finally {
      Object.assign(SURF_CONFIG.sections, saved);
    }
  });

  it('no SECTION MADE when the rider wipes out during the section', async () => {
    const saved = { ...SURF_CONFIG.sections };
    Object.assign(SURF_CONFIG.sections, { minGap: 0.1, maxGap: 0.1, minHold: 0.2, maxHold: 0.2, ramp: 0.1 });
    try {
      const { game } = await playing();
      const s = game.surfer.state;
      vi.spyOn(game.surfer, 'step').mockImplementation((_i, dt) => {
        s.time += dt;
        if (s.time > 0.25) s.mode = 'wipeout';
      });
      const events: string[] = [];
      game.bus.onAny((e) => events.push(e.type));
      for (let i = 0; i < 40; i++) frame();
      expect(events).toContain('fastSection');
      expect(events).not.toContain('sectionMade');
      game.dispose();
    } finally {
      Object.assign(SURF_CONFIG.sections, saved);
    }
  });

  it('dispose during load does not attach the character or leave the title phase', async () => {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surf/wave/PeelController.test.ts src/surf/scoring src/surf/ui src/surf/game/SurfGame.test.ts`

Expected: FAIL — `./PeelController` does not exist, no `Section Made` award, no `fast-section` element, `SurfGame` never changes the peel.

- [ ] **Step 3: Add the seeded peel controller**

Create `src/surf/math/random.ts`:

```ts
/** Small, fast seeded PRNG: returns uniform numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

In `src/surf/audio/synth.ts`, replace:

```ts
/** Pure helpers for the surf audio graph (unit-tested; no AudioContext needed). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

with:

```ts
/** Pure helpers for the surf audio graph (unit-tested; no AudioContext needed). */
import { mulberry32 } from '../math/random';

export { mulberry32 };
```

Create `src/surf/wave/PeelController.ts`:

```ts
import type { SurfConfig } from '../config';
import { mulberry32 } from '../math/random';

export type PeelTransition = 'start' | 'end' | null;

/**
 * The peel speed over a run: the base Vp plus "fast sections" — every minGap–maxGap s (seeded per
 * run) a section breaks faster for minHold–maxHold s: Vp ramps up by minBoost–maxBoost over `ramp`
 * s, holds, and ramps back. A pure function of sim time; the game feeds `speed` to the surfer.
 */
export class PeelController {
  /** Current peel speed (m/s). */
  speed: number;
  /** 0 … 1: how far the current fast section has ramped in. */
  level = 0;
  /** Boost of the current / next section (fraction of Vp). */
  boost = 0;
  private start = 0;
  private hold = 0;
  private inSection = false;
  private rand: () => number = Math.random;

  constructor(
    private readonly wave: { peelSpeed: number },
    private readonly cfg: SurfConfig['sections'],
  ) {
    this.speed = wave.peelSpeed;
  }

  /** New run: first section minGap–maxGap s after the drop-in. */
  reset(seed: number): void {
    this.rand = mulberry32(seed);
    this.level = 0;
    this.inSection = false;
    this.schedule(0);
    this.speed = this.wave.peelSpeed;
  }

  /** True from the start of the ramp up to the end of the ramp down. */
  get active(): boolean {
    return this.inSection;
  }

  /** Advance to sim time `t` (s since the drop-in). Returns 'start' / 'end' on the tick a section begins / ends. */
  update(t: number): PeelTransition {
    const c = this.cfg;
    let transition: PeelTransition = null;
    const u = t - this.start;
    const total = 2 * c.ramp + this.hold;
    if (u >= total) {
      if (this.inSection) transition = 'end';
      this.inSection = false;
      this.schedule(this.start + total);
      this.level = 0;
    } else if (u >= 0) {
      if (!this.inSection) transition = 'start';
      this.inSection = true;
      this.level = Math.min(1, u / c.ramp, (total - u) / c.ramp);
    } else {
      this.level = 0;
    }
    this.speed = this.wave.peelSpeed * (1 + this.boost * this.level);
    return transition;
  }

  private schedule(after: number): void {
    const c = this.cfg;
    const r = this.rand;
    this.start = after + c.minGap + (c.maxGap - c.minGap) * r();
    this.hold = c.minHold + (c.maxHold - c.minHold) * r();
    this.boost = c.minBoost + (c.maxBoost - c.minBoost) * r();
  }
}
```

In `src/surf/config.ts`, replace:

```ts
  scoring: {
    comboWindow: 1.5,
```

with:

```ts
  /** Fast sections: the break outruns the rider for a while (see PeelController). */
  sections: {
    /** Seconds between sections (uniform, seeded per run). */
    minGap: 10,
    maxGap: 20,
    /** Seconds a section holds at full speed (the ramps come on top). */
    minHold: 3,
    maxHold: 5,
    /** Peel speed boost as a fraction of Vp. */
    minBoost: 0.3,
    maxBoost: 0.5,
    /** Ramp up / down time (s). */
    ramp: 0.5,
  },
  scoring: {
    comboWindow: 1.5,
```

- [ ] **Step 4: Events, scoring, store and HUD**

In `src/surf/physics/events.ts`, replace:

```ts
  | { type: 'kickedOut'; time: number };
```

with:

```ts
  | { type: 'kickedOut'; time: number }
  /** A fast section begins (the peel speeds up by `boost` × Vp). */
  | { type: 'fastSection'; time: number; boost: number }
  /** A fast section ended with the rider still up. */
  | { type: 'sectionMade'; time: number };
```

In `src/surf/scoring/Scoring.ts`, replace:

```ts
  | 'Revert';
```

with:

```ts
  | 'Revert'
  | 'Section Made';
```

In `src/surf/scoring/Scoring.ts`, replace:

```ts
  Revert: 150,
  floaterBase
```

with:

```ts
  Revert: 150,
  sectionMade: 500,
  floaterBase
```

In `src/surf/scoring/Scoring.ts`, replace:

```ts
      bus.on('carve', (e) => this.touch(e.time)),
```

with:

```ts
      bus.on('sectionMade', (e) => this.award('Section Made', TRICK_BASE.sectionMade, e.time)),
      bus.on('carve', (e) => this.touch(e.time)),
```

In `src/surf/state/store.ts`, replace:

```ts
  underwater: boolean;
}
```

with:

```ts
  underwater: boolean;
  /** A fast section is on: the HUD shows ⚡ FAST SECTION. */
  fastSection: boolean;
}
```

In `src/surf/state/store.ts`, replace:

```ts
  underwater: false,
};
```

with:

```ts
  underwater: false,
  fastSection: false,
};
```

In `src/surf/ui/Hud.tsx`, replace:

```tsx
  const ticker = useStore(store, (s) => s.ticker);
```

with:

```tsx
  const ticker = useStore(store, (s) => s.ticker);
  const fast = useStore(store, (s) => s.fastSection);
```

In `src/surf/ui/Hud.tsx`, replace:

```tsx
      {tubeTime > 0 ? <div className={styles.tube}>TUBE {tubeTime.toFixed(1)}s</div> : null}
```

with:

```tsx
      {tubeTime > 0 ? <div className={styles.tube}>TUBE {tubeTime.toFixed(1)}s</div> : null}
      {fast ? (
        <div className={styles.fast} data-testid="fast-section">
          ⚡ FAST SECTION
        </div>
      ) : null}
```

In `src/surf/ui/surf.module.css`, replace:

```css
.speed {
```

with:

```css
.fast { position: fixed; top: 27%; left: 50%; transform: translateX(-50%) skewX(-12deg); font-style: italic; font-size: 2rem; letter-spacing: 0.08em; color: #ffe16b; text-shadow: 3px 3px 0 #7a1d00; animation: flash 0.5s steps(2) infinite; }
@keyframes flash { 50% { color: #ff8a3d; } }
.speed {
```

- [ ] **Step 5: Wire the peel into the game**

Order inside a physics step: advance the controller to this step's time, hand the speed to the surfer (a frame acceleration), step the surfer, then announce transitions. A section that ends with the rider still up (`riding` / `airborne`) is "made". Each run gets a fresh seed (drop-in time mixed with a run counter). The title's water runs at the base peel, because `reset()` sets `speed` back to Vp.

In `src/surf/game/SurfGame.ts`, replace:

```ts
import { sideSign } from '../wave/mirror';
```

with:

```ts
import { sideSign } from '../wave/mirror';
import { PeelController } from '../wave/PeelController';
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
  readonly surfer = new Surfer(this.wave, SURF_CONFIG.physics, this.bus);
```

with:

```ts
  readonly surfer = new Surfer(this.wave, SURF_CONFIG.physics, this.bus);
  /** Peel speed over the run (base Vp + seeded fast sections). */
  readonly peel = new PeelController(SURF_CONFIG.wave, SURF_CONFIG.sections);
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
fps: 60, shot: 'chase' };
```

with:

```ts
fps: 60, peel: 0, fast: false, shot: 'chase' };
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
  private waterTime = 0;
```

with:

```ts
  private waterTime = 0;
  /** Runs started (mixed into each run's fast-section seed). */
  private runs = 0;
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.store.setState({ side, run: null, underwater: false, score: 0, pot: 0, multiplier: 0, tubeTime: 0, speedKmh: 0, ticker: [] });
```

with:

```ts
    this.store.setState({ side, run: null, underwater: false, fastSection: false, score: 0, pot: 0, multiplier: 0, tubeTime: 0, speedKmh: 0, ticker: [] });
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.store.setState({ run: null, underwater: false });
```

with:

```ts
    this.store.setState({ run: null, underwater: false, fastSection: false });
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
  private resetView(): void {
    this.surfer.reset();
```

with:

```ts
  private resetView(): void {
    // A fresh seeded fast-section schedule per run; the peel is back at base speed.
    this.peel.reset((Date.now() ^ Math.imul(++this.runs, 0x9e3779b9)) >>> 0);
    this.surfer.reset();
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    readSurferInput(this.actions, this.side, this.input);
    this.surfer.step(this.input, dt);
```

with:

```ts
    readSurferInput(this.actions, this.side, this.input);
    const section = this.peel.update(s.time + dt);
    this.surfer.setPeelSpeed(this.peel.speed);
    this.surfer.step(this.input, dt);
    if (section === 'start') this.bus.emit({ type: 'fastSection', time: s.time, boost: this.peel.boost });
    else if (section === 'end' && (s.mode === 'riding' || s.mode === 'airborne')) this.bus.emit({ type: 'sectionMade', time: s.time });
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.travel += this.wave.params.peelSpeed * dt;
```

with:

```ts
    this.travel += this.peel.speed * dt;
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
      const speed = this.surfer.worldSpeed(this.wave.params.peelSpeed);
```

with:

```ts
      const speed = this.surfer.worldSpeed(this.peel.speed);
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
        speedKmh: Math.round(speed * 3.6),
      });
```

with:

```ts
        speedKmh: Math.round(speed * 3.6),
        fastSection: this.peel.active,
      });
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    hook.fps = Math.round(this.fps);
    hook.shot = this.rig.shot;
```

with:

```ts
    hook.fps = Math.round(this.fps);
    hook.peel = this.peel.speed;
    hook.fast = this.peel.active;
    hook.shot = this.rig.shot;
```

In `src/surf/game/debugHook.ts`, replace:

```ts
  fps: number;
  /** Camera shot
```

with:

```ts
  fps: number;
  /** Current peel speed (m/s) and whether a fast section is on. */
  peel: number;
  fast: boolean;
  /** Camera shot
```

In `src/surf/game/debugParams.ts`, replace:

```ts
  ['scoring.comboWindow', 0.5, 4, 0.1],
```

with:

```ts
  ['sections.minGap', 2, 30, 1],
  ['sections.maxGap', 2, 40, 1],
  ['sections.maxBoost', 0, 1, 0.05],
  ['scoring.comboWindow', 0.5, 4, 0.1],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/surf/wave/PeelController.test.ts src/surf/scoring src/surf/ui src/surf/game/SurfGame.test.ts`

Expected: PASS.

Run: `npx vitest run src/surf`

Expected: PASS (`audio.test.ts` still imports `mulberry32` from `./synth`).

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/surf/math/random.ts \
  src/surf/audio/synth.ts \
  src/surf/wave/PeelController.ts \
  src/surf/wave/PeelController.test.ts \
  src/surf/config.ts \
  src/surf/physics/events.ts \
  src/surf/scoring/Scoring.ts \
  src/surf/scoring/Scoring.test.ts \
  src/surf/state/store.ts \
  src/surf/ui/Hud.tsx \
  src/surf/ui/surf.module.css \
  src/surf/ui/ui.test.tsx \
  src/surf/game/SurfGame.ts \
  src/surf/game/SurfGame.test.ts \
  src/surf/game/debugHook.ts \
  src/surf/game/debugParams.ts
git commit -m "$(cat <<'EOF'
feat(surf): racy fast sections — seeded peel surges, FAST SECTION callout, SECTION MADE bonus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Actively crashing wave: throwing lip, curtain, explosions, feathering, rumble

**Files:**
- Modify: `src/surf/render/waveGeometry.ts` (`aLip` attribute, `lipWeight`)
- Modify: `src/surf/render/waveMaterial.ts` (lip throw / turbulence, foam scrolls with `uTravel`)
- Modify: `src/surf/render/WaveMesh.ts` (`update(time, travel)`)
- Modify: `src/surf/render/Particles.ts` (curtain, impact bursts, feathering, near-camera fade)
- Modify: `src/surf/audio/synth.ts` (`rumbleParams`), `src/surf/audio/SurfAudio.ts` (rumble layer)
- Modify: `src/surf/game/SurfGame.ts` (water travel, rumble input)
- Test: `src/surf/render/waveGeometry.test.ts`, `src/surf/render/Particles.test.ts` (new), `src/surf/audio/audio.test.ts`

**Interfaces:**
- Consumes: `impactDistance` (Task 3), `SurfGame.peel` (`speed`, `level`) (Task 4).
- Produces:
  - `lipWeight(shape: WaveShape, x: number, t: number, tc: number): number` and a per-vertex `aLip` attribute (0 on the rideable face, so physics and render still agree where the rider can be).
  - `WaveUniforms` = `{ uTime, uTravel, uFoamTex, uSSS }` (`uPeel` removed); `createWaveMaterial()` takes no argument; `WaveMesh.update(time: number, travel: number)`.
  - `Particles`: exported `PARTICLE_RATES = { lip: 240, bursts: 9, burstSize: 16, churn: 140, feather: 70 }`, `NEAR_FADE = [0.8, 2.5]`, `MAX_POINT_FRACTION = 0.06`.
  - `rumbleParams(distance: number, fast: number): { gain: number; cutoff: number }`; `interface RumbleInput { distance: number; fast: number }`; `SurfAudio.update(s, speed, rumble: RumbleInput)`.

- [ ] **Step 1: Write the failing tests**

In `src/surf/render/waveGeometry.test.ts`, replace:

```ts
import { buildBackGeometry, buildWaveGeometry, columnsX, FRONT_SKIRT, waveVertexColor } from './waveGeometry';
```

with:

```ts
import { buildBackGeometry, buildWaveGeometry, columnsX, FRONT_SKIRT, lipWeight, waveVertexColor } from './waveGeometry';
```

In `src/surf/render/waveGeometry.test.ts`, replace:

```ts
    const u = { uTime: { value: 0 }, uPeel: { value: 7 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() } };
    injectWaveShader(shader as never, u);
    expect(shader.vertexShader).toContain('attribute float aFoam;');
    expect(shader.vertexShader.indexOf('transformed +=')).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uSSS');
    expect(shader.uniforms.uPeel).toBe(u.uPeel);
  });
});
```

with:

```ts
    const u = { uTime: { value: 0 }, uTravel: { value: 0 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() } };
    injectWaveShader(shader as never, u);
    expect(shader.vertexShader).toContain('attribute float aFoam;');
    expect(shader.vertexShader).toContain('attribute float aLip;');
    expect(shader.vertexShader).toContain('position.x + uTravel');
    expect(shader.vertexShader.indexOf('transformed +=')).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uSSS');
    expect(shader.uniforms.uTravel).toBe(u.uTravel);
  });
});

describe('lip animation weight', () => {
  it('is zero on the rideable face and at the crest, and grows past the crest where the lip pitches', () => {
    const shape = new WaveShape(structuredClone(SURF_CONFIG.wave));
    const geo = buildWaveGeometry(shape, columnsX(40, -10, 60), 32);
    const lip = geo.getAttribute('aLip');
    const uv = geo.getAttribute('uv');
    let maxOnFace = 0;
    let maxPastCrest = 0;
    for (let i = 0; i < lip.count; i++) {
      const x = uv.getX(i);
      const t = uv.getY(i);
      const tc = shape.crestT(x);
      if (t <= tc) maxOnFace = Math.max(maxOnFace, lip.getX(i));
      else if (x > -3 && x < 2) maxPastCrest = Math.max(maxPastCrest, lip.getX(i));
    }
    expect(maxOnFace).toBe(0);
    expect(maxPastCrest).toBeGreaterThan(0.9);
    expect(lipWeight(shape, 40, 1, shape.crestT(40))).toBeLessThan(0.01); // the shoulder does not pitch
  });
});
```

Create `src/surf/render/Particles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { MAX_POINT_FRACTION, NEAR_FADE, Particles } from './Particles';

function alive(p: Particles, filter: (x: number, y: number, z: number) => boolean): number {
  const { pos, life } = p.pool;
  let n = 0;
  for (let i = 0; i < life.length; i++) if (life[i]! > 0 && filter(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)) n++;
  return n;
}

describe('Particles — the crashing wave', () => {
  it('keeps a falling-lip curtain, impact explosions and shoulder feathering alive, all driven by the given dt', () => {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const bus = new EventBus<SurfEvent>();
    const surfer = new Surfer(wave, cfg.physics, bus);
    const p = new Particles(wave, bus, surfer.state);
    for (let i = 0; i < 60; i++) p.update(1 / 60, false);
    const D = cfg.wave.tubeDepth;
    // Curtain + explosions over the impact zone; spray above the trough there.
    expect(alive(p, (x) => x >= -D - 3 && x <= 0)).toBeGreaterThan(150);
    expect(alive(p, (x, y) => x >= -D - 3 && x <= 0 && y > 1.5)).toBeGreaterThan(20);
    // Feathering along the shoulder crest.
    expect(alive(p, (x, y) => x > 4 && x < cfg.wave.shoulderLength && y > wave.crestY(x) - 0.3)).toBeGreaterThan(20);
    // Paused: dt = 0 spawns and moves nothing.
    const before = Float32Array.from(p.pool.pos);
    p.update(0, false);
    expect(p.pool.pos).toEqual(before);
    p.dispose();
  });
});

describe('Particles — near the lens', () => {
  it('fades spray right at the camera and caps the point size to a fraction of the render height', () => {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const bus = new EventBus<SurfEvent>();
    const p = new Particles(wave, bus, new Surfer(wave, cfg.physics, bus).state);
    const cam = new PerspectiveCamera(62, 16 / 9, 0.1, 650);
    p.setScale(cam, 448);
    expect(p.points.material.uniforms.uMaxSize!.value).toBeCloseTo(448 * MAX_POINT_FRACTION, 9);
    expect(p.points.material.vertexShader).toContain(`smoothstep(${NEAR_FADE[0].toFixed(1)}, ${NEAR_FADE[1].toFixed(1)}, -mvPosition.z)`);
    expect(p.points.material.vertexShader).toContain('clamp(aSize * uScale / -mvPosition.z, 1.0, uMaxSize)');
    p.dispose();
  });
});
```

In `src/surf/audio/audio.test.ts`, replace:

```ts
import { fillImpulse, hootVoices, mulberry32, shuffle, sprayParams, tubeCutoffHz } from './synth';
```

with:

```ts
import { fillImpulse, hootVoices, mulberry32, rumbleParams, shuffle, sprayParams, tubeCutoffHz } from './synth';
```

In `src/surf/audio/audio.test.ts`, replace:

```ts
  it('raises spray pitch and level with speed and carving', () => {
```

with:

```ts
  it('makes the crashing rumble louder and brighter near the impact zone and in a fast section', () => {
    const far = rumbleParams(40, 0);
    const near = rumbleParams(0, 0);
    const fast = rumbleParams(0, 1);
    expect(far.gain).toBeGreaterThan(0);
    expect(near.gain).toBeGreaterThan(far.gain * 3);
    expect(near.cutoff).toBeGreaterThan(far.cutoff);
    expect(fast.gain).toBeGreaterThan(near.gain * 1.5);
    expect(fast.cutoff).toBeGreaterThan(near.cutoff);
    expect(rumbleParams(-5, 3)).toEqual(rumbleParams(0, 1)); // clamped inputs
  });
  it('raises spray pitch and level with speed and carving', () => {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surf/render src/surf/audio`

Expected: FAIL — `lipWeight` / `rumbleParams` are not exported, no `aLip` attribute, the shader has no `uTravel`, `PARTICLE_RATES` / `NEAR_FADE` / `MAX_POINT_FRACTION` are undefined, too few particles over the impact zone and the shoulder.

- [ ] **Step 3: Animate the lip in the wave mesh**

In `src/surf/render/waveGeometry.ts`, replace:

```ts
 * Attributes: position, normal, color (RGBA), uv (x, t), aFoam, aFace.
```

with:

```ts
 * Attributes: position, normal, color (RGBA), uv (x, t), aFoam, aFace, aLip.
```

In `src/surf/render/waveGeometry.ts`, replace:

```ts
  const faceA = new Float32Array(count);
```

with:

```ts
  const faceA = new Float32Array(count);
  const lipA = new Float32Array(count);
```

In `src/surf/render/waveGeometry.ts`, replace:

```ts
      faceA[v] = smoothstep(0.15, 0.6, clamp(p.y / Math.max(cy, 0.01), 0, 1)) * (1 - foam) * (t <= tc ? 1 : 0.4);
```

with:

```ts
      faceA[v] = smoothstep(0.15, 0.6, clamp(p.y / Math.max(cy, 0.01), 0, 1)) * (1 - foam) * (t <= tc ? 1 : 0.4);
      lipA[v] = lipWeight(shape, x, t, tc);
```

In `src/surf/render/waveGeometry.ts`, replace:

```ts
  geo.setAttribute('aFace', new BufferAttribute(faceA, 1));
  geo.setIndex(gridIndex(cols, R));
```

with:

```ts
  geo.setAttribute('aFace', new BufferAttribute(faceA, 1));
  geo.setAttribute('aLip', new BufferAttribute(lipA, 1));
  geo.setIndex(gridIndex(cols, R));
```

In `src/surf/render/waveGeometry.ts`, replace:

```ts
/** Vertex color + alpha for the wave
```

with:

```ts
/**
 * How much of the lip animation a vertex gets: 0 on the rideable face and at the crest (the physics
 * surface), rising past the crest toward the lip tip, scaled by the hollowness (the pitching section).
 */
export function lipWeight(shape: WaveShape, x: number, t: number, tc: number): number {
  return t <= tc ? 0 : smoothstep(tc, Math.min(1, tc + 0.12), t) * shape.hollowness(x);
}

/** Vertex color + alpha for the wave
```

In `src/surf/render/waveMaterial.ts`, replace:

```ts
  uTime: { value: number };
  uPeel: { value: number };
```

with:

```ts
  uTime: { value: number };
  /** Frame distance travelled along the reef (m): foam is fixed to the water, so it scrolls with the break. */
  uTravel: { value: number };
```

In `src/surf/render/waveMaterial.ts`, replace:

```ts
/** Inject ripple, foam scrolling and fake subsurface into a Lambert shader. Pure string surgery (unit-tested). */
```

with:

```ts
/**
 * Inject ripple, the animated pitching lip, foam scrolling and fake subsurface into a Lambert shader.
 * Pure string surgery (unit-tested).
 */
```

In `src/surf/render/waveMaterial.ts`, replace:

```ts
    'uniform float uTime;\nuniform float uPeel;\nattribute float aFoam;\nattribute float aFace;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\n' +
```

with:

```ts
    'uniform float uTime;\nuniform float uTravel;\nattribute float aFoam;\nattribute float aFace;\nattribute float aLip;\nvarying float vFoam;\nvarying float vFace;\nvarying vec2 vFoamUv;\n' +
```

In `src/surf/render/waveMaterial.ts`, replace:

```ts
  transformed += objectNormal * (sin(position.x * 1.7 + uTime * 2.3) * sin(position.z * 1.3 - uTime * 1.9)) * 0.035;
  vFoam = aFoam;
  vFace = aFace;
  vFoamUv = vec2((position.x + uTime * uPeel) / 7.0, uv.y * 9.0 + position.z * 0.05);`,
```

with:

```ts
  transformed += objectNormal * (sin(position.x * 1.7 + uTime * 2.3) * sin(position.z * 1.3 - uTime * 1.9)) * 0.035;
  // The lip throws and churns (aLip = 0 on the rideable face): a throw oscillation running along the
  // break plus turbulence, and a sag toward the tip, so the curl never reads as frozen.
  float throwWave = 0.6 * sin(position.x * 0.9 - uTime * 5.0) + 0.4 * sin(position.x * 2.3 + uTime * 8.0);
  transformed += objectNormal * aLip * throwWave * 0.14;
  transformed.y -= aLip * aLip * (0.5 + 0.5 * sin(uTime * 3.0 + position.x * 0.7)) * 0.12;
  vFoam = max(aFoam, 0.45 * aLip);
  vFace = aFace;
  vFoamUv = vec2((position.x + uTravel) / 7.0, uv.y * 9.0 + position.z * 0.05 - aLip * uTime * 1.5);`,
```

In `src/surf/render/waveMaterial.ts`, replace:

```ts
export function createWaveMaterial(peelSpeed: number): { material: MeshLambertMaterial; uniforms: WaveUniforms } {
  const uniforms: WaveUniforms = {
    uTime: { value: 0 },
    uPeel: { value: peelSpeed },
```

with:

```ts
export function createWaveMaterial(): { material: MeshLambertMaterial; uniforms: WaveUniforms } {
  const uniforms: WaveUniforms = {
    uTime: { value: 0 },
    uTravel: { value: 0 },
```

In `src/surf/render/WaveMesh.ts`, replace:

```ts
/**
 * The rendered wave: front surface + back. Geometry is rebuilt only when shape
 * parameters change (`rebuild()`); per-frame work is the shader ripple/foam.
 */
```

with:

```ts
/**
 * The rendered wave: front surface + back. Geometry is rebuilt only when shape
 * parameters change (`rebuild()`); per-frame work is the shader ripple, lip and foam.
 */
```

In `src/surf/render/WaveMesh.ts`, replace:

```ts
createWaveMaterial(shape.params.peelSpeed)
```

with:

```ts
createWaveMaterial()
```

In `src/surf/render/WaveMesh.ts`, replace:

```ts
    this.back.geometry = buildBackGeometry(this.shape, xs);
    this.uniforms.uPeel.value = this.shape.params.peelSpeed;
```

with:

```ts
    this.back.geometry = buildBackGeometry(this.shape, xs);
```

In `src/surf/render/WaveMesh.ts`, replace:

```ts
  update(time: number): void {
    this.uniforms.uTime.value = time;
  }
```

with:

```ts
  /** `time` = water clock (s), `travel` = frame distance along the reef (m); both freeze on pause. */
  update(time: number, travel: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uTravel.value = travel;
  }
```

- [ ] **Step 4: Crashing particles, with spray fading at the lens**

In `src/surf/render/Particles.ts`, replace:

```ts
const ATTRIBUTES = ['position', 'aAlpha', 'aSize', 'aShade'] as const;
```

with:

```ts
const ATTRIBUTES = ['position', 'aAlpha', 'aSize', 'aShade'] as const;
/** View depth (m) over which particles fade in: invisible nearer than 0.8 m, full from 2.5 m. */
export const NEAR_FADE = [0.8, 2.5] as const;
/** Largest point size, as a fraction of the internal render height. */
export const MAX_POINT_FRACTION = 0.06;
```

In `src/surf/render/Particles.ts`, replace:

```ts
uniform float uScale;
varying float vAlpha;
varying float vShade;
${ShaderChunk.fog_pars_vertex}
void main() {
  vAlpha = aAlpha;
  vShade = aShade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aAlpha > 0.0 ? max(1.0, aSize * uScale / -mvPosition.z) : 0.0;
```

with:

```ts
uniform float uScale;
uniform float uMaxSize;
varying float vAlpha;
varying float vShade;
${ShaderChunk.fog_pars_vertex}
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Spray right at the lens (the tube camera sits under the falling lip) fades out instead of
  // filling the screen with giant discs; point sizes are capped for the same reason.
  vAlpha = aAlpha * smoothstep(${NEAR_FADE[0].toFixed(1)}, ${NEAR_FADE[1].toFixed(1)}, -mvPosition.z);
  vShade = aShade;
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = vAlpha > 0.0 ? clamp(aSize * uScale / -mvPosition.z, 1.0, uMaxSize) : 0.0;
```

In `src/surf/render/Particles.ts`, replace:

```ts
const CAPACITY = 2048;
```

with:

```ts
const CAPACITY = 2048;
/** Spawn rates (per s) of the crashing-wave emitters; bursts spawn `burstSize` particles each. */
export const PARTICLE_RATES = { lip: 240, bursts: 9, burstSize: 16, churn: 140, feather: 70 } as const;
```

In `src/surf/render/Particles.ts`, replace:

```ts
/**
 * All water particles in one pooled THREE.Points (one draw call): lip spray,
 * whitewater churn, board spray, tube spit, wipeout splash and bubbles.
```

with:

```ts
/**
 * All water particles in one pooled THREE.Points (one draw call): the falling-lip
 * curtain, whitewater explosions where the lip lands, churn behind it, feathering
 * along the shoulder crest, board spray, tube spit, wipeout splash and bubbles.
```

In `src/surf/render/Particles.ts`, replace:

```ts
  private readonly lipRate = new RateAccumulator();
  private readonly churnRate = new RateAccumulator();
  private readonly sprayRate = new RateAccumulator();
  private readonly bubbleRate = new RateAccumulator();
  private readonly p = new Vector3();
```

with:

```ts
  private readonly lipRate = new RateAccumulator();
  private readonly burstRate = new RateAccumulator();
  private readonly churnRate = new RateAccumulator();
  private readonly featherRate = new RateAccumulator();
  private readonly sprayRate = new RateAccumulator();
  private readonly bubbleRate = new RateAccumulator();
  private readonly p = new Vector3();
  private readonly q = new Vector3();
```

In `src/surf/render/Particles.ts`, replace:

```ts
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 400 } }]),
```

with:

```ts
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 400 }, uMaxSize: { value: 27 } }]),
```

In `src/surf/render/Particles.ts`, replace:

```ts
    this.points.material.uniforms.uScale!.value = internalHeight * 0.5 * camera.projectionMatrix.elements[5]!;
```

with:

```ts
    this.points.material.uniforms.uScale!.value = internalHeight * 0.5 * camera.projectionMatrix.elements[5]!;
    this.points.material.uniforms.uMaxSize!.value = internalHeight * MAX_POINT_FRACTION;
```

In `src/surf/render/Particles.ts`, replace:

```ts
    for (let n = this.lipRate.take(90, dt); n > 0; n--) {
      const x = rnd(-D, 4);
      w.profile(x, 1, this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.8, 0.8), vy: rnd(1.5, 4), vz: rnd(1, 3), life: rnd(0.7, 1.2), size: 0.18, gravity: -9.81, drag: 0.6, shade: 1 });
    }
    for (let n = this.churnRate.take(140, dt); n > 0; n--) {
      const x = -D - rnd(0, 14);
      w.profile(x, w.crestT(x) - rnd(0, 0.25), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-1.5, 0.5), vy: rnd(1, 3.5), vz: rnd(0.5, 2.5), life: rnd(0.6, 1.1), size: 0.3, gravity: -6, drag: 1, shade: 0.95 });
    }
```

with:

```ts
    // Falling lip: a curtain streaming off the lip tip along the pitching section, thrown out and down.
    for (let n = this.lipRate.take(PARTICLE_RATES.lip, dt); n > 0; n--) {
      const x = rnd(-D, 0.5 * w.params.hollowLength);
      if (Math.random() > w.hollowness(x)) continue; // denser where the lip throws harder
      w.profile(x, 1, this.p);
      w.profile(x, 0.96, this.q);
      const throwDir = this.q.subVectors(this.p, this.q).normalize();
      const v = rnd(2, 4);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.6, 0.6), vy: throwDir.y * v, vz: throwDir.z * v, life: rnd(0.5, 0.9), size: 0.22, gravity: -9.81, drag: 0.4, shade: 1 });
    }
    // Impact: whitewater explosions where the lip lands (x ∈ [−D, 0]) and just behind it.
    for (let n = this.burstRate.take(PARTICLE_RATES.bursts, dt); n > 0; n--) {
      const x = rnd(-D - 3, 0);
      w.profile(x, x < -D ? w.crestT(x) : 1, this.p);
      for (let k = 0; k < PARTICLE_RATES.burstSize; k++) {
        this.pool.spawn({ x: this.p.x + rnd(-0.4, 0.4), y: this.p.y, z: this.p.z + rnd(-0.4, 0.4), vx: rnd(-2, 1), vy: rnd(3, 7), vz: rnd(-1, 3), life: rnd(0.6, 1.2), size: 0.35, gravity: -9.81, drag: 0.9, shade: 0.95 });
      }
    }
    for (let n = this.churnRate.take(PARTICLE_RATES.churn, dt); n > 0; n--) {
      const x = -D - rnd(0, 14);
      w.profile(x, w.crestT(x) - rnd(0, 0.25), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-1.5, 0.5), vy: rnd(1, 3.5), vz: rnd(0.5, 2.5), life: rnd(0.6, 1.1), size: 0.3, gravity: -6, drag: 1, shade: 0.95 });
    }
    // Feathering: spray blown back off the shoulder crest.
    for (let n = this.featherRate.take(PARTICLE_RATES.feather, dt); n > 0; n--) {
      const x = rnd(2, w.params.shoulderLength);
      w.profile(x, w.crestT(x), this.p);
      this.pool.spawn({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.5, 0.5), vy: rnd(0.8, 2), vz: rnd(-3.5, -1.5), life: rnd(0.5, 0.8), size: 0.12, gravity: -3, drag: 0.8, shade: 1 });
    }
```

Budget: at these rates ≈ 400–500 particles are alive (capacity 2048, still one draw call). The e2e budget test (< 80 calls, < 150k triangles) passed with 14–17 calls and ≈ 52k triangles.

- [ ] **Step 5: Crashing rumble**

In `src/surf/audio/synth.ts`, replace:

```ts
export interface HootVoice {
```

with:

```ts
/**
 * Crashing rumble: louder and brighter the closer the rider is to the impact zone (`distance`, m)
 * and during a fast section (`fast`, 0–1).
 */
export function rumbleParams(distance: number, fast: number): { gain: number; cutoff: number } {
  const near = Math.max(0, 1 - Math.max(0, distance) / 30);
  const f = Math.min(1, Math.max(0, fast));
  return { gain: (0.06 + 0.3 * near * near) * (1 + 0.8 * f), cutoff: 140 + 360 * near + 260 * f };
}

export interface HootVoice {
```

In `src/surf/audio/SurfAudio.ts`, replace:

```ts
import { fillImpulse, fillNoise, hootVoices, sprayParams, tubeCutoffHz, type HootVoice } from './synth';
```

with:

```ts
import { fillImpulse, fillNoise, hootVoices, rumbleParams, sprayParams, tubeCutoffHz, type HootVoice } from './synth';

/** What the crashing rumble follows each frame. */
export interface RumbleInput {
  /** Distance (m) from the rider to the impact zone. */
  distance: number;
  /** Fast-section level, 0–1. */
  fast: number;
}
```

In `src/surf/audio/SurfAudio.ts`, replace:

```ts
 *   ocean (filtered noise with slow swells) ► master
```

with:

```ts
 *   ocean (filtered noise with slow swells) ► master
 *   rumble (low-passed noise: the crashing lip, by distance / fast section) ► master
```

In `src/surf/audio/SurfAudio.ts`, replace:

```ts
  private readonly sprayGain = this.ctx.createGain();
```

with:

```ts
  private readonly sprayGain = this.ctx.createGain();
  private readonly rumbleLP = this.ctx.createBiquadFilter();
  private readonly rumbleGain = this.ctx.createGain();
```

In `src/surf/audio/SurfAudio.ts`, replace:

```ts
    this.ocean(500, 'lowpass', 0.22, 0.07, 0.12);
```

with:

```ts
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 200;
    this.rumbleGain.gain.value = 0;
    this.loopNoise().connect(this.rumbleLP).connect(this.rumbleGain).connect(this.master);

    this.ocean(500, 'lowpass', 0.22, 0.07, 0.12);
```

In `src/surf/audio/SurfAudio.ts`, replace:

```ts
  update(s: SurferState, speed: number): void {
    const now = this.ctx.currentTime;
```

with:

```ts
  update(s: SurferState, speed: number, rumble: RumbleInput): void {
    const now = this.ctx.currentTime;
    const r = rumbleParams(rumble.distance, rumble.fast);
    this.rumbleLP.frequency.setTargetAtTime(r.cutoff, now, TAU);
    this.rumbleGain.gain.setTargetAtTime(r.gain, now, TAU);
```

- [ ] **Step 6: Feed the water travel and the rumble from the game**

The foam texture is fixed to the water, so it scrolls with the distance the frame has travelled at the current (possibly surging) peel speed. `uTime * uPeel` would jump whenever the peel changes. The water clock only advances with the sim, so a pause freezes the lip, foam and particles.

In `src/surf/game/SurfGame.ts`, replace:

```ts
import { sideSign } from '../wave/mirror';
```

with:

```ts
import { impactDistance } from '../wave/impact';
import { sideSign } from '../wave/mirror';
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
  private waterTime = 0;
```

with:

```ts
  private waterTime = 0;
  /** Foam scroll distance (m): advances at the peel speed with the water clock. */
  private waterTravel = 0;
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.waterTime += this.frameSimDt;
```

with:

```ts
    this.waterTime += this.frameSimDt;
    this.waterTravel += this.frameSimDt * this.peel.speed;
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
    this.waveMesh.update(this.waterTime);
```

with:

```ts
    this.waveMesh.update(this.waterTime, this.waterTravel);
```

In `src/surf/game/SurfGame.ts`, replace:

```ts
      this.audio?.update(s, speed);
```

with:

```ts
      this.audio?.update(s, speed, { distance: impactDistance(s.p.x, this.wave.params.tubeDepth), fast: this.peel.level });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/surf/render src/surf/audio`

Expected: PASS.

Run: `npx vitest run src/surf`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/surf/render/waveGeometry.ts \
  src/surf/render/waveGeometry.test.ts \
  src/surf/render/waveMaterial.ts \
  src/surf/render/WaveMesh.ts \
  src/surf/render/Particles.ts \
  src/surf/render/Particles.test.ts \
  src/surf/audio/synth.ts \
  src/surf/audio/SurfAudio.ts \
  src/surf/audio/audio.test.ts \
  src/surf/game/SurfGame.ts
git commit -m "$(cat <<'EOF'
feat(surf): an actively crashing wave — throwing lip, curtain, explosions, feathering, rumble

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Integration: e2e, playtest screenshots, docs

**Files:**
- Modify: `tests/e2e/surf.spec.ts` (catch timing, chase → tube camera)
- Modify: `README.md` (controls and rules)
- Modify: `docs/superpowers/specs/2026-09-29-surf-rework-design.md` (implementation notes)
- Temporary (not committed): `surf-shots.mjs` in the repo root

**Interfaces:**
- Consumes: everything above; `window.__surf` fields `mode`, `phase`, `peel`, `fast`, `shot` (Tasks 3–4).
- Produces: nothing new in code.

- [ ] **Step 1: Add the e2e checks**

In `tests/e2e/surf.spec.ts`, replace:

```ts
  test('stays inside the draw-call and triangle budget', async ({ page }) => {
```

with:

```ts
  test('with no input the curl catches the rider in a few seconds (never under 2 s)', async ({ page }) => {
    await dropIn(page);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__surf?.mode === 'wipeout', undefined, { timeout: 15_000 });
    expect(Date.now() - t0).toBeGreaterThan(2000);
    await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 15_000 });
    await expect(page.getByText(/SWALLOWED BY THE BARREL/)).toBeVisible();
  });

  test('rides on the chase camera, and stalling into the curl cuts to the tube view', async ({ page }) => {
    await dropIn(page);
    await expect.poll(() => page.evaluate(() => window.__surf?.shot)).toBe('chase');
    expect(await page.evaluate(() => window.__surf?.peel)).toBe(8);
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window.__surf?.shot === 'tube', undefined, { timeout: 15_000 });
    await page.keyboard.up('ArrowDown');
  });

  test('stays inside the draw-call and triangle budget', async ({ page }) => {
```

- [ ] **Step 2: Run the full suites**

Run: `npx vitest run`

Expected: PASS (all projects; surf alone is 25 files / 245 tests).

Run: `npx tsc --noEmit`

Expected: no errors.

Run: `npm run test:e2e`

Expected: 13 passed, including the two new ones. The idle rider is swallowed after more than 2 s, and the results show SWALLOWED BY THE BARREL. The camera starts on `chase` with `peel === 8`, and holding ↓ cuts it to `tube`. The existing ollie-score, stall-to-results and budget tests still pass (prototype: 14–17 draw calls, ≈ 52k triangles).

- [ ] **Step 3: Playtest screenshots (inspect them)**

Start a dev server (`npx next dev --port 3500`; if `public/tracks` is missing, run `npm run dev -- --port 3500` once so `predev` builds it). Save this as `surf-shots.mjs` in the repo root (**do not commit it**). It forces an early fast section through the `?debug` sliders, so no code edits are needed:

```js
// Playtest screenshots of the surf rework (not committed). Usage:
//   BASE=http://localhost:3500 OUT=/tmp/surf-shots node surf-shots.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:3500';
const OUT = process.env.OUT ?? '/tmp/surf-shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const hook = () => page.evaluate(() => ({ ...window.__surf }));
let side = 'right';

async function title(debug = false) {
  await page.goto(`${BASE}/surf${debug ? '?debug' : ''}`);
  await page.getByRole('button', { name: 'DROP IN' }).waitFor();
}
async function dropIn(s) {
  side = s;
  await page.getByRole('button', { name: s.toUpperCase() }).click();
  await page.getByRole('button', { name: 'DROP IN' }).click();
  await page.waitForFunction(() => window.__surf?.phase === 'playing');
}
/** Keyboard S-turns: each second carve toward the lip 300 ms, away 250 ms, glide; pump every 0.4 s. */
async function ride(ms) {
  const lip = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
  const trough = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
  const t0 = Date.now();
  let lastPump = -1e9;
  let held = null;
  const hold = async (k) => {
    if (held === k) return;
    if (held) await page.keyboard.up(held);
    held = k;
    if (k) await page.keyboard.down(k);
  };
  while (Date.now() - t0 < ms) {
    const t = Date.now() - t0;
    if (t - lastPump > 400) {
      await page.keyboard.press('ArrowUp');
      lastPump = t;
    }
    const ph = t % 1000;
    await hold(ph < 300 ? lip : ph < 550 ? trough : null);
    await page.waitForTimeout(20);
  }
  await hold(null);
}

// 1. Riding a RIGHT on the chase camera.
await title();
await dropIn('right');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/1-right-dropin.png` });
await ride(1500);
await page.screenshot({ path: `${OUT}/2-right-riding.png` });
console.log('riding', JSON.stringify(await hook()));

// 2. A fast section, forced early with the ?debug sliders (no code edits).
await title(true);
await page.getByLabel('wave-frame gizmo').uncheck();
await page.locator('label', { hasText: 'sections.minGap' }).locator('input').fill('3');
await page.locator('label', { hasText: 'sections.maxGap' }).locator('input').fill('3');
// Retry until the section arrives while the rider is still up (the keyboard rider is no pro).
await dropIn('right');
for (let attempt = 0; attempt < 5; attempt++) {
  let h = await hook();
  while (!h.fast && (h.mode === 'riding' || h.mode === 'airborne')) {
    await ride(150);
    h = await hook();
  }
  if (h.fast && (h.mode === 'riding' || h.mode === 'airborne')) break;
  await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 15_000 });
  await page.getByRole('button', { name: /GO AGAIN/ }).click();
  await page.waitForFunction(() => window.__surf?.phase === 'playing');
}
await page.screenshot({ path: `${OUT}/3-right-fast-section.png` });
console.log('fast', JSON.stringify(await hook()));

// 3. Stall into the barrel: the tube view.
await title();
await dropIn('right');
await page.keyboard.down('ArrowDown');
await page.waitForFunction(() => window.__surf?.shot === 'tube' || window.__surf?.phase !== 'playing', undefined, { timeout: 15_000 });
await page.keyboard.up('ArrowDown');
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/4-right-tube.png` });
console.log('tube', JSON.stringify(await hook()));

// 4. An ollie: the air camera.
await title();
await dropIn('right');
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/5-right-air.png` });
console.log('air', JSON.stringify(await hook()));

// 5. The mirrored LEFT.
await title();
await dropIn('left');
await ride(1800);
await page.screenshot({ path: `${OUT}/6-left-riding.png` });
console.log('left', JSON.stringify(await hook()));

console.log('errors', JSON.stringify(errors));
await browser.close();
```

Run `BASE=http://localhost:3500 OUT=/tmp/surf-shots node surf-shots.mjs`, then **Read every PNG** and confirm:
- `2-right-riding.png`: camera behind the rider, looking down the line. On a RIGHT the flats are on screen-left and the face rises on screen-right, with the pitching lip and whitewater explosions near the camera.
- `3-right-fast-section.png`: `⚡ FAST SECTION` callout while riding (the log shows `fast: true`, `peel` > 8).
- `4-right-tube.png`: tube view inside the barrel behind the rider, lip overhead, rider readable (no giant spray discs).
- `5-right-air.png`: pulled-back air camera.
- `6-left-riding.png`: mirror image of the RIGHT (face on screen-left).
- The log ends with `errors []`.

Then `rm surf-shots.mjs` and stop the server.

- [ ] **Step 4: Document the rules and the implementation notes**

In `README.md`, replace:

```markdown
| ↑ | Pump (rhythm beats mashing) | — |
| ↓ | Stall (the curl catches you) | — |
```

with:

```markdown
| ↑ | Pump (works the face, not the flats; rhythm beats mashing) | — |
| ↓ | Stall (the curl catches you; let go early to pump out of the barrel) | — |
```

In `README.md`, replace:

```markdown
- Mobile (landscape): left thumb pad, right OLLIE + grab buttons.
```

with:

```markdown
- Mobile (landscape): left thumb pad, right OLLIE + grab buttons.
- RIGHT / LEFT follow the surf convention: a RIGHT peels to your right as you face the beach.
- The break chases you: sit still and the curl swallows you in about 5 s. Carve down the line and pump on the face to stay ahead. Every 10–20 s a ⚡ FAST SECTION surges the peel 30–50% for 3–5 s; make it for a 500-point SECTION MADE.
- The camera rides behind you on the curl side and cuts into the barrel when you get tubed.
```

Append to the end of `docs/superpowers/specs/2026-09-29-surf-rework-design.md`:

```markdown
## Implementation notes (plan `2026-09-29-surf-rework.md`)

Prototyped headlessly (real `Surfer` / `WaveShape` / `CameraRig`) before planning. These are interpretations of this addendum:

- **Sides.** The canonical frame (rider travels +x, shore +z) is a LEFT; a RIGHT is the mirrored frame (`sideSign('right') = −1`). High-score entries saved before the fix keep their old (inverted) side label.
- **Vp 8 m/s.** With no input the rider drops to the flats and is swallowed at ≈ 4.8 s (tube entry ≈ 3.0 s). S-turns (bottom turn below 35%, top turn above 60% of the crest) with a pump every 1 s hold ≥ 30 s; the same lines without pumps die at ≈ 7 s.
- **No sticky face.** Lift and face damping are gone. A pocket drive (1.8 m/s² × steepness, along +x) remains as the "good lines generate speed" term. It is below the drag at pace even on the steepest face (0.03 × 8² = 1.92 m/s²), so it cannot park the rider, and it is zero on the flats.
- **The board runs through the water.** Heading, carving, pumping, drag and rail grip act on the world velocity (`v + Vp·x̂`). The water slides along the surface at constant t (projecting −Vp·x̂ onto a face skewed in x created a hidden lift). Rail grip 85% from 5 m/s. Carve yaw rate `4 / (1 + speed / 10)` rad/s, eased with a 0.12 s lag; turn radius 3.2 m @ 6 m/s → 5.4 m @ 9 → 8.0 m @ 12. Trough → 85% of the crest takes 0.8–1.0 s from 10 m/s.
- **Pumps work the face.** The net gain `(3 × eff − 0.25)` m/s scales with `smoothstep(0.1, 0.5, steepness)`. Without this, pumping straight along the flats outran the curl indefinitely.
- **Crest shed.** Reaching the top too slow to launch pushes the rider back down at 1 m/s. On the unpitched swell the crest is flat, so the old clamp let a slow rider balance on the ridge.
- **Barrel.** Stall while carving into the pocket and release as the curl arrives (x ≤ 3): pumping every 0.6 s gives a ≈ 2.3 s barrel and an exit. Holding the stall until the tube starts leaves the rider too slow to escape, by design.
- **Fast sections.** Seeded per run (drop-in time ^ run counter). The frame acceleration is applied exactly: frame velocities shift by −ΔVp. In a 1.4× / 4 s section the base effort (above) loses ≈ 11.6 m; pumping every 0.6 s survives it, losing ≈ 6.3 m. The 1.5× / 5 s worst case is also survivable (≈ 11.9 m). SECTION MADE is a combo trick (500 into the pot), so a wipeout inside the combo window loses it.
- **Crashing visuals.** The lip region of the mesh (`aLip`, zero on the rideable face) throws and churns in the vertex shader; foam scrolls with the frame's travel distance. Particles add a falling-lip curtain (240/s), impact explosions (9 bursts/s × 16) over x ∈ [−D − 3, 0], churn behind, and crest feathering (70/s) out to Ls. Spray within 0.8–2.5 m of the camera fades out and point sizes are capped, so the tube view stays readable. The rumble uses gain `(0.06 + 0.3·near²)(1 + 0.8·fast)` and cutoff `140 + 360·near + 260·fast` Hz, with `near = 1 − distance/30`. Shake peaks at 0.06 m over [−D, 0] and fades over 8 m. Everything runs on the sim clock.
- **Camera.** Chase offset (−6, +2.2, +2) m, floored 1.2 m above the crest under the camera and under the rider, looking at rider + (5, 0.4, 0). The **tube view is a cut**, not a glide. The chase camera sits above the lip and the barrel's only opening is the mouth ahead of the rider, so any move into the barrel behind the rider would pass through the lip. It cuts in after 0.2 s tubed and out 0.15 s after exit. It also covers riding low in the pocket (x ≤ 3, y < 0.6 × crest), where the pitching lip hides the rider from above. It sits 2.2 m behind the rider (0.8 m off the face), clamped at x ≥ −6, looking out of the mouth.
- **Verification 5** is measured on a 30 s S-turn ride (chase: 100% behind / looking down the line / above the crest / rider visible) and on the no-input ride (100%). The barrel ride sees the rider in 100% of tube-view frames (asserted ≥ 90%). Its chase frames while the rider climbs high in the pocket, before the cut, see them 86% of the time (not asserted: the lip covers a rider high in the pocket from any above-crest viewpoint). No probe ever has the camera under the water. Drop-in moved to (x 3.5, t 0.5) so the first frames are not under the lip.
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/surf.spec.ts \
  README.md \
  docs/superpowers/specs/2026-09-29-surf-rework-design.md
git commit -m "$(cat <<'EOF'
test(surf): e2e for the chasing curl and tube cut; docs for the rework

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage (addendum → task):**
- §1 Side naming + unit test → Task 1 (`mirror.test.ts` "a RIGHT peels to the surfer's right…"); Task 3 re-derives the key mapping for the new camera and tests it on both sides against the real projection.
- §2 Break chases (no input ~4–5 s, pumping + carving holds; stall → barrel; pump out of the barrel early) → Task 2 tests "no input …", "rhythmic pumping …", "the same lines without pumping…", "stalling …", "stall while carving into the pocket …". Racy sections (seeded, 10–20 s, +30–50%, 0.5 s ramps, 3–5 s, frame acceleration, HUD, louder rumble, SECTION MADE 500) → Task 2 `setPeelSpeed` + fast-section test; Task 4 `PeelController` + HUD + scoring + SurfGame tests; Task 5 rumble `fast` term.
- §3 Crashing visuals + audio (curtain, explosions/churn at [−D, 0] and behind, feathering, animated lip, foam scrolls, rumble by distance, shake, sim time) → Task 5 (+ shake in Task 3). Particle and lip tests assert emitters and the pause (dt = 0) freeze.
- §4 Weighty carving (whole face, radius ∝ speed, momentum, drops/climbs, bottom → top lines + pumps, existing trick semantics) → Task 2 (traverse ≤ 1.5 s, radius growth, heading, carving climbs; all air / floater / snap / landing tests unchanged and passing).
- §5 Camera (behind on the curl side, above the crest, looking down the line; tube behind inside the barrel; air; underwater; springs; no clipping, probe-tested) → Task 3.
- Verification 1–6 → Task 2 (1–4), Task 3 (5), Task 1 (6). Browser screenshots + e2e → Task 6.

**Tests deliberately changed (and why):**
- `Surfer.test.ts` "riding straight stays on the surface and settles mid-face" → replaced by "no input: … swallowed after 3.5–5.2 s". The addendum removes the mid-face stickiness this test encoded.
- `Surfer.test.ts` "carving toward the lip climbs the face" → now starts from a rider trimming at (15, 0.4) at 10 m/s world speed, with a 0.1 m margin (was 0.03). After 1 s of no input the rider is now on the flats, where carving down cannot go lower.
- `Surfer.test.ts` "pump spam yields less speed than rhythmic pumping" → compares mean world speed over the same S-turn lines. Pumps only work on the face, and frame speed is no longer the board's speed.
- `Surfer.test.ts` "snaps when carving through a reversal at the crest (x = 15 / 4)" → the climb is given as world motion (along 3 + up 3; along 2 + up 4) arriving below launch speed. The old frame-velocity setup now carries ≈ 11 m/s of world speed and launches. Snap semantics are unchanged.
- `math.test.ts` spec numbers: `peelSpeed` 7 → 8.
- `mirror.test.ts`: `sideSign` expectations flipped, and a naming test added.
- `input.test.ts`: flipped in Task 1 (old camera), restored in Task 3 (net unchanged).
- `CameraRig.test.ts`: side literals swapped in Task 1. Task 2 removes the old real-mesh probes, which assumed a 10 s no-input ride and the old tube glide. Task 3 rewrites the file for the new camera (design §5 supersedes the shoulder-side chase and the Task-17 "ahead, looking back" tube ruling).
- `SurfGame.test.ts`: `rig.update` now also receives the sim clock.
- `waveGeometry.test.ts`: shader uniform `uPeel` → `uTravel`.
- Unchanged and passing: every air test (launch continuity, air time growth, face-end crossings, 360s, ollie impulse and air time, too-slow-at-top, never riding a downward normal, spins/grabs/landing), floaters (continuity, dismount across a face-end step), kick-out, "does not snap on a low climb", crest cache, scoring, store, UI, character, audio music, environment, particles pool, debug params.

**Placeholder scan:** no TBD/TODO. Every code step contains the literal code or an exact command, and every edit block was applied mechanically during the replay.

**Type consistency:** `setPeelSpeed` / `peelSpeed` (Task 2) are used by Tasks 4 and 5. `cameraGoal(s, side, shot, wave, out, tubeMinX)` / `CameraRig(camera, cfg, wave)` / `update(…, dt, time)` (Task 3) match `SurfGame` and the tests. `impactDistance` (Task 3) is reused in Task 5. `PeelController.speed/level/boost/active/update/reset` (Task 4) match `SurfGame`. `SurfDebugHook.shot` (Task 3) and `peel`/`fast` (Task 4) match the e2e test (Task 6). `RumbleInput` (Task 5) matches the `SurfGame` call.
