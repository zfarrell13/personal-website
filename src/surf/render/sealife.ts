import { Color, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { retroMaterial } from '@/retro/retroMaterial';
import { mulberry32 } from '../math/random';
import { fadeUnderwaterIntoFog } from './Environment';
import { LowPoly } from './lowpoly';
import { scrollWrap } from './scroll';
import { SHALLOWS, sandY } from './shallows';
import { SHORE } from './shore';

/**
 * Sea life in the clear shallows in front of the wave (see shallows.ts): starfish on the sand, a
 * school of sheepshead now and then, and a shark every once in a while. Everything lives on the reef
 * (world x) and scrolls past with the frame travel like the scenery; nothing has a gameplay effect.
 * Frame coordinates (+z toward shore); the group goes in the (mirrored) frame.
 */
export const SEA_LIFE = {
  /**
   * Half-width (m along the beach) of the band around each pier (SHORE.landmarkU) kept clear of sea
   * life: the pier's pilings will stand in the shallows there.
   */
  pierClearance: 14,
  /** Starfish: `count` per `span` metres of beach (repeating), in frame z ∈ z; drawn over [start, start + span). */
  starfish: { count: 5, span: 180, start: -50, z: [SHALLOWS.troughZ + 3.5, SHALLOWS.troughZ + 14] as const, radius: 0.45 },
  /** Sheepshead: a school of `fish` every `every` s (seeded), cruising at `speed` m/s for up to `life` s. */
  school: { every: [14, 32] as const, fish: [5, 8] as const, z: [SHALLOWS.troughZ + 4.5, SHALLOWS.troughZ + 18] as const, speed: 0.7, life: 40, spread: 2.4 },
  /**
   * The shark: first after `first` s, then every `every` s (seeded per run), `size` × the ~2.6 m model.
   * Mostly cruising down the line with the wave, so it stays in view a little longer as it goes by.
   */
  shark: { first: [30, 90] as const, every: [90, 150] as const, z: [SHALLOWS.troughZ + 6, SHALLOWS.troughZ + 16] as const, speed: 1.5, life: 40, size: 1.25 },
  /** Frame x (m) where swimmers appear while the frame scrolls: ahead, where the water is still opaque. */
  spawnAhead: [75, 115] as const,
  /** … and while it stands still (title, results): right in view. */
  spawnStill: [-5, 35] as const,
  /** Gone once scrolled this far behind (frame x, m) or this far ahead. */
  despawnBehind: -60,
  despawnAhead: 260,
  /** A frame scrolling faster than this (m/s) spawns ahead. */
  scrolling: 2,
  /** Fade in / out (s): scaled up from nothing and back. */
  fade: 1.2,
  /** A spawn whose path would cross the pier's band waits this long (s) and tries again. */
  retry: 2,
} as const;

const MAX_FISH = SEA_LIFE.school.fish[1];

/** Distance (m along the beach) from world x to the nearest pier (the shore strip wraps every SHORE.span). */
export function pierDistance(worldX: number): number {
  let best = Infinity;
  for (const U of SHORE.landmarkU) {
    const d = ((((worldX - U) % SHORE.span) + SHORE.span * 1.5) % SHORE.span) - SHORE.span / 2;
    best = Math.min(best, Math.abs(d));
  }
  return best;
}

/** Is the world-x range [x0, x1] clear of every pier's band? */
export function clearOfPier(x0: number, x1: number, clearance: number = SEA_LIFE.pierClearance): boolean {
  const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
  if (pierDistance(a) < clearance || pierDistance(b) < clearance) return false;
  for (const U of SHORE.landmarkU) {
    // The first copy of this pier at or after a.
    const k = Math.ceil((a - U) / SHORE.span);
    if (U + k * SHORE.span <= b) return false;
  }
  return true;
}

export interface StarfishSpot {
  worldX: number;
  z: number;
  rot: number;
  scale: number;
  tint: number;
}

/** Fixed starfish spots over one starfish span of beach (the pattern repeats). */
export function starfishLayout(): StarfishSpot[] {
  const r = mulberry32(0x5ea57a5);
  const { count, span, z } = SEA_LIFE.starfish;
  return Array.from({ length: count }, (_, i) => ({
    worldX: ((i + 0.2 + 0.6 * r()) / count) * span,
    z: z[0] + (z[1] - z[0]) * r(),
    rot: r() * Math.PI * 2,
    scale: 0.8 + 0.5 * r(),
    tint: Math.floor(r() * 3),
  }));
}

export interface SchoolMember {
  dx: number;
  dz: number;
  dy: number;
  phase: number;
  scale: number;
}

export interface Swimmer {
  kind: 'school' | 'shark';
  /** World x (on the reef) and frame z of its centre (m). */
  worldX: number;
  z: number;
  /** Swimming direction in the x-z plane (rad, 0 = +x, π/2 = +z). */
  heading: number;
  speed: number;
  age: number;
  life: number;
  members: SchoolMember[];
}

const between = (r: () => number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * r();

/**
 * When the school and the shark come by and where they swim (pure: no three). Times run on the clock
 * fed to update() (the water clock: it stops on pause). Seeded per run (the run's fast-section seed).
 */
export class SeaLifeSchedule {
  time = 0;
  school: Swimmer | null = null;
  shark: Swimmer | null = null;
  private rand = mulberry32(1);
  private nextSchool = 0;
  private nextShark = 0;
  private lastTravel = NaN;

  reset(seed: number): void {
    this.rand = mulberry32(seed ^ 0x51ab1e);
    this.time = 0;
    this.school = null;
    this.shark = null;
    this.lastTravel = NaN;
    this.nextSchool = between(this.rand, [3, SEA_LIFE.school.every[0]]);
    this.nextShark = between(this.rand, SEA_LIFE.shark.first);
  }

  update(dt: number, travel: number): void {
    const scrollSpeed = dt > 0 && Number.isFinite(this.lastTravel) ? (travel - this.lastTravel) / dt : 0;
    this.lastTravel = travel;
    if (dt <= 0) return;
    this.time += dt;
    this.school = this.move(this.school, dt, travel);
    this.shark = this.move(this.shark, dt, travel);
    const scrolling = Math.abs(scrollSpeed) > SEA_LIFE.scrolling;
    if (!this.school && this.time >= this.nextSchool) {
      const s = this.spawn('school', travel, scrolling);
      if (s) {
        this.school = s;
        this.nextSchool = this.time + between(this.rand, SEA_LIFE.school.every);
      } else this.nextSchool += SEA_LIFE.retry;
    }
    if (!this.shark && this.time >= this.nextShark) {
      const s = this.spawn('shark', travel, scrolling);
      if (s) {
        this.shark = s;
        this.nextShark = this.time + between(this.rand, SEA_LIFE.shark.every);
      } else this.nextShark += SEA_LIFE.retry;
    }
  }

  /** Debug: a shark now at frame x (doesn't move the schedule). Skipped if its path would cross the pier. */
  spawnShark(travel: number, frameX: number): void {
    const s = this.make('shark', travel + frameX, 0.25, SHALLOWS.troughZ + 9);
    s.age = SEA_LIFE.fade; // already faded in: it appears in view
    if (this.pathClear(s)) this.shark = s;
  }

  /** Debug: a school of sheepshead now at frame x, like spawnShark. */
  spawnSchool(travel: number, frameX: number): void {
    const s = this.make('school', travel + frameX, Math.PI - 0.2, SHALLOWS.troughZ + 8);
    s.age = SEA_LIFE.fade;
    if (this.pathClear(s)) this.school = s;
  }

  private spawn(kind: Swimmer['kind'], travel: number, scrolling: boolean): Swimmer | null {
    const r = this.rand;
    const cfg = SEA_LIFE[kind];
    const x = travel + between(r, scrolling ? SEA_LIFE.spawnAhead : SEA_LIFE.spawnStill);
    const along = r() < (kind === 'shark' ? 0.75 : 0.5);
    const heading = (along ? 0 : Math.PI) + (r() - 0.5) * (kind === 'school' ? 0.9 : 0.6);
    const s = this.make(kind, x, heading, between(r, cfg.z));
    return this.pathClear(s) ? s : null;
  }

  private make(kind: Swimmer['kind'], worldX: number, heading: number, z: number): Swimmer {
    const cfg = SEA_LIFE[kind];
    const members: SchoolMember[] = [];
    if (kind === 'school') {
      const r = this.rand;
      const n = Math.round(between(r, SEA_LIFE.school.fish));
      const spread = SEA_LIFE.school.spread;
      for (let i = 0; i < n; i++) members.push({ dx: (r() - 0.5) * spread, dz: (r() - 0.5) * spread * 0.6, dy: (r() - 0.5) * 0.25, phase: r() * Math.PI * 2, scale: 1.3 + 0.4 * r() });
    }
    return { kind, worldX, z, heading, speed: cfg.speed, age: 0, life: cfg.life, members };
  }

  /** Its whole possible path (it swims at most speed · life along x) stays clear of the pier's band. */
  private pathClear(s: Swimmer): boolean {
    const reach = s.speed * s.life + SEA_LIFE.school.spread;
    return clearOfPier(s.worldX - reach, s.worldX + reach);
  }

  private move(s: Swimmer | null, dt: number, travel: number): Swimmer | null {
    if (!s) return null;
    s.age += dt;
    const frameX = s.worldX - travel;
    if (s.age >= s.life || frameX < SEA_LIFE.despawnBehind || frameX > SEA_LIFE.despawnAhead) return null;
    s.worldX += Math.cos(s.heading) * s.speed * dt;
    s.z += Math.sin(s.heading) * s.speed * dt;
    // Stay in the shallows: turn back (mirror the z heading) at the edges.
    const [z0, z1] = SEA_LIFE[s.kind].z;
    if ((s.z < z0 && Math.sin(s.heading) < 0) || (s.z > z1 && Math.sin(s.heading) > 0)) s.heading = -s.heading;
    s.z = Math.min(z1, Math.max(z0, s.z));
    return s;
  }
}

/** Fade in and out (0 … 1) over SEA_LIFE.fade at both ends of a swimmer's life. */
export function swimmerFade(s: Swimmer): number {
  return Math.max(0, Math.min(1, s.age / SEA_LIFE.fade, (s.life - s.age) / SEA_LIFE.fade));
}

// ——— Low-poly models (flat-shaded vertex colours, nose along +x) ———

type Station = readonly [x: number, halfHeight: number, halfWidth: number, yCentre: number];
type P = [number, number, number];

/** A triangle facing away from `inside` (flipped if needed). */
function outTri(b: LowPoly, p: P, q: P, r: P, inside: P, color: Color | string): void {
  const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const c = [(p[0] + q[0] + r[0]) / 3 - inside[0], (p[1] + q[1] + r[1]) / 3 - inside[1], (p[2] + q[2] + r[2]) / 3 - inside[2]];
  if (n[0]! * c[0]! + n[1]! * c[1]! + n[2]! * c[2]! >= 0) b.tri(p, q, r, color);
  else b.tri(p, r, q, color);
}

/** A thin fin seen from both sides. */
function fin(b: LowPoly, p: P, q: P, r: P, color: Color | string): void {
  b.tri(p, q, r, color).tri(p, r, q, color);
}

/** A body of diamond cross-sections along x; segment k gets colours[k] on top and belly[k] below. */
function body(b: LowPoly, st: readonly Station[], top: readonly (Color | string)[], belly: readonly (Color | string)[]): void {
  const ring = ([x, h, w, y]: Station): P[] => [
    [x, y + h, 0],
    [x, y, w],
    [x, y - h, 0],
    [x, y, -w],
  ];
  for (let k = 0; k < st.length - 1; k++) {
    const [a, c] = [ring(st[k]!), ring(st[k + 1]!)];
    const inside: P = [(st[k]![0] + st[k + 1]![0]) / 2, (st[k]![3] + st[k + 1]![3]) / 2, 0];
    for (let j = 0; j < 4; j++) {
      const j1 = (j + 1) % 4;
      // Quads 0 (top → +z side) and 3 (−z side → top) are the back; 1 and 2 the belly.
      const color = j === 0 || j === 3 ? top[k]! : belly[k]!;
      outTri(b, a[j]!, a[j1]!, c[j1]!, inside, color);
      outTri(b, a[j]!, c[j1]!, c[j]!, inside, color);
    }
  }
}

/** Sheepshead (~0.5 m): deep, flat-sided, silver with five black bars, spiny dorsal, dark tail. */
export function buildSheepshead(): BufferGeometry {
  const b = new LowPoly();
  // Flat-sided, but drawn a little broader than life so the bars read from the chase camera above.
  const st: Station[] = [
    [0.22, 0.012, 0.012, 0],
    [0.18, 0.06, 0.045, 0],
    [0.12, 0.11, 0.07, 0],
    [0.06, 0.13, 0.08, 0],
    [0.0, 0.135, 0.08, 0],
    [-0.06, 0.125, 0.07, 0],
    [-0.11, 0.095, 0.055, 0],
    [-0.15, 0.055, 0.03, 0],
    [-0.18, 0.03, 0.015, 0],
  ];
  const [silver, bar, head] = ['#d7dedf', '#15191b', '#4a5356'];
  const bands = [head, silver, bar, silver, bar, silver, bar, silver];
  body(b, st, bands, bands);
  fin(b, [0.08, 0.125, 0], [-0.1, 0.115, 0], [-0.02, 0.21, 0], bar);
  fin(b, [-0.17, 0.02, 0], [-0.29, 0.11, 0], [-0.26, 0, 0], bar);
  fin(b, [-0.17, -0.02, 0], [-0.26, 0, 0], [-0.29, -0.11, 0], bar);
  return b.build();
}

/** A ~2.6 m shark: grey back, pale belly, swept dorsal, pectorals and a tall upper tail lobe. */
export function buildShark(): BufferGeometry {
  const b = new LowPoly();
  const st: Station[] = [
    [1.25, 0.02, 0.02, 0],
    [1.1, 0.1, 0.13, -0.01],
    [0.8, 0.2, 0.23, 0],
    [0.4, 0.25, 0.28, 0],
    [0.0, 0.24, 0.25, 0],
    [-0.4, 0.18, 0.17, 0.01],
    [-0.75, 0.1, 0.09, 0.02],
    [-1.0, 0.05, 0.04, 0.03],
  ];
  const [back, belly] = ['#56626b', '#c4c9c9'];
  body(b, st, st.map(() => back), st.map(() => belly));
  fin(b, [0.28, 0.24, 0], [-0.18, 0.21, 0], [-0.16, 0.62, 0], back);
  for (const s of [-1, 1]) fin(b, [0.5, -0.08, 0.22 * s], [0.18, -0.1, 0.25 * s], [0.02, -0.22, 0.9 * s], back);
  fin(b, [-0.92, 0.07, 0], [-1.08, 0.04, 0], [-1.45, 0.52, 0], back);
  fin(b, [-0.95, 0.01, 0], [-1.3, -0.3, 0], [-1.08, 0.0, 0], back);
  return b.build();
}

/** A five-armed starfish (radius 1, lying flat, raised in the middle). */
export function buildStarfish(): BufferGeometry {
  const b = new LowPoly();
  const centre: P = [0, 0.18, 0];
  const ring: P[] = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.4;
    return [Math.cos(a) * r, 0.02, Math.sin(a) * r];
  });
  for (let i = 0; i < 10; i++) b.tri(centre, ring[(i + 1) % 10]!, ring[i]!, i % 2 === 0 ? '#ee7a34' : '#d8602a');
  return b.build();
}

