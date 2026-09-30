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
const C = SURF_CONFIG.camera;
/** Horizontal (xz) unit direction of v. */
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z).normalize();
/** Rider height used for the screen-size check (m, crouched, along the board normal). */
const RIDER_HEIGHT = 1.5;

describe('cameraGoal', () => {
  it('chase: a close bird’s-eye view from behind — behind the rider along their travel, high above the crest, looking down at a point ahead of them', () => {
    const { wave, s } = world(); // canonical frame = a LEFT: the rider travels +x
    s.heading.set(1, 0, 0);
    const g = cameraGoal(s, 'left', 'chase', wave, goal());
    expect(g.pos.x).toBeCloseTo(s.p.x - C.chaseBack, 9);
    expect(g.pos.z).toBeCloseTo(s.p.z, 9);
    expect(g.pos.y).toBeGreaterThanOrEqual(s.p.y + C.chaseHeight - 1e-9);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(g.pos.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(s.p.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.look.x).toBeCloseTo(s.p.x + C.chaseAhead, 9);
    expect(g.look.y).toBeLessThan(g.pos.y - 3); // looking down
  });
  it('sits behind the actual travel direction, whichever way the rider is going', () => {
    const { wave, s } = world();
    const yaw = 30 * (Math.PI / 180);
    for (const h of [new Vector3(Math.cos(yaw), -0.3, -Math.sin(yaw)), new Vector3(-1, 0, 0.2), new Vector3(-0.3, 0.1, 1)]) {
      s.heading.copy(h).normalize();
      const g = cameraGoal(s, 'left', 'chase', wave, goal());
      expect(flat(new Vector3().subVectors(s.p, g.pos)).dot(flat(s.heading))).toBeCloseTo(1, 9);
      expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(g.pos.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    }
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
  it('tube, heading deeper toward the curl: behind the rider on the mouth side, looking in', () => {
    const { wave, s } = world();
    s.p.set(-2, 0.8, 2);
    s.normal.set(0, 0.3, 1).normalize();
    s.heading.set(-1, 0, 0);
    const g = cameraGoal(s, 'left', 'tube', wave, goal());
    expect(g.pos.x).toBeCloseTo(s.p.x + CAMERA_OFFSETS.tube.back, 9);
    expect(g.look.x).toBeLessThan(s.p.x);
  });
  it('never puts a tube camera behind tubeMinX (the barrel is closed there)', () => {
    const { wave, s } = world();
    s.p.x = -4.5;
    s.heading.set(1, 0, 0);
    expect(cameraGoal(s, 'left', 'tube', wave, goal()).pos.x).toBe(C.tubeMinX);
    expect(cameraGoal(s, 'right', 'tube', wave, goal()).pos.x).toBe(-C.tubeMinX);
    expect(cameraGoal(s, 'left', 'chase', wave, goal()).pos.x).toBeCloseTo(-4.5 - C.chaseBack, 9);
  });
  it('pulls back and up modestly in a trick air', () => {
    const { s } = world();
    const ground = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    const air = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    expect(air.length() / ground.length()).toBeGreaterThan(1.2);
    expect(air.length() / ground.length()).toBeLessThan(1.5);
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
  it("follows the rider's own motion closely but smooths jolts (a pump's kick doesn't lurch the view), and settles on the chase goal", () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    s.heading.set(1, 0, 0);
    rig.snap(s, 'left');
    const offset = rig.pos.clone().sub(s.p);
    // A jolt: the rider jumps 0.2 m in one frame. The camera takes a fraction of it.
    const before = rig.pos.clone();
    s.p.z += 0.2;
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.z - before.z).toBeLessThan(0.1);
    expect(rig.pos.z - before.z).toBeGreaterThan(0);
    // A stall: the rider slides back toward the curl at 5 m/s for 1 s. The camera keeps up.
    for (let i = 0; i < 60; i++) {
      s.p.x -= 5 / 60;
      rig.update(s, s.p, 'left', false, 1 / 60);
    }
    expect(rig.pos.clone().sub(s.p).distanceTo(offset)).toBeLessThan(0.8);
    for (let i = 0; i < 600; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'chase', wave, goal()).pos)).toBeLessThan(0.01);
  });
  it('eases its travel direction: a sudden 40° change of heading does not whip the camera round', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    s.heading.set(1, 0, 0);
    rig.snap(s, 'left');
    const yaw = 40 * (Math.PI / 180);
    s.heading.set(Math.cos(yaw), 0, Math.sin(yaw));
    for (let i = 0; i < 6; i++) rig.update(s, s.p, 'left', false, 1 / 60); // 0.1 s
    const back = flat(new Vector3().subVectors(s.p, rig.pos));
    expect(Math.acos(back.x) / (Math.PI / 180)).toBeLessThan(10);
    for (let i = 0; i < 300; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(flat(new Vector3().subVectors(s.p, rig.pos)).dot(flat(s.heading))).toBeGreaterThan(0.999);
  });
  it('the tube camera keeps its side while the heading wavers around straight to shore: it never jumps or crowds the rider', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    s.p.set(-1, 0.6, 2);
    s.normal.set(0, 0.5, 1).normalize();
    s.inTube = true;
    s.heading.set(0.05, 0, 1).normalize();
    rig.snap(s, 'left');
    let minDist = Infinity;
    let maxJump = 0;
    let wasTube = false;
    const last = rig.pos.clone();
    for (let i = 0; i < 240; i++) {
      s.heading.set(0.05 * Math.sin(i * 0.9), 0, 1).normalize(); // heading.x flips sign every few frames
      rig.update(s, s.p, 'left', false, 1 / 60);
      if (rig.shot === 'tube') {
        minDist = Math.min(minDist, rig.pos.distanceTo(s.p));
        if (wasTube) maxJump = Math.max(maxJump, rig.pos.distanceTo(last));
      }
      wasTube = rig.shot === 'tube';
      last.copy(rig.pos);
    }
    expect(minDist).toBeGreaterThanOrEqual(1.5);
    expect(maxJump).toBeLessThan(0.3);
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
    frames(C.tubeCutIn - 0.05);
    expect(rig.shot).toBe('chase');
    frames(0.1);
    expect(rig.shot).toBe('tube');
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'tube', wave, goal()).pos)).toBeLessThan(1e-9); // a cut, not a glide
    s.inTube = false;
    s.p.set(6, 1.2, 2.5); // out on the open face (beyond the pocket)
    frames(C.tubeCutOut + 0.05);
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
 * probe every rendered frame (16:9, e.g. 1280×720): where the camera is, whether it is under the
 * water, whether the rider's chest is on screen with no wave surface in between, and how big the
 * rider is on screen.
 */
function probe(drive: (surfer: Surfer, wave: WaveShape) => (dt: number) => SurferInput, seconds: number) {
  const { cfg, wave, surfer, s } = world();
  const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
  front.updateMatrixWorld();
  const aspect = 16 / 9;
  const cam = new PerspectiveCamera(cfg.camera.fov, aspect, 0.1, 650);
  const rig = new CameraRig(cam, cfg.camera, wave);
  rig.snap(s, 'left');
  const input = drive(surfer, wave);
  const ray = new Raycaster();
  const chest = new Vector3();
  const head = new Vector3();
  const feet = new Vector3();
  const dir = new Vector3();
  const ndc = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const r = {
    chase: 0,
    chaseSeen: 0,
    behind: 0,
    behindTravel: 0,
    lookingDownTheLine: 0,
    lookingDown: 0,
    aboveCrest: 0,
    big: 0,
    minSize: Infinity,
    tube: 0,
    tubeSeen: 0,
    tubeMinDist: Infinity,
    frames: 0,
    seen: 0,
    wet: 0,
  };
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
      // camera → rider (horizontal) along the rider's travel (horizontal heading)
      if (flat(dir.subVectors(s.p, cam.position)).dot(flat(s.heading)) > 0.6) r.behindTravel++;
      if (rig.look.x > cam.position.x) r.lookingDownTheLine++;
      if (rig.look.y < cam.position.y) r.lookingDown++;
      if (cam.position.y > wave.crestY(cam.position.x)) r.aboveCrest++;
      // Projected rider height as a fraction of the viewport height.
      feet.copy(s.p).project(cam);
      head.copy(s.p).addScaledVector(s.normal, RIDER_HEIGHT).project(cam);
      const size = Math.hypot((head.x - feet.x) * aspect, head.y - feet.y) / 2;
      r.minSize = Math.min(r.minSize, size);
      if (size >= 0.12) r.big++;
    } else if (rig.shot === 'tube') {
      r.tube++;
      if (seen) r.tubeSeen++;
      r.tubeMinDist = Math.min(r.tubeMinDist, cam.position.distanceTo(s.p));
    }
  }
  return r;
}

