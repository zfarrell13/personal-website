import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { CameraRig } from '../camera/CameraRig';
import { SURF_CONFIG, type Side } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { faceYaw } from '../physics/faceYaw';
import { NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { buildWaveGeometry, columnsX } from '../render/waveGeometry';
import { frameToView } from '../wave/mirror';
import { WaveShape } from '../wave/WaveShape';
import { PierDirector } from './PierDirector';
import { insidePier, nearestPier, PIER, PIER_LANES, PIER_TRACK, pierFade } from './track';

const DT = 1 / 120;
/** Frame z inside the lanes (as in PierDirector.test): high / middle / low in FACE, the middle of TROUGH. */
const [FACE_LO, FACE_HI] = PIER_LANES.face;
const FACE_MID = (FACE_LO + FACE_HI) / 2;
const LANES = [FACE_LO + 0.25, FACE_MID, FACE_HI - 0.25, (PIER_LANES.trough[0] + PIER_LANES.trough[1]) / 2];

/** Holds the board on a line at frame z ≈ zLane, pumping (as in PierDirector.test). */
function laneDriver(surfer: Surfer, wave: WaveShape, zLane: number) {
  const input: SurferInput = { ...NO_INPUT };
  let held = 0;
  let gap = false;
  let since = 0;
  return (): SurferInput => {
    const s = surfer.state;
    const want = Math.max(-0.8, Math.min(0.8, 0.6 * (s.p.z - zLane)));
    const err = want - faceYaw(wave, s.param, s.heading);
    const rot = Math.abs(err) > 0.06 ? Math.sign(err) : 0;
    if (gap) {
      gap = false;
      held = 0;
    } else if (rot !== held) {
      if (held !== 0 && rot !== 0) {
        held = 0;
        gap = true;
      } else held = rot;
    }
    since += DT;
    input.pump = since >= 0.8;
    if (input.pump) since = 0;
    input.carve = held;
    return input;
  };
}

/**
 * A pier pass on the real wave with the real camera rig (chase / tube), both sides: the rider settles
 * (lineBot), then `drive` takes over as the pier comes from `ahead` m down the line. Per rendered
 * frame (60 Hz) while the pier is within 15 m of the camera or the rider: is the camera inside the pier,
 * is the rider's chest seen (past the wave mesh and the pier's undissolved parts), how far did the
 * camera move.
 */
function pierPass(
  side: Side,
  drive: (surfer: Surfer, wave: WaveShape, pier: PierDirector) => () => SurferInput,
  ahead: number,
  /** Before the pass: the lineBot until 6 s, or stalling into the barrel. */
  warmUp: 'line' | 'barrel' = 'line',
) {
  const cfg = structuredClone(SURF_CONFIG);
  const wave = new WaveShape(cfg.wave);
  const bus = new EventBus<SurfEvent>();
  const events: SurfEvent[] = [];
  bus.onAny((e) => events.push(e));
  const surfer = new Surfer(wave, cfg.physics, bus);
  const s = surfer.state;
  const pier = new PierDirector(surfer, bus);
  const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
  front.updateMatrixWorld();
  const cam = new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650);
  const rig = new CameraRig(cam, cfg.camera, wave);
  let travel = 1e4; // no pier near while settling
  pier.reset(travel);
  rig.snap(s, side);
  const warm = lineBot(surfer, wave, { pumpEvery: 1 });
  let input: () => SurferInput = warmUp === 'line' ? () => ({ ...warm(DT) }) : () => ({ ...NO_INPUT, stall: true });
  const ready = () => (warmUp === 'line' ? s.time >= 6 : s.inTube);
  const r = { airFrames: 0, frames: 0, chase: 0, chaseSeen: 0, tube: 0, tubeSeen: 0, inside: 0, insideTube: 0, insideRun: 0, longestInside: 0, inDeck: 0, maxStep: 0, maxDy: 0, passed: false };
  const ray = new Raycaster();
  const chest = new Vector3();
  const dir = new Vector3();
  const camF = new Vector3();
  const q = new Vector3();
  const prevCam = new Vector3();
  let started = false;
  for (let f = 0; f < 16 * 60; f++) {
    if (!started && ready()) {
      started = true;
      travel = PIER_TRACK.sets[0]! - (s.p.x + ahead);
      pier.reset(travel);
      input = drive(surfer, wave, pier);
    }
    for (let k = 0; k < 2; k++) {
      surfer.step(input(), DT);
      const t0 = travel;
      travel += cfg.wave.peelSpeed * DT;
      pier.step(t0, travel);
    }
    if (s.mode !== 'riding' && s.mode !== 'airborne') break;
    const px = nearestPier(travel, s.p.x).x;
    rig.pierX = px;
    prevCam.copy(cam.position);
    const prevShot = rig.shot;
    rig.update(s, s.p, side, false, 1 / 60, s.time);
    cam.updateMatrixWorld();
    if (!started) continue;
    // The camera in frame coordinates (the rig works in view coordinates: mirrored on a RIGHT).
    frameToView(cam.position, side, camF);
    if (Math.abs(camF.x - px) > 15 && Math.abs(s.p.x - px) > 15) {
      if (s.p.x > px + 15) r.passed = true;
      continue;
    }
    r.frames++;
    // Steps within a shot (the tube view is a cut, by design).
    if (prevShot === rig.shot) {
      r.maxStep = Math.max(r.maxStep, cam.position.distanceTo(prevCam));
      r.maxDy = Math.max(r.maxDy, Math.abs(cam.position.y - prevCam.y));
    }
    // The chase never goes inside the pier; the tube camera (1.2 m shoreward of the rider, by design
    // unaffected) can sit in a bent's plane — the pier dissolves round the camera there (PIER_FADE).
    if (insidePier(camF.x - px, camF.y, camF.z)) {
      if (rig.shot === 'tube') r.insideTube++;
      else r.inside++;
      r.longestInside = Math.max(r.longestInside, ++r.insideRun);
    } else r.insideRun = 0;
    if (Math.abs(camF.x - px) < PIER.width / 2 && camF.y >= PIER.capY) r.inDeck++;
    // Seen: no wave between (the drawn mesh, mirrored like the scene) and no undissolved pier part.
    chest.copy(s.p).addScaledVector(s.normal, 0.9);
    const chestV = frameToView(chest, side, new Vector3());
    dir.subVectors(chestV, cam.position);
    const dist = dir.length();
    front.scale.x = side === 'right' ? -1 : 1;
    front.updateMatrixWorld();
    ray.set(cam.position, dir.clone().normalize());
    ray.far = dist - 0.2;
    let seen = ray.intersectObject(front, false).length === 0;
    for (let d = 0.05; seen && d < dist - 0.3; d += 0.05) {
      q.copy(camF).lerp(chest, d / dist);
      if (insidePier(q.x - px, q.y, q.z) && pierFade(d) >= 0.5) {
        seen = false;
      }
    }
    if (s.mode === 'airborne') r.airFrames++;
    if (rig.shot === 'chase') {
      r.chase++;
      if (seen) r.chaseSeen++;
    } else if (rig.shot === 'tube') {
      r.tube++;
      if (seen) r.tubeSeen++;
    }
  }
  return { r, events, s };
}

