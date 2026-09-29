import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SURFER_LOOK } from '../config';
import { buildProceduralRig, rigFromGltfScene, type SurferRig } from './rig';

/** Test-only: both rigs, so every pose/rig test proves the code is frame-agnostic. */
export async function loadGlbRig(): Promise<SurferRig> {
  const buf = readFileSync('public/surf/surfer.glb');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(ab, '');
  return rigFromGltfScene(gltf.scene, SURFER_LOOK);
}

export const TEST_RIGS: Array<[string, () => Promise<SurferRig>]> = [
  ['procedural', async () => buildProceduralRig(SURFER_LOOK)],
  ['glTF (Quaternius)', loadGlbRig],
];

export function boneWorld(rig: SurferRig, bone: string): Vector3 {
  rig.model.updateMatrixWorld(true);
  return rig.mesh.skeleton.getBoneByName(bone)!.getWorldPosition(new Vector3());
}
