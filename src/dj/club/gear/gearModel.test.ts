import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { arrangeModel, loadGear, loadModelsManifest, stripBranding } from './gearModel';
import { CDJ_SIZE, TABLE_Y, UNIT_X } from './layout';

const loadAsync = vi.hoisted(() => vi.fn());
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

const canvas = () => ({ width: 4, height: 4 }) as unknown as HTMLCanvasElement;
const canvases = [
  { screen: canvas(), jog: canvas() },
  { screen: canvas(), jog: canvas() },
];

describe('gear model', () => {
  it('strips textures and keeps base colours', () => {
    const map = new THREE.Texture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#ff0000', map }));
    stripBranding(mesh);
    const m = mesh.material as unknown as THREE.MeshLambertMaterial;
    expect(m).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe('ff0000');
  });

  it('arranges named CDJ + mixer nodes as CDJ | DJM | CDJ on the table', () => {
    const scene = new THREE.Group();
    const cdj = new THREE.Mesh(new THREE.BoxGeometry(3.29, 1.2, 4.53));
    cdj.name = 'CDJ-3000';
    const djm = new THREE.Mesh(new THREE.BoxGeometry(3.33, 1.08, 4.08));
    djm.name = 'DJM_900';
    djm.position.x = 5;
    scene.add(cdj, djm);
    const { group, topY } = arrangeModel(scene);
    expect(group.children).toHaveLength(3);
    const box = new THREE.Box3().setFromObject(group.children[0]!);
    expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(CDJ_SIZE.w, 6);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(UNIT_X.cdj0, 6);
    expect(box.min.y).toBeCloseTo(TABLE_Y, 6);
    expect(topY.cdj).toBeCloseTo(TABLE_Y + 0.12, 6);
  });

  it('reads the models manifest and tolerates its absence', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ booth: '/models/booth.glb' })));
    expect(await loadModelsManifest(ok as unknown as typeof fetch)).toEqual({ booth: '/models/booth.glb' });
    const missing = vi.fn(async () => new Response('', { status: 404 }));
    expect(await loadModelsManifest(missing as unknown as typeof fetch)).toEqual({ booth: null });
  });

  it('bakes ancestor transforms (Z-up wrapper, x100 scale) so split units stand upright', () => {
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    root.scale.setScalar(100);
    // Z-up model: width along x, depth along y, height along z.
    const cdj = new THREE.Mesh(new THREE.BoxGeometry(0.0329, 0.0453, 0.012));
    cdj.name = 'CDJ-3000';
    const djm = new THREE.Mesh(new THREE.BoxGeometry(0.0333, 0.0408, 0.0108));
    djm.name = 'DJM_900';
    djm.position.x = 0.05;
    root.add(cdj, djm);
    const { group, topY } = arrangeModel(root);
    const size = new THREE.Box3().setFromObject(group.children[0]!).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(CDJ_SIZE.w, 5);
    expect(size.y).toBeCloseTo(CDJ_SIZE.h, 5);
    expect(size.z).toBeCloseTo(CDJ_SIZE.d, 5);
    expect(topY.cdj).toBeCloseTo(TABLE_Y + CDJ_SIZE.h, 5);
  });

  it('loadGear: no model -> procedural fallback without touching the GLB loader', async () => {
    loadAsync.mockClear();
    const g = await loadGear(canvases, { booth: null });
    expect(g.group.getObjectByName('djm')).toBeTruthy();
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('loadGear: a failing GLB load falls back and warns once', async () => {
    loadAsync.mockReset();
    loadAsync.mockRejectedValue(new Error('404'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = await loadGear(canvases, { booth: '/models/booth.glb' });
    expect(g.group.getObjectByName('cdj-0')).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
