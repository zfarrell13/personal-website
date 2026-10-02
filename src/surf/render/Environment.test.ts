import { describe, expect, it } from 'vitest';
import { Box3, Mesh, PerspectiveCamera, Scene, type Material } from 'three';
import { CAMERA_FAR } from '../camera/CameraRig';
import { FOG_CONFIG, SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { createSeaFloorMaterial, Environment, FLOOR_FOG_FADE } from './Environment';
import { nearestPier, PIER, pierFrameX, PIER_TRACK, pierRows } from '../pier/track';
import { SHORE } from './shore';
import { seaReflection } from './sky';
import { buildWaveGeometry, columnsX } from './waveGeometry';

describe('Environment underwater cut', () => {
  it('turns the water\'s sky reflection off underwater (no bright rim from below) and back on', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    expect(seaReflection.uReflect.value).toBe(1);
    env.setUnderwater(true);
    expect(seaReflection.uReflect.value).toBe(0);
    env.setUnderwater(false);
    expect(seaReflection.uReflect.value).toBe(1);
    env.setUnderwater(true);
    env.dispose();
    expect(seaReflection.uReflect.value).toBe(1);
  });

  it('swaps to the underwater fog/background, hides the sky and sun, and restores them', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 650);
    const env = new Environment(scene, camera);
    const surfaceFog = scene.fog;
    const surfaceBg = scene.background;
    const visible = () => scene.children.filter((o) => o.type === 'Mesh' || o.type === 'Sprite').map((o) => o.visible);
    expect(visible().every(Boolean)).toBe(true);

    env.setUnderwater(true);
    env.update(0, 0, 1);
    expect(scene.fog).not.toBe(surfaceFog);
    expect(scene.fog!.color.getHexString()).toBe('0b3b66');
    expect(scene.background).not.toBe(surfaceBg);
    expect(visible().some(Boolean)).toBe(false);
    expect(camera.children.every((f) => !f.visible)).toBe(true);

    env.setUnderwater(false);
    expect(scene.fog).toBe(surfaceFog);
    expect(scene.background).toBe(surfaceBg);
    expect(visible().every(Boolean)).toBe(true);

    env.setUnderwater(true);
    env.dispose();
    expect(scene.fog).toBeNull();
  });
});

describe('Environment water', () => {
  it('fades the sea floor into the fog colour where the water is opaque (pinholes in the far water read as haze)', () => {
    const m = createSeaFloorMaterial();
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: 'void main(){\n#include <fog_fragment>\n}' };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain(`smoothstep(${FLOOR_FOG_FADE[0].toFixed(1)}, ${FLOOR_FOG_FADE[1].toFixed(1)}, vFogDepth)`);
    expect(shader.fragmentShader.indexOf('fogColor, smoothstep')).toBeLessThan(shader.fragmentShader.indexOf('#include <fog_fragment>'));
    expect(FLOOR_FOG_FADE[0]).toBeGreaterThanOrEqual(35);
    m.dispose();
  });

  it('draws no water surface of its own (the wave mesh is the one ocean) and an opaque sea floor under it', () => {
    const scene = new Scene();
    const env = new Environment(scene, new PerspectiveCamera(60, 1, 0.1, 650));
    const meshes: Mesh[] = [];
    env.frameStuff.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    // The gulls are the one transparent thing (drawn after the water, so a gull behind the wave is hidden by it).
    expect(meshes.filter((m) => (m.material as Material).transparent && m.name !== 'gulls')).toEqual([]);
    const floor = meshes.find((m) => m.name === 'seaFloor');
    expect(floor).toBeDefined();
    expect(floor!.position.y).toBeLessThan(-4);
    env.dispose();
  });
});

/**
 * The ocean's far edge is never seen: fog is at least 99 % before the camera far plane, and the
 * edges of the ocean and of the sea floor under it are beyond that in every view in play. Fog is by
 * view depth, and a point off the view axis by θ has depth = distance · cos θ, so the check uses the
 * corner of the widest frustum in play (fov 62°, aspect up to 2.4 — ultrawide desktop; a landscape
 * phone is ≈ 2.2) and the nearest edge to any camera position in play (the ridden range ± 20 m).
 */
