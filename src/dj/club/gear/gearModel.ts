import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { retroMaterial } from '@/retro/retroMaterial';
import { buildOverlays, buildProceduralGear, disposeGear, type DeckCanvases, type GearParts } from './proceduralGear';
import { CDJ_SIZE, DJM_SIZE, TABLE_Y, UNIT_X } from './layout';

export interface ModelsManifest {
  /** Public URL of the booth model, or null when content/models/booth.glb is absent. */
  booth: string | null;
}

/** Rotation applied to the downloaded model so its screens face the crowd (−z). Tune after a visual check. */
export const MODEL_ROTATION_Y = 0;
const UP = new THREE.Vector3(0, 1, 0);
const YAW = new THREE.Quaternion();
const CDJ_NAME = /cdj/i;
const DJM_NAME = /djm|mixer|900/i;

export async function loadModelsManifest(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<ModelsManifest> {
  try {
    const res = await fetchFn('/models/models.json');
    if (!res.ok) return { booth: null };
    const json = (await res.json()) as Partial<ModelsManifest>;
    return { booth: typeof json.booth === 'string' ? json.booth : null };
  } catch {
    return { booth: null };
  }
}

/**
 * Removes every texture (logos live in textures) and replaces materials with flat
 * retro Lambert materials keeping only the base colour.
 */
export function stripBranding(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m: THREE.Material) => {
      const color = 'color' in m && m.color instanceof THREE.Color ? m.color.clone() : new THREE.Color('#1b1d23');
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
      return retroMaterial(new THREE.MeshLambertMaterial({ color, flatShading: true }));
    });
    o.material = Array.isArray(o.material) ? next : next[0]!;
  });
}

/** Uniformly scales `obj` so its width is `width`, centres it at x = `cx`, z = 0, and stands it on the table. Returns the top y. */
export function fitToFootprint(obj: THREE.Object3D, width: number, cx: number): number {
  obj.quaternion.premultiply(YAW.setFromAxisAngle(UP, MODEL_ROTATION_Y));
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(width / Math.max(1e-6, size.x));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.x += cx - centre.x;
  obj.position.z += -centre.z;
  obj.position.y += TABLE_Y - box.min.y;
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj).max.y;
}

/**
 * Arranges the model as CDJ | DJM | CDJ. If the file has separately named CDJ and mixer
 * nodes, the CDJ is cloned for both decks; otherwise the whole scene is fitted to the booth width.
 */
export function arrangeModel(scene: THREE.Object3D): { group: THREE.Group; topY: { cdj: number; djm: number } } {
  const group = new THREE.Group();
  group.name = 'gear-model';
  let cdj: THREE.Object3D | undefined;
  let djm: THREE.Object3D | undefined;
  scene.traverse((o) => {
    if (!cdj && CDJ_NAME.test(o.name)) cdj = o;
    if (!djm && DJM_NAME.test(o.name) && !CDJ_NAME.test(o.name)) djm = o;
  });
  if (cdj && djm) {
    scene.updateMatrixWorld(true);
    // Clones detach from their parents, so bake each node's world rotation/scale (e.g. a
    // Z-up → Y-up wrapper node) into the clone; only the translation is dropped.
    const bake = (src: THREE.Object3D): THREE.Object3D => {
      const o = src.clone();
      src.matrixWorld.decompose(o.position, o.quaternion, o.scale);
      o.position.set(0, 0, 0);
      group.add(o);
      return o;
    };
    const left = bake(cdj);
    const right = bake(cdj);
    const mixer = bake(djm);
    const cdjTop = Math.max(fitToFootprint(left, CDJ_SIZE.w, UNIT_X.cdj0), fitToFootprint(right, CDJ_SIZE.w, UNIT_X.cdj1));
    const djmTop = fitToFootprint(mixer, DJM_SIZE.w, UNIT_X.djm);
    return { group, topY: { cdj: cdjTop, djm: djmTop } };
  }
  group.add(scene);
  const top = fitToFootprint(scene, UNIT_X.cdj1 - UNIT_X.cdj0 + CDJ_SIZE.w, 0);
  return { group, topY: { cdj: top, djm: top } };
}

/** Loads the CC-BY booth model if present (textures stripped), else the procedural gear. Never throws. */
export async function loadGear(canvases: readonly DeckCanvases[], manifest: ModelsManifest): Promise<GearParts> {
  if (!manifest.booth) return buildProceduralGear(canvases);
  try {
    const gltf = await new GLTFLoader().loadAsync(manifest.booth);
    stripBranding(gltf.scene);
    const { group, topY } = arrangeModel(gltf.scene);
    const overlays = buildOverlays(canvases, topY);
    group.add(overlays.group);
    return {
      group,
      bindings: overlays.bindings,
      textures: overlays.textures,
      dispose: () => {
        disposeGear(group, []);
        overlays.dispose();
      },
    };
  } catch (err) {
    console.warn('Booth model failed to load; using procedural gear.', err);
    return buildProceduralGear(canvases);
  }
}
