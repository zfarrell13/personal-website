import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3, type Material } from 'three';
import { SHORE } from './shore';
import { SHALLOWS, sandY } from './shallows';
import { clearOfPier, createSeaLifeMaterial, pierDistance, SEA_LIFE, SeaLife, SeaLifeSchedule, starfishLayout, type Swimmer } from './sealife';

const PEEL = 8;
const DT = 0.1;

/** Runs a schedule for `seconds` with the frame travelling at `speed`, calling `each` every step. */
function run(seed: number, seconds: number, speed = PEEL, each?: (s: SeaLifeSchedule, travel: number) => void) {
  const s = new SeaLifeSchedule();
  s.reset(seed);
  let travel = 0;
  const sharks: number[] = [];
  const schools: number[] = [];
  let lastShark: Swimmer | null = null;
  let lastSchool: Swimmer | null = null;
  for (let t = 0; t < seconds; t += DT) {
    travel += speed * DT;
    s.update(DT, travel);
    if (s.shark && s.shark !== lastShark) sharks.push(s.time);
    if (s.school && s.school !== lastSchool) schools.push(s.time);
    lastShark = s.shark;
    lastSchool = s.school;
    each?.(s, travel);
  }
  return { sharks, schools };
}

describe('pier keep-out', () => {
  it('measures the distance along the beach to the nearest pier, wrapping with the shore strip', () => {
    for (const U of SHORE.landmarkU) {
      expect(pierDistance(U)).toBeCloseTo(0, 6);
      expect(pierDistance(U + 10)).toBeCloseTo(10, 6);
      expect(pierDistance(U - 7 + SHORE.span)).toBeCloseTo(7, 6);
    }
    expect(clearOfPier(SHORE.landmarkU[0]! - 5, SHORE.landmarkU[0]! + 5)).toBe(false);
    expect(clearOfPier(SHORE.landmarkU[0]! + SEA_LIFE.pierClearance + 1, SHORE.landmarkU[0]! + 200)).toBe(true);
    // A range spanning the pier is not clear even with both ends far from it.
    expect(clearOfPier(SHORE.landmarkU[0]! - 100, SHORE.landmarkU[0]! + 100)).toBe(false);
  });
});

