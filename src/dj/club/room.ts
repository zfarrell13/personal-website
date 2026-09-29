import * as THREE from 'three';
import { retroMaterial } from '@/retro/retroMaterial';

const lambert = (color: string, emissive = '#000000') =>
  retroMaterial(new THREE.MeshLambertMaterial({ color, emissive, flatShading: true }));

/**
 * Disposes every geometry and material under `root` once (clones share them).
 * Textures owned by materials are disposed too.
 */
export function disposeTree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry) return;
    geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
  });
  for (const g of geos) g.dispose();
  for (const mat of mats) {
    for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
    mat.dispose();
  }
}

/**
 * Low-poly club shell. Coordinates: the DJ stands at z ≈ +0.6 facing −z; the
 * crowd fills z ∈ [−9, −2]; the LED wall hangs behind the DJ at z = +2.2
 * (in front of the back wall, whose face is at z = +2.25). ~24 draw calls.
 */
export function buildRoom(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'room';
  // floor: checker dance floor
  const floorGeo = new THREE.PlaneGeometry(16, 14, 16, 14).toNonIndexed();
  const pos = floorGeo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  // colour per triangle from its centroid so each 1 m tile is a flat checker square
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const c = (Math.floor(cx + 8) + Math.floor(cy + 7)) % 2 ? 0.09 : 0.14;
    for (let v = t; v < t + 3; v++) colors.set([c, c, c * 1.3], v * 3);
  }
  floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const floor = new THREE.Mesh(floorGeo, retroMaterial(new THREE.MeshLambertMaterial({ vertexColors: true })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -3;
  g.add(floor);

  const walls = lambert('#0d0f1c');
  const back = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 0.3), walls);
  back.position.set(0, 3.5, 2.4);
  const front = back.clone();
  front.position.z = -10;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 12.4), walls);
  left.position.set(-8, 3.5, -3.8);
  const right = left.clone();
  right.position.x = 8;
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 12.4), walls);
  ceiling.position.set(0, 7, -3.8);
  g.add(back, front, left, right, ceiling);

  // booth riser + table (table top at y 1.0)
  const riser = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 2.2), lambert('#151826'));
  riser.position.set(0, 0.2, 0.7);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.7), lambert('#1c1f2c'));
  table.position.set(0, 0.7, 0);
  g.add(riser, table);

  // speaker stacks
  const cab = lambert('#0b0c10');
  const cone = lambert('#23262f');
  const cabGeo = new THREE.BoxGeometry(1, 0.9, 0.8);
  const wooferGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 10);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const box = new THREE.Mesh(cabGeo, cab);
      box.position.set(side * 3, 0.45 + k * 0.92, 0.2);
      const woofer = new THREE.Mesh(wooferGeo, cone);
      woofer.rotation.x = Math.PI / 2;
      woofer.position.set(side * 3, 0.45 + k * 0.92, -0.22);
      g.add(box, woofer);
    }
  }

  // truss over the booth
  const truss = lambert('#8c93a3');
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 0.25), truss);
  beam.position.set(0, 5.2, -0.5);
  const beam2 = beam.clone();
  beam2.position.z = -4.5;
  const legGeo = new THREE.BoxGeometry(0.25, 5.2, 0.25);
  for (const x of [-4, 4]) {
    const leg = new THREE.Mesh(legGeo, truss);
    leg.position.set(x, 2.6, -0.5);
    g.add(leg);
  }
  g.add(beam, beam2);
  return g;
}