const shot = (events: SurfEvent[]) => events.filter((e) => e.type === 'shotThePier');

describe('the camera through a pier pass (real wave, rig, pier)', () => {
  for (const side of ['left', 'right'] as const) {
    for (const zLane of LANES) {
      it(`${side.toUpperCase()}, lane z ≈ ${zLane.toFixed(2)}: never inside the pier or its deck, no pop, rider seen ≥ 90% of chase frames`, () => {
        const { r, events, s } = pierPass(side, (surfer, wave) => laneDriver(surfer, wave, zLane), 25);
        expect(shot(events)).toHaveLength(1);
        expect(s.mode).toBe('riding');
        expect(r.chase).toBeGreaterThan(60);
        expect(r.inside).toBe(0);
        expect(r.inDeck).toBe(0);
        expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
        // No pops: the camera moves smoothly (the rider runs ≈ 10–14 m/s: ≤ 0.25 m a frame; the deck's ceiling eases).
        expect(r.maxStep).toBeLessThan(0.45);
        expect(r.maxDy).toBeLessThan(0.2);
      });
    }

    it(`${side.toUpperCase()}, an ollie under the deck: the chase (pulled up for the air) stays under it, rider seen ≥ 90%`, () => {
      const { r, events, s } = pierPass(
        side,
        (surfer, wave, pier) => {
          const lane = laneDriver(surfer, wave, FACE_MID);
          let popped = false;
          return () => {
            const i = { ...lane() };
            // Load from 12 m out, pop at 7 m: in the air as the deck passes over.
            if (!popped && pier.ahead < 12) i.ollieDown = true;
            if (!popped && pier.ahead < 7) {
              popped = true;
              i.ollieDown = false;
              i.ollie = true;
            }
            return i;
          };
        },
        25,
      );
      expect(r.airFrames).toBeGreaterThan(10);
      expect(events.some((e) => e.type === 'launched')).toBe(true);
      expect(s.wipeoutReason).not.toBe('pierd');
      expect(shot(events)).toHaveLength(1);
      expect(r.inside).toBe(0);
      expect(r.inDeck).toBe(0);
      expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
      expect(r.maxStep).toBeLessThan(0.45);
    });

    it(`${side.toUpperCase()}, barrel passes at several rhythms: the tube camera is inside a bent at most 0.25 s at a time, the rider always seen ≥ 90%`, () => {
      for (const [extra, every, ahead] of [[0, 0.3, 4], [0.5, 0.7, 6], [1, 1.3, 3], [0.3, 0.5, 8]] as const) {
        let t = 0;
        let since = 0;
        const drive = () => () => {
          t += DT;
          if (t < extra) return { ...NO_INPUT, stall: true };
          since += DT;
          const pump = since >= every;
          if (pump) since = 0;
          return { ...NO_INPUT, pump };
        };
        const { r } = pierPass(side, drive, ahead, 'barrel');
        const label = `stall +${extra}, pump ${every}, pier ${ahead} m`;
        expect(r.inside, label).toBe(0);
        expect(r.inDeck, label).toBe(0);
        expect(r.longestInside, label).toBeLessThanOrEqual(15); // 60 Hz frames
        if (r.tube > 0) expect(r.tubeSeen / r.tube, label).toBeGreaterThanOrEqual(0.9);
      }
    });

    it(`${side.toUpperCase()}, in the barrel under the pier: the tube view (unaffected) sees the rider ≥ 90% past the pier dissolving round it`, () => {
      let since = 0;
      // Stalled into the barrel, then pumping to hold in it while the pier comes through.
      const pumpInTube = () => () => {
        since += DT;
        const pump = since >= 0.5;
        if (pump) since = 0;
        return { ...NO_INPUT, pump };
      };
      const { r, events } = pierPass(side, pumpInTube, 6, 'barrel');
      expect(r.maxStep).toBeLessThan(0.45);
      expect(shot(events)).toHaveLength(1);
      expect((shot(events)[0] as { inTube: boolean }).inTube).toBe(true);
      expect(r.tube).toBeGreaterThan(30);
      expect(r.tubeSeen / r.tube).toBeGreaterThanOrEqual(0.9);
      expect(r.inside).toBe(0); // no chase frame inside it
      expect(r.inDeck).toBe(0);
      // Where the tube camera passes through a bent, nothing of the pier is drawn within PIER_FADE.hidden of
      // it, and it doesn't stay there long.
      expect(pierFade(0)).toBe(0);
      expect(r.longestInside).toBeLessThanOrEqual(15);
    });
  }
});