describe('sea life schedule', () => {
  it('a shark every once in a while: first within ~1½ min, then every 1½–2½ min', () => {
    const { sharks } = run(7, 30 * 60);
    const [lo, hi] = SEA_LIFE.shark.every;
    expect(sharks[0]!).toBeGreaterThanOrEqual(SEA_LIFE.shark.first[0]);
    expect(sharks[0]!).toBeLessThan(SEA_LIFE.shark.first[1] + 20);
    for (let i = 1; i < sharks.length; i++) {
      const gap = sharks[i]! - sharks[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(lo - 1e-6);
      // Deferred a little when its path would cross the pier.
      expect(gap).toBeLessThan(hi + 20);
    }
    expect(sharks.length).toBeGreaterThanOrEqual(10);
    expect(sharks.length).toBeLessThanOrEqual(20);
  });

  it('is seeded per run: the same seed replays the same sea life, another differs', () => {
    expect(run(42, 600)).toEqual(run(42, 600));
    expect(run(42, 600).sharks).not.toEqual(run(43, 600).sharks);
  });

  it('a school of sheepshead now and then', () => {
    const { schools } = run(3, 10 * 60);
    expect(schools.length).toBeGreaterThan(8);
    expect(schools.length).toBeLessThan(40);
  });

  it('swims only in the shallows in front of the wave, clear of the rider\'s line and of the pier', () => {
    const minZ = SHALLOWS.troughZ + 3;
    run(11, 20 * 60, PEEL, (s, travel) => {
      for (const w of [s.school, s.shark]) {
        if (!w) continue;
        expect(w.z).toBeGreaterThanOrEqual(minZ);
        expect(w.z).toBeLessThanOrEqual(SHALLOWS.fadeFrom + 5);
        expect(pierDistance(w.worldX)).toBeGreaterThanOrEqual(SEA_LIFE.pierClearance);
        // Spawned out of sight ahead, scrolled past and gone behind.
        if (w.age === 0) expect(w.worldX - travel).toBeGreaterThanOrEqual(SEA_LIFE.spawnAhead[0]);
        expect(w.worldX - travel).toBeGreaterThan(SEA_LIFE.despawnBehind - 1);
      }
    });
  });

  it('with the frame still (title), spawns in view instead of far ahead', () => {
    run(5, 200, 0, (s) => {
      for (const w of [s.school, s.shark]) if (w) expect(w.worldX).toBeLessThan(SEA_LIFE.spawnStill[1] + w.speed * w.life + 1);
    });
  });

  it('spawnShark brings one in now, where the camera sees it (the debug hook)', () => {
    const s = new SeaLifeSchedule();
    s.reset(1);
    s.update(DT, 0);
    expect(s.shark).toBeNull();
    s.spawnShark(100, 30);
    expect(s.shark).not.toBeNull();
    expect(s.shark!.worldX - 100).toBeCloseTo(30, 6);
  });
});

describe('starfish', () => {
  it('lie on the sand in the clear shallows, a few per stretch of beach', () => {
    const stars = starfishLayout();
    expect(stars.length).toBeGreaterThanOrEqual(3);
    for (const st of stars) {
      expect(st.z).toBeGreaterThanOrEqual(SHALLOWS.troughZ + 3);
      expect(st.z).toBeLessThanOrEqual(SHALLOWS.fadeFrom);
      expect(st.worldX).toBeGreaterThanOrEqual(0);
      expect(st.worldX).toBeLessThan(SEA_LIFE.starfish.span);
    }
  });
});

describe('SeaLife (render)', () => {
  const instancesOf = (m: InstancedMesh) => {
    const out: Vector3[] = [];
    const mat = new Matrix4();
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, mat);
      const p = new Vector3().setFromMatrixPosition(mat);
      const sc = new Vector3().setFromMatrixScale(mat);
      if (sc.x > 1e-6) out.push(p);
    }
    return out;
  };

  it('draws in three opaque objects under the water: starfish, the school and the shark', () => {
    const life = new SeaLife();
    const meshes: Mesh[] = [];
    life.group.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(3);
    for (const m of meshes) expect((m.material as Material).transparent).toBe(false);
    life.dispose();
  });

  it('starfish sit on the sand bed, and never in the pier\'s band', () => {
    const life = new SeaLife();
    life.reset(1);
    const stars = life.group.getObjectByName('starfish') as InstancedMesh;
    for (let travel = 0; travel < SHORE.span; travel += 13) {
      life.update(DT, travel);
      for (const p of instancesOf(stars)) {
        expect(p.y).toBeCloseTo(sandY(p.z) + 0.01, 2);
        expect(pierDistance(p.x + travel)).toBeGreaterThanOrEqual(SEA_LIFE.pierClearance);
      }
    }
    life.dispose();
  });

  it('fish and shark swim under the water, above the sand, and are drawn only while there is one', () => {
    const life = new SeaLife();
    life.reset(1);
    life.update(DT, 0);
    const shark = life.group.getObjectByName('shark') as InstancedMesh;
    expect(shark.count).toBe(0);
    life.spawnShark(0, 20);
    for (let i = 0; i < 20; i++) life.update(DT, 0);
    expect(shark.count).toBe(1);
    const [p] = instancesOf(shark);
    expect(p!.y).toBeLessThan(-0.8);
    expect(p!.y).toBeGreaterThan(sandY(p!.z));
    life.dispose();
  });

  it('fades swimmers in and out by dissolving them (per-instance aFade), never by scaling from nothing', () => {
    const life = new SeaLife();
    life.reset(2);
    const fish = life.group.getObjectByName('sheepshead') as InstancedMesh;
    // A still frame (title): the school spawns in view, so it must fade in.
    let t = 0;
    while (!life.schedule.school && t < 60) {
      life.update(DT, 0);
      t += DT;
    }
    expect(life.schedule.school).not.toBeNull();
    life.update(DT, 0);
    const fade = fish.geometry.getAttribute('aFade');
    expect(fade.getX(0)).toBeGreaterThan(0);
    expect(fade.getX(0)).toBeLessThan(1);
    const mat = new Matrix4();
    fish.getMatrixAt(0, mat);
    const sc = new Vector3().setFromMatrixScale(mat);
    expect(sc.x).toBeGreaterThanOrEqual(SEA_LIFE.school.size * 1.3 - 1e-6);
    for (let i = 0; i < 20; i++) life.update(DT, 0);
    expect(fade.getX(0)).toBe(1);
    life.dispose();
  });

  it('the dither fade keeps the material opaque', () => {
    const m = createSeaLifeMaterial();
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>' };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(m.transparent).toBe(false);
    expect(shader.vertexShader).toContain('attribute float aFade;');
    expect(shader.fragmentShader).toContain('discard');
    m.dispose();
  });
});