describe('horizon: the ocean never ends in view', () => {
  const { near, far } = FOG_CONFIG;
  // three's fog factor is smoothstep(near, far, depth); solve for 0.99.
  let fog99 = near;
  for (let d = near; d <= far; d += 0.1) {
    const t = (d - near) / (far - near);
    if (t * t * (3 - 2 * t) >= 0.99) {
      fog99 = d;
      break;
    }
  }
  const tanV = Math.tan(((SURF_CONFIG.camera.fov / 2) * Math.PI) / 180);
  const cosCorner = 1 / Math.hypot(1, tanV, tanV * 2.4);
  const params = structuredClone(SURF_CONFIG.wave);
  const cams = { xMin: params.xMin - 20, xMax: params.xMax + 20, zMin: -40, zMax: 40 };
  const nearestEdge = (b: Box3) => Math.min(cams.xMin - b.min.x, b.max.x - cams.xMax, cams.zMin - b.min.z, b.max.z - cams.zMax);

  it('fog saturates before the camera far plane', () => {
    expect(fog99).toBeGreaterThan(near);
    expect(fog99).toBeLessThan(CAMERA_FAR);
  });

  // Mesh density doesn't move the ocean's outer edge, so one (desktop) mesh covers the phone too.
  it('the ocean and the sea floor extend past full fog in every direction', () => {
    const { columns, rows } = SURF_CONFIG.mesh;
    const ocean = buildWaveGeometry(new WaveShape(params), columnsX(columns, params.xMin, params.xMax), rows);
    ocean.computeBoundingBox();
    expect(nearestEdge(ocean.boundingBox!) * cosCorner).toBeGreaterThan(fog99);

    const env = new Environment(new Scene(), new PerspectiveCamera(62, 1, 0.1, CAMERA_FAR));
    const floor = env.frameStuff.getObjectByName('seaFloor') as Mesh;
    floor.updateMatrixWorld();
    const box = new Box3().setFromObject(floor);
    expect(nearestEdge(box) * cosCorner).toBeGreaterThan(fog99);
    env.dispose();
  });
});