describe('CameraRig on the real wave (ray / visibility probes)', () => {
  it('a 30 s S-turn ride: every chase frame is behind the rider, looking down the line and down at them, above the crest; the rider is seen ≥ 90% and big on screen; never under water', () => {
    const r = probe((surfer, wave) => lineBot(surfer, wave, { pumpEvery: 1 }), 30);
    expect(r.chase).toBeGreaterThan(1500);
    expect(r.behind).toBe(r.chase);
    expect(r.behindTravel / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.lookingDownTheLine).toBe(r.chase);
    expect(r.lookingDown).toBe(r.chase);
    expect(r.aboveCrest).toBe(r.chase);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.big / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
  it('no input until swallowed: chase then tube view, rider seen ≥ 90% of chase frames and ≥ 90% overall, never under water', () => {
    const r = probe(() => () => NO_INPUT, 10);
    expect(r.tube).toBeGreaterThan(0);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.seen / r.frames).toBeGreaterThanOrEqual(0.9);
    expect(r.big / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
  it('a barrel (stall while carving, release as the curl arrives, pump out): the tube view and the chase each see the rider ≥ 90%, never under water', () => {
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
    expect(r.tubeMinDist).toBeGreaterThanOrEqual(1.5);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.behindTravel / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
});

describe('a cutback: the camera swings round behind the new travel direction', () => {
  // [start x, script, turn time (s), reverses toward the curl, far out (the reversal must leave settled-line samples)]
  // 'lip': down the line with lineBot until the first climb into the top band (≥ 0.72 × crest) after 1 s,
  //   then hold a carve-back (−1) through the lip snap until the board heads back toward the curl
  //   (heading.x < −0.5), then straight: a genuine turn back toward the curl (snap + bottom turn).
  // 'carve': lineBot until the turn time, then hold carve −1 for ≤ 1.2 s (down the face; overshooting
  //   the fall line, the bottom turn carries on toward the curl, else back down the line).
  it.each([
    [30, 'lip', 1, true, true],
    [26, 'lip', 1, true, true],
    [22, 'lip', 1, true, false],
    [18, 'lip', 1, true, false],
    [12, 'lip', 1, true, false],
    [10, 'lip', 1, true, false],
    [8, 'lip', 1, true, false],
    [8, 'carve', 1.4, true, false],
    [12, 'carve', 1.7, true, false],
    [22, 'carve', 1.4, true, false],
    [26, 'carve', 1.5, false, false],
    [10, 'carve', 1.5, false, false],
    [14, 'carve', 0.8, false, false],
    [18, 'carve', 2.0, false, false],
  ] as const)('from x = %s (%s turn, %s s; reversal %s): the camera is clearly in front of the travel for ≤ 0.5 s at a stretch, sees the rider in ≥ 90 percent of chase frames, never sways sideways, never crowds the rider, stays above the crest and out of the water', (x0, script, turnAt, reverses, farOut) => {
    {
      const cfg = structuredClone(SURF_CONFIG);
      const wave = new WaveShape(cfg.wave);
      const bus = new EventBus<SurfEvent>();
      let snaps = 0;
      bus.onAny((e) => {
        if (e.type === 'snap') snaps++;
      });
      const surfer = new Surfer(wave, cfg.physics, bus);
      const s = surfer.state;
      const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
      front.updateMatrixWorld();
      surfer.reset(x0, 0.5);
      const cam = new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650);
      const rig = new CameraRig(cam, cfg.camera, wave);
      rig.snap(s, 'left');
      const bot = lineBot(surfer, wave, { pumpEvery: 1 });
      const ray = new Raycaster();
      const UP = new Vector3(0, 1, 0);
      const back = new Vector3();
      let run = 0;
      let longest = 0;
      let reversed = 0;
      let wet = 0;
      let below = 0;
      let facingBack = 0;
      const zs: number[] = [];
      const chest = new Vector3();
      const dir = new Vector3();
      let chase = 0;
      let chaseSeen = 0;
      let minDist = Infinity;
      let lastZ = NaN;
      let maxStep = 0;
      let reversedAt = -1;
      let phase: 'line' | 'turn' | 'straight' = 'line';
      let turnStart = -1;
      let backAt = -1;
      let maxTick = 0;
      const lastHeading = s.heading.clone();
      const input = (): SurferInput => {
        const t = s.time;
        if (script === 'carve') return t < turnAt ? bot(1 / 120) : t < turnAt + 1.2 && s.heading.x > -0.9 ? { ...NO_INPUT, carve: -1 } : NO_INPUT;
        if (phase === 'line' && t > turnAt && s.heading.y > 0.05 && s.p.y > 0.72 * wave.crestY(s.param.x)) {
          phase = 'turn';
          turnStart = t;
        }
        if (phase === 'turn' && (s.heading.x < -0.5 || t - turnStart > 2)) phase = 'straight';
        return phase === 'line' ? bot(1 / 120) : phase === 'turn' ? { ...NO_INPUT, carve: -1 } : NO_INPUT;
      };
      for (let f = 0; f < 6 * 60; f++) {
        for (let k = 0; k < 2; k++) {
          surfer.step(input(), 1 / 120);
          // The board turns with the rail: never a one-tick heading snap (e.g. off the trough).
          if (s.mode === 'riding') maxTick = Math.max(maxTick, lastHeading.angleTo(s.heading));
          lastHeading.copy(s.heading);
          if (backAt < 0 && s.heading.x < -0.5) backAt = s.time;
        }
        rig.update(s, s.p, 'left', false, 1 / 60, s.time);
        if (s.mode !== 'riding' && s.mode !== 'airborne') break;
        if (s.heading.x < -0.9) {
          reversed++;
          if (reversedAt < 0) reversedAt = s.time;
        }
        if (rig.shot !== 'underwater') minDist = Math.min(minDist, rig.pos.distanceTo(s.p));
        if (rig.shot === 'chase') {
          chase++;
          chest.copy(s.p).addScaledVector(s.normal, 0.9);
          dir.subVectors(chest, rig.pos);
          ray.set(rig.pos, dir.clone().normalize());
          ray.far = dir.length() - 0.2;
          cam.updateMatrixWorld();
          const ndc = chest.clone().project(cam);
          if (ray.intersectObject(front, false).length === 0 && ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95) chaseSeen++;
        }
        // Clearly in front (not merely side-on, as when heading straight to shore past a tube camera).
        const inFront = rig.shot !== 'underwater' && flat(back.subVectors(s.p, rig.pos)).dot(flat(s.heading)) < -0.2;
        run = inFront ? run + 1 : 0;
        longest = Math.max(longest, run);
        if (rig.shot === 'chase' && rig.pos.y <= wave.crestY(rig.pos.x)) below++;
        ray.set(rig.pos, UP);
        ray.far = 50;
        const above = ray.intersectObject(front, false)[0];
        if (above && above.face!.normal.y > 0) wet++;
        // A straight run toward the curl, long after the swing: the camera holds its line.
        // Heading straight for the curl: the camera never lurches sideways (no ±yaw flips) …
        if (s.heading.x < -0.9 && rig.shot === 'chase') {
          const z = rig.pos.z - s.p.z;
          if (!Number.isNaN(lastZ)) maxStep = Math.max(maxStep, Math.abs(z - lastZ));
          lastZ = z;
          // … and once the swing has settled (5 time constants of chaseYawRate after the board came
          // round: a 180° swing is then within 2°) it holds its line.
          if (s.time > 4 && s.time - reversedAt >= 5 / C.chaseYawRate) zs.push(z);
        } else lastZ = NaN;
        if (rig.keyFacing === -1) facingBack++;
      }
      if (reverses) expect(reversed).toBeGreaterThan(30);
      else expect(reversed).toBe(0);
      expect(maxTick).toBeLessThanOrEqual(15 * (Math.PI / 180));
      if (script === 'lip') {
        // A genuine turn back toward the curl: a lip snap, then heading −x.
        expect(snaps).toBeGreaterThan(0);
        expect(backAt).toBeGreaterThan(turnStart);
      }
      if (farOut) expect(zs.length).toBeGreaterThan(0);
      expect(longest / 60).toBeLessThanOrEqual(0.5);
      expect(chaseSeen / chase).toBeGreaterThanOrEqual(0.9);
      expect(minDist).toBeGreaterThanOrEqual(1.5);
      expect(below).toBe(0);
      expect(wet).toBe(0);
      if (reverses) expect(facingBack).toBeGreaterThan(0);
      expect(maxStep).toBeLessThan(0.15); // m per frame (the old ±50° target flips swayed it ~5 m)
      if (zs.length > 0) expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.3);
    }
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
    expect(carveFromKeys(false, true, side, rig.keyFacing) === 1).toBe(lipOnRight);
  });
  it.each(['left', 'right'] as const)('on a %s in the tube heading deeper toward the curl (mouth-side tube camera), → is still toward the lip on screen', (side: Side) => {
    const { wave, s } = world();
    s.p.copy(wave.profile(-1, 0.3));
    s.param.x = -1;
    s.param.t = 0.3;
    s.normal.set(0, 0.5, 1).normalize();
    s.heading.set(-1, 0, 0);
    s.inTube = true;
    const cam = new PerspectiveCamera(SURF_CONFIG.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, SURF_CONFIG.camera, wave);
    rig.snap(s, side);
    for (let i = 0; i < 30; i++) rig.update(s, s.p, side, false, 1 / 60);
    expect(rig.shot).toBe('tube');
    cam.updateMatrixWorld();
    expect(rig.keyFacing).toBe(-1);
    const lip = wave.profile(s.param.x, Math.min(1, s.param.t + 0.05));
    const lipOnRight = frameToView(lip, side, new Vector3()).project(cam).x > frameToView(s.p, side, new Vector3()).project(cam).x;
    expect(carveFromKeys(false, true, side, rig.keyFacing) === 1).toBe(lipOnRight);
  });
  it.each(['left', 'right'] as const)('on a %s with the camera swung round behind a rider heading for the curl, → is still toward the lip on screen', (side: Side) => {
    const { wave, s } = world();
    s.p.copy(wave.profile(20, 0.3));
    s.param.x = 20;
    s.param.t = 0.3;
    s.heading.set(-1, 0, 0);
    const cam = new PerspectiveCamera(SURF_CONFIG.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, SURF_CONFIG.camera, wave);
    rig.snap(s, side);
    cam.updateMatrixWorld();
    expect(rig.keyFacing).toBe(-1);
    const lip = wave.profile(s.param.x, Math.min(1, s.param.t + 0.05));
    const lipOnRight = frameToView(lip, side, new Vector3()).project(cam).x > frameToView(s.p, side, new Vector3()).project(cam).x;
    expect(carveFromKeys(false, true, side, rig.keyFacing) === 1).toBe(lipOnRight);
  });
});