const STAR_TINTS = [new Color('#ffffff'), new Color('#ff9a8c'), new Color('#c9a6ff')];

/**
 * The sea life's meshes (3 draw calls: starfish, the school, the shark): opaque, lit and fogged,
 * drawn before the translucent water, which tints them. update(dt, travel) moves the schedule on.
 */
export class SeaLife {
  readonly group = new Group();
  readonly schedule = new SeaLifeSchedule();
  private readonly material = retroMaterial(fadeUnderwaterIntoFog(new MeshLambertMaterial({ vertexColors: true })));
  private readonly stars: InstancedMesh;
  private readonly fish: InstancedMesh;
  private readonly shark: Mesh;
  private readonly spots = starfishLayout();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'sealife';
    this.stars = new InstancedMesh(buildStarfish(), this.material, this.spots.length);
    this.stars.name = 'starfish';
    this.spots.forEach((sp, i) => this.stars.setColorAt(i, STAR_TINTS[sp.tint]!));
    this.fish = new InstancedMesh(buildSheepshead(), this.material, MAX_FISH);
    this.fish.name = 'sheepshead';
    this.fish.count = 0;
    this.shark = new Mesh(buildShark(), this.material);
    this.shark.name = 'shark';
    this.shark.visible = false;
    for (const o of [this.stars, this.fish, this.shark]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
  }