describe('Environment beach side', () => {
  const shoreMeshes = (env: Environment) => {
    const out: Mesh[] = [];
    env.frameStuff.traverse((o) => {
      if (o instanceof Mesh && (o.name === 'shoreNear' || o.name === 'shoreFar')) out.push(o);
    });
    return out;
  };

  it('adds the shore chunks (near + far each) on one fogged, opaque material, all on the shore side', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    const meshes = shoreMeshes(env);
    expect(meshes).toHaveLength(2 * (SHORE.span / SHORE.chunk));
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    const mat = meshes[0]!.material as Material & { fog: boolean };
    expect(mat.fog).toBe(true);
    expect(mat.transparent).toBe(false);
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox!.min.z).toBeGreaterThan(0);
    }
    env.dispose();
  });

  it('scrolls the shore with the frame travel, wrapping inside the shore window', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    const near = shoreMeshes(env).filter((m) => m.name === 'shoreNear');
    env.update(0, 0, 1);
    const x0 = near.map((m) => m.position.x);
    env.update(0, 5, 1);
    near.forEach((m, i) => {
      // Moved back by the travel, or wrapped round to the other end of the window.
      const moved = x0[i]! - 5;
      expect(m.position.x).toBeCloseTo(moved < SHORE.start ? moved + SHORE.span : moved, 6);
      expect(m.position.x).toBeGreaterThanOrEqual(SHORE.start);
      expect(m.position.x).toBeLessThan(SHORE.start + SHORE.span);
    });
    env.dispose();
  });

  it('builds a lighter shore for phones', () => {
    const count = (lite: boolean) => {
      const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650), { lite });
      const n = shoreMeshes(env).reduce((a, m) => a + m.geometry.getAttribute('position').count, 0);
      env.dispose();
      return n;
    };
    expect(count(true)).toBeLessThan(0.6 * count(false));
  });

  it('places Crystal Pier where the physics has it: the same frame x for the same travel, every set', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    expect(env.piers).toHaveLength(PIER_TRACK.sets.length);
    for (const travel of [0, 12.5, 290, 300, 333.3, 1599, 4000]) {
      env.update(0, travel, 1);
      env.piers.forEach((p, k) => expect(p.position.x).toBe(pierFrameX(k, travel)));
      // The one the rider meets is one of them.
      expect(env.piers.map((p) => p.position.x)).toContain(nearestPier(travel, 10).x);
      // … and the pier's strip landmark (its Oceanic and pier house) scrolls along with it.
      const chunkX = (U: number) => {
        const k = Math.floor(U / SHORE.chunk);
        const centre = k * SHORE.chunk + SHORE.chunk / 2;
        return scrollWrapOf(centre, travel) + (U - centre);
      };
      PIER_TRACK.sets.forEach((U, k) => {
        if (Math.abs(env.piers[k]!.position.x) < 600) expect(env.piers[k]!.position.x).toBeCloseTo(chunkX(U), 6);
      });
    }
    env.dispose();
  });

  it('runs the pier out past the break on bents in pairs, the lanes on the face clear and the deck above the lip', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650), { lite: false });
    for (const p of env.piers) {
      const geo = p.geometry;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      expect(bb.min.z).toBeLessThan(PIER.endZ + 0.1);
      expect(bb.max.z).toBeGreaterThan(SHORE.z + 20);
      expect(bb.max.y).toBeGreaterThan(PIER.deckY + 1); // the railing
      expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(0.01); // centred on its frame x
      // Below the caps, nothing stands in a lane (face: z ∈ 0.3 … 2.9, trough: 4.3 … 6.9).
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        // Each triangle: if all three corners are below the caps within a lane band, it's in the lane.
        const zs = [pos.getZ(i), pos.getZ(i + 1), pos.getZ(i + 2)];
        const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
        if (Math.max(...ys) >= PIER.capY - 0.1) continue;
        const inLane = (z: number) => (z > 0.3 && z < 2.9) || (z > 4.3 && z < 6.9);
        expect(zs.every(inLane)).toBe(false);
      }
      // The pilings stand at the rows.
      const rows = pierRows(bb.max.z);
      expect(rows.length).toBeGreaterThan(20);
    }
    const tris = (lite: boolean) => {
      const e = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650), { lite });
      const n = e.piers[0]!.geometry.getAttribute('position').count / 3;
      e.dispose();
      return n;
    };
    expect(tris(false)).toBeLessThan(9000);
    expect(tris(true)).toBeLessThan(0.8 * tris(false));
    env.dispose();
  });

  it('draws the pier on its own material that dissolves near the camera (never seen from inside a piling)', () => {
    const env = new Environment(new Scene(), new PerspectiveCamera(60, 1, 0.1, 650));
    const mat = env.piers[0]!.material as Material;
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n#include <project_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n#include <fog_fragment>\n}',
    };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vPierWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(shader.fragmentShader).toContain('distance(vPierWorld, cameraPosition)');
    expect(shader.fragmentShader).toContain('discard');
    const shore = env.frameStuff.children.find((o) => o.name === 'shoreNear') as Mesh;
    expect(mat.customProgramCacheKey()).not.toBe((shore.material as Material).customProgramCacheKey());
    // Built outside the strip it keeps the strip's look: the scenery glow (SHORE_GLOW), unmarked as a
    // landmark (no extra glow / haze clearing — as when it was in the chunk; only the towers are marked).
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    const mark = env.piers[0]!.geometry.getAttribute('aLandmark');
    expect(mark.count).toBe(env.piers[0]!.geometry.getAttribute('position').count);
    for (let i = 0; i < mark.count; i++) expect(mark.getX(i)).toBe(0);
    env.dispose();
  });
});

function scrollWrapOf(worldX: number, travel: number): number {
  const rel = (((worldX - travel - SHORE.start) % SHORE.span) + SHORE.span) % SHORE.span;
  return SHORE.start + rel;
}
