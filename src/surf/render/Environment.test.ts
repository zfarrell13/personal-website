import { describe, expect, it } from 'vitest';
import { Box3, Mesh, PerspectiveCamera, Scene, type Material } from 'three';
import { CAMERA_FAR } from '../camera/CameraRig';
import { FOG_CONFIG, SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { Environment } from './Environment';
import { buildWaveGeometry, columnsX } from './waveGeometry';

describe('Environment underwater cut', () => {
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
  it('draws no water surface of its own (the wave mesh is the one ocean) and an opaque sea floor under it', () => {
    const scene = new Scene();
    const env = new Environment(scene, new PerspectiveCamera(60, 1, 0.1, 650));
    const meshes: Mesh[] = [];
    env.frameStuff.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.filter((m) => (m.material as Material).transparent)).toEqual([]);
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

  it.each([
    ['desktop', SURF_CONFIG.mesh.columns, SURF_CONFIG.mesh.rows],
    ['phone', 112, 44],
  ] as const)('the ocean (%s mesh) and the sea floor extend past full fog in every direction', (_n, columns, rows) => {
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