  reset(seed: number): void {
    this.schedule.reset(seed);
  }

  /** Debug: a shark now, `frameX` metres down the line. */
  spawnShark(travel: number, frameX = 30): void {
    this.schedule.spawnShark(travel, frameX);
  }

  /** Debug: a school of sheepshead now, `frameX` metres down the line. */
  spawnSchool(travel: number, frameX = 25): void {
    this.schedule.spawnSchool(travel, frameX);
  }

  /** `dt` = water-clock step (0 while paused), `travel` = frame distance along the reef. */
  update(dt: number, travel: number): void {
    const sch = this.schedule;
    sch.update(dt, travel);
    const t = sch.time;
    const { m, q, p, s, up } = this;

    const { span, start, radius } = SEA_LIFE.starfish;
    this.spots.forEach((sp, i) => {
      const x = scrollWrap(sp.worldX, travel, span, start);
      const k = pierDistance(x + travel) < SEA_LIFE.pierClearance ? 0 : sp.scale * radius;
      q.setFromAxisAngle(up, sp.rot);
      m.compose(p.set(x, sandY(sp.z) + 0.01, sp.z), q, s.set(k, k, k));
      this.stars.setMatrixAt(i, m);
    });
    this.stars.instanceMatrix.needsUpdate = true;

    const school = sch.school;
    this.fish.count = school ? school.members.length : 0;
    if (school) {
      const fade = swimmerFade(school);
      school.members.forEach((f, i) => {
        const x = school.worldX - travel + f.dx + 0.3 * Math.sin(t * 0.7 + f.phase);
        const z = school.z + f.dz + 0.2 * Math.sin(t * 0.5 + f.phase * 1.7);
        q.setFromAxisAngle(up, -(school.heading + 0.22 * Math.sin(t * 7 + f.phase)));
        const k = fade * f.scale;
        m.compose(p.set(x, Math.min(-0.7, sandY(z) + 0.35 + f.dy), z), q, s.set(k, k, k));
        this.fish.setMatrixAt(i, m);
      });
      this.fish.instanceMatrix.needsUpdate = true;
    }

    const shark = sch.shark;
    this.shark.visible = shark !== null;
    if (shark) {
      this.shark.position.set(shark.worldX - travel, Math.min(-1.0, sandY(shark.z) + 0.6), shark.z);
      this.shark.rotation.set(0, -(shark.heading + 0.12 * Math.sin(t * 2.6)), 0);
      this.shark.scale.setScalar(swimmerFade(shark) * SEA_LIFE.shark.size);
    }
  }

  dispose(): void {
    for (const o of [this.stars, this.fish, this.shark]) o.geometry.dispose();
    this.stars.dispose();
    this.fish.dispose();
    this.material.dispose();
  }
}
