import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retroMaterial } from '@/retro/retroMaterial';
import { FOG_CONFIG } from '../config';
import { scrollWrap } from './scroll';
import { makeRadialTexture } from './textures';

export const FOG_COLOR = new Color(FOG_CONFIG.color);
const SUN_DIR = new Vector3(-0.62, 0.13, -0.77).normalize();

function paint(geo: BufferGeometry, fn: (x: number, y: number, z: number, out: Color) => void): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Deterministic hash noise in [0, 1). */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

interface Scroller {
  obj: { position: Vector3 };
  worldX: number;
  span: number;
  start: number;
}

/**
 * Sky dome, low sun + lens flare, reef floor, islands with palms, a pier,
 * gulls and fog. Reef/islands/pier/gulls live in the (mirrored) frame group
 * and scroll past with the floating origin.
 */
export class Environment {
  readonly frameStuff = new Group();
  private readonly sky: Mesh;
  private readonly sun: Sprite;
  private readonly sunLight: DirectionalLight;
  private readonly flares: Sprite[] = [];
  private readonly gulls: InstancedMesh;
  private readonly scrollers: Scroller[] = [];
  private readonly sunWorld = new Vector3();
  private readonly ndc = new Vector3();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    scene.fog = new Fog(FOG_COLOR, FOG_CONFIG.near, FOG_CONFIG.far);
    scene.background = FOG_COLOR.clone();

    // Sky dome — follows the camera, gradient by height.
    const skyGeo = paint(new SphereGeometry(600, 16, 10), (_x, y, _z, c) => {
      const h = Math.max(0, y / 600);
      c.set('#ffd9a8').lerp(new Color('#7fb8ff'), Math.min(1, h * 3)).lerp(new Color('#2f6fe0'), Math.max(0, h * 1.4 - 0.3));
    });
    this.sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Lights (sun direction shared with the sprite; mirrored per side in update()).
    scene.add(new HemisphereLight('#cfe8ff', '#1b4b5a', 1.1));
    this.sunLight = new DirectionalLight('#ffe0b0', 1.7);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(100);
    scene.add(this.sunLight);

    // Sun + flare sprites (children of the camera so they sit in screen space).
    const glow = makeRadialTexture(64, [255, 240, 200], 1.6);
    this.disposables.push(glow);
    this.sun = new Sprite(new SpriteMaterial({ map: glow, color: '#fff3c4', fog: false, depthWrite: false }));
    this.sun.scale.setScalar(90);
    scene.add(this.sun);
    const flareColors = ['#ffd27a', '#8fd3ff', '#ffb3e6', '#c6ff9e'];
    flareColors.forEach((color, i) => {
      const sp = new Sprite(new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0.35, fog: false }));
      sp.scale.setScalar(0.05 + i * 0.03);
      sp.renderOrder = 10;
      camera.add(sp);
      this.flares.push(sp);
    });
    scene.add(camera);

    // Far sea (under/around the wave; the wave mesh covers the near field).
    // Opacity 0.45 (ruling) so the reef shows through; the wave skirt is 0.72.
    const sea = new Mesh(
      new PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2),
      retroMaterial(new MeshLambertMaterial({ color: '#0e5a66', transparent: true, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), { snap: false }),
    );
    sea.position.y = -0.08;
    this.frameStuff.add(sea);

    // Reef floor: two seamless tiles (periodic noise over the tile span).
    const TILE = 200;
    const reefGeo = paint(new PlaneGeometry(TILE, 140, 40, 24).rotateX(-Math.PI / 2), (x, _y, z, c) => {
      const n = 0.5 + 0.25 * Math.sin((x / TILE) * Math.PI * 2 * 3 + z * 0.1) + 0.25 * Math.sin((x / TILE) * Math.PI * 2 * 7 + z * 0.23);
      c.set(n > 0.62 ? '#b86a5c' : n > 0.4 ? '#d9c28f' : '#3c6e63');
    });
    const reefPos = reefGeo.getAttribute('position');
    for (let i = 0; i < reefPos.count; i++) {
      const x = reefPos.getX(i);
      const z = reefPos.getZ(i);
      reefPos.setY(i, -3.2 + 0.8 * Math.sin((x / TILE) * Math.PI * 2 * 5) * Math.cos(z * 0.15));
    }
    reefGeo.computeVertexNormals();
    const reefMat = retroMaterial(new MeshLambertMaterial({ vertexColors: true }));
    for (let k = 0; k < 2; k++) {
      const reef = new Mesh(reefGeo, reefMat);
      reef.position.z = 70;
      this.frameStuff.add(reef);
      this.scrollers.push({ obj: reef, worldX: k * TILE + TILE / 2, span: 2 * TILE, start: -100 });
    }

    // Islands with palms, merged into one mesh (one draw call).
    const parts: BufferGeometry[] = [];
    const islands: Array<[number, number, number, number]> = [
      [-260, -430, 110, 38],
      [60, -520, 150, 52],
      [340, -460, 80, 26],
    ];
    islands.forEach(([x, z, r, h], k) => {
      const cone = new ConeGeometry(r, h, 9, 2).translate(x, h / 2 - 2, z);
      const pos = cone.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0 && pos.getY(i) < h - 3) pos.setXYZ(i, pos.getX(i) + (hash(i, k) - 0.5) * r * 0.25, pos.getY(i) * (0.7 + hash(k, i) * 0.4), pos.getZ(i));
      }
      parts.push(paint(cone, (_x, y, _z, c) => c.set(y < 3 ? '#e6d3a0' : y < h * 0.6 ? '#2f7a3a' : '#4d5b3a')));
      for (let p = 0; p < 3; p++) {
        const px = x + (p - 1) * r * 0.3;
        const py = h * 0.35;
        const trunk = paint(new CylinderGeometry(0.8, 1.2, 16, 5).translate(px, py + 8, z + r * 0.3), (_a, _b, _c, c) => c.set('#8a6a3c'));
        parts.push(trunk);
        for (let f = 0; f < 5; f++) {
          const frond = new ConeGeometry(2, 11, 3).rotateZ(Math.PI / 2.4).rotateY((f / 5) * Math.PI * 2).translate(px, py + 16, z + r * 0.3);
          parts.push(paint(frond, (_a, _b, _c, c) => c.set('#2e8b3e')));
        }
      }
    });
    const islandGeo = mergeGeometries(parts);
    const islandMesh = new Mesh(islandGeo, retroMaterial(new MeshLambertMaterial({ vertexColors: true })));
    this.frameStuff.add(islandMesh);
    this.scrollers.push({ obj: islandMesh, worldX: 0, span: 1600, start: -800 });

    // Pier: deck + pilings, toward shore.
    const pierParts: BufferGeometry[] = [paint(new BoxGeometry(4, 0.4, 70).translate(0, 3, 0), (_a, _b, _c, c) => c.set('#9b7b55'))];
    for (let i = 0; i < 12; i++) {
      pierParts.push(paint(new CylinderGeometry(0.25, 0.25, 8, 5).translate(i % 2 ? 1.6 : -1.6, -1, -34 + Math.floor(i / 2) * 13), (_a, _b, _c, c) => c.set('#5c4630')));
    }
    const pier = new Mesh(mergeGeometries(pierParts), retroMaterial(new MeshLambertMaterial({ vertexColors: true })));
    pier.position.z = 110;
    this.frameStuff.add(pier);
    this.scrollers.push({ obj: pier, worldX: 60, span: 700, start: -250 });

    // Gulls: 5 instanced "V"s circling over the pocket.
    const gullGeo = new BufferGeometry();
    gullGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, -0.6, 0.15, -0.1, 0, 0.05, 0.25, 0, 0, 0, 0.6, 0.15, -0.1, 0, 0.05, 0.25]), 3));
    gullGeo.computeVertexNormals();
    this.gulls = new InstancedMesh(gullGeo, new MeshBasicMaterial({ color: '#f2f2f2', side: DoubleSide }), 5);
    this.gulls.frustumCulled = false;
    this.frameStuff.add(this.gulls);

    for (const obj of [this.sky, this.sun, sea, islandMesh, pier, this.gulls]) {
      const mesh = obj as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      if (mesh.geometry) this.disposables.push(mesh.geometry);
      if (mesh.material) this.disposables.push(mesh.material);
    }
    this.disposables.push(reefGeo, reefMat, ...this.flares.map((f) => f.material));
  }

  /**
   * `time` — free-running ambient clock (drives gulls; keeps animating on the
   * title screen). `travel` — frame distance along the reef (Vp · sim time);
   * drives scenery scroll only. `sideSign` mirrors the sun and its light
   * (+1 = right, −1 = left).
   */
  update(time: number, travel: number, sideSign: number): void {
    for (const s of this.scrollers) s.obj.position.x = scrollWrap(s.worldX, travel, s.span, s.start);

    for (let i = 0; i < 5; i++) {
      const a = time * (0.25 + i * 0.03) + i * 1.3;
      this.v.set(10 + Math.cos(a) * (18 + i * 4), 14 + i * 2 + Math.sin(time * 0.7 + i) * 1.5, -8 + Math.sin(a) * (10 + i * 2));
      this.q.setFromAxisAngle(this.s.set(0, 1, 0), -a);
      const flap = 0.6 + 0.4 * Math.sin(time * 9 + i * 2);
      this.m.compose(this.v, this.q, this.s.set(1.6, 1.6 * flap, 1.6));
      this.gulls.setMatrixAt(i, this.m);
    }
    this.gulls.instanceMatrix.needsUpdate = true;

    // Sky follows the camera; sun is fixed in direction (mirrored with the frame).
    this.sky.position.copy(this.camera.position);
    this.sunWorld.set(SUN_DIR.x * sideSign, SUN_DIR.y, SUN_DIR.z).multiplyScalar(500).add(this.camera.position);
    this.sun.position.copy(this.sunWorld);
    // Keep the lit side consistent with the visible sun.
    this.sunLight.position.set(SUN_DIR.x * sideSign, SUN_DIR.y, SUN_DIR.z).multiplyScalar(100);

    // Lens flare along the line from the sun through the screen centre.
    this.ndc.copy(this.sunWorld).project(this.camera);
    const visible = this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.3 && Math.abs(this.ndc.y) < 1.3;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const halfW = halfH * this.camera.aspect;
    this.flares.forEach((f, i) => {
      f.visible = visible;
      const k = 1 - (i + 1) * 0.55;
      f.position.set(this.ndc.x * k * halfW, this.ndc.y * k * halfH, -1);
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
