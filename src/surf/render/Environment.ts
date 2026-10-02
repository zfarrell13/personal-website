import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
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
import { smoothstep } from '../math/scalar';
import { pierFrameX, PIER_TRACK } from '../pier/track';
import { REEF_TILES, scrollWrap } from './scroll';
import { buildSandbedGeometry, CAUSTIC_REPEAT, createSandMaterial, makeRippleTexture, SHALLOWS, type SandUniforms } from './shallows';
import { buildPier, buildShore, createShoreMaterial, SHORE } from './shore';
import { createSkyMaterial, seaReflection } from './sky';
import { makeRadialTexture } from './textures';
import { OCEAN_EXTENT } from './waveGeometry';

export const FOG_COLOR = new Color(FOG_CONFIG.color);
/** Wipeout cut: thick blue fog, no sky or sun. */
export const UNDERWATER_COLOR = new Color('#0b3b66');
const SUN_DIR = new Vector3(-0.62, 0.13, -0.77).normalize();
/** Sky dome radius (m): inside the camera far plane (CAMERA_FAR). */
export const SKY_RADIUS = 600;
/** Opaque sea floor under the translucent water, below the reef (reef tops at ≈ −2.4 m). */
const SEA_FLOOR_Y = -4.3;
const SEA_FLOOR_COLOR = new Color('#1b808a');
/**
 * View depth (m) over which the sea floor and the reef fade into the fog colour. The water is opaque
 * from ≈ 35 m (waveMaterial), so nothing under it is seen that far out — except through pinholes the
 * rasterizer can leave along the far water's long, clipped triangles, which then read as haze
 * instead of dark specks on the horizon.
 */
export const FLOOR_FOG_FADE = [40, 120] as const;

/**
 * Fades a (fogged) material under the water into the fog colour past FLOOR_FOG_FADE. Chains after a
 * shader hook the material already has (e.g. the sand's), keeping its program cache key apart.
 */
export function fadeUnderwaterIntoFog<M extends Material>(m: M): M {
  const prev = m.onBeforeCompile;
  // As retroMaterial: three's default key is onBeforeCompile.toString(), so capture the original hook's
  // (an earlier hook with the default key must not share a program with the plain floor).
  const prevKey = `${m.customProgramCacheKey === Material.prototype.customProgramCacheKey ? prev.toString() : m.customProgramCacheKey()}|`;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(${FLOOR_FOG_FADE[0].toFixed(1)}, ${FLOOR_FOG_FADE[1].toFixed(1)}, vFogDepth));
#endif
#include <fog_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `${prevKey}under-water-fog-fade`;
  return m;
}

/** The opaque sea floor's material: lit, fogged, and faded into the fog colour far out. */
export function createSeaFloorMaterial(): MeshLambertMaterial {
  return fadeUnderwaterIntoFog(new MeshLambertMaterial({ color: SEA_FLOOR_COLOR }));
}

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

export interface EnvironmentOptions {
  /** Phones: a lighter beach side (fewer house rows, simpler pilings). Default: a coarse pointer. */
  lite?: boolean;
}

const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

interface Scroller {
  obj: { position: Vector3 };
  worldX: number;
  span: number;
  start: number;
}

/**
 * Sky dome, low sun + lens flare, reef floor, islands with palms out to sea, the beach side
 * (Wrightsville Beach and Crystal Pier, see shore.ts), gulls and fog. Reef/islands/shore/gulls live in the (mirrored) frame group
 * and scroll past with the floating origin.
 */
export class Environment {
  readonly frameStuff = new Group();
  private readonly scene: Scene;
  private readonly fog: Fog;
  private readonly underwaterFog = new Fog(UNDERWATER_COLOR, 0.5, 18);
  private readonly background: Color;
  private underwater = false;
  private readonly hemi: HemisphereLight;
  private readonly sky: Mesh;
  private readonly skyMat: ShaderMaterial;
  private readonly sun: Sprite;
  private readonly sunLight: DirectionalLight;
  private readonly flares: Sprite[] = [];
  private readonly gulls: InstancedMesh;
  /** The sand bed under the clear shallows in front of the wave (its ripple map scrolls with the travel). */
  private readonly sandbed: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly sandUniforms: SandUniforms;
  private readonly scrollers: Scroller[] = [];
  /** Crystal Pier of each landmark set, placed at pierFrameX (the physics' pier: pier/track.ts). */
  readonly piers: Mesh[] = [];
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
    opts: EnvironmentOptions = {},
  ) {
    this.scene = scene;
    this.fog = new Fog(FOG_COLOR, FOG_CONFIG.near, FOG_CONFIG.far);
    scene.fog = this.fog;
    this.background = FOG_COLOR.clone();
    scene.background = this.background;

    // Sky dome — follows the camera; per-pixel gradient whose horizon haze is the fog colour.
    this.skyMat = createSkyMaterial();
    this.sky = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Lights (sun direction shared with the sprite; mirrored per side in update()).
    this.hemi = new HemisphereLight('#cfe8ff', '#1b4b5a', 1.1);
    scene.add(this.hemi);
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

    // The water surface is all the wave mesh (one ocean). Under it: an opaque sea floor as big as the
    // ocean, so the translucent water always has something below it (the reef shows through near shore).
    const floor = new Mesh(new PlaneGeometry(2 * OCEAN_EXTENT, 2 * OCEAN_EXTENT, 1, 1).rotateX(-Math.PI / 2), createSeaFloorMaterial());
    floor.name = 'seaFloor';
    floor.position.y = SEA_FLOOR_Y - 0.05;
    this.frameStuff.add(floor);

    // The sandbar the wave breaks on: rippled sand seen through the clear shallows in front of the
    // wave (shallows.ts), sinking into the sea floor seaward and toward the reef.
    const ripples = makeRippleTexture();
    const sand = createSandMaterial(ripples);
    this.sandUniforms = sand.uniforms;
    this.sandbed = new Mesh(buildSandbedGeometry(SEA_FLOOR_COLOR), retroMaterial(fadeUnderwaterIntoFog(sand.material)));
    this.sandbed.name = 'sandbed';
    this.frameStuff.add(this.sandbed);
    this.disposables.push(ripples);

    // Reef floor: two seamless tiles (periodic noise over the tile span).
    const TILE = REEF_TILES.tile;
    // Its seaward and shoreward edges sink and fade into the sea floor (no hard edge under the water).
    // Near the break the bottom is the sandbar (shallows.ts): the reef rises out of the sea floor only
    // beyond the clearest shallows, over world z ≈ 35–55 (the tile sits at z = 70).
    const reefEdge = (z: number) => smoothstep(70, 45, Math.abs(z)) * smoothstep(-35, -15, z);
    const reefGeo = paint(new PlaneGeometry(TILE, 140, 40, 24).rotateX(-Math.PI / 2), (x, _y, z, c) => {
      const n = 0.5 + 0.25 * Math.sin((x / TILE) * Math.PI * 2 * 3 + z * 0.1) + 0.25 * Math.sin((x / TILE) * Math.PI * 2 * 7 + z * 0.23);
      // Coral / pale sand / weed in cool tones: through the teal water sand reads as clear turquoise and
      // the rest as a hint of reef — no warm colour to smear brown or mauve.
      c.set(n > 0.62 ? '#5f8f80' : n > 0.4 ? '#a8dccf' : '#2f6c64')
        .lerp(SEA_FLOOR_COLOR, 0.3)
        .lerp(SEA_FLOOR_COLOR, 1 - reefEdge(z));
    });
    const reefPos = reefGeo.getAttribute('position');
    for (let i = 0; i < reefPos.count; i++) {
      const x = reefPos.getX(i);
      const z = reefPos.getZ(i);
      const y = -3.2 + 0.8 * Math.sin((x / TILE) * Math.PI * 2 * 5) * Math.cos(z * 0.15);
      reefPos.setY(i, SEA_FLOOR_Y + (y - SEA_FLOOR_Y) * reefEdge(z));
    }
    reefGeo.computeVertexNormals();
    const reefMat = retroMaterial(fadeUnderwaterIntoFog(new MeshLambertMaterial({ vertexColors: true })));
    for (let k = 0; k < REEF_TILES.count; k++) {
      const reef = new Mesh(reefGeo, reefMat);
      reef.position.z = 70;
      this.frameStuff.add(reef);
      this.scrollers.push({ obj: reef, worldX: k * TILE + TILE / 2, span: REEF_TILES.count * TILE, start: REEF_TILES.start });
    }

    // Islands with palms, merged into one mesh (one draw call).
    const parts: BufferGeometry[] = [];
    const islands: Array<[number, number, number, number]> = [
      // Close enough (≈ 250–400 m) to read as hazy silhouettes through the fog.
      [-260, -340, 110, 38],
      [60, -400, 150, 52],
      [340, -360, 80, 26],
    ];
    islands.forEach(([x, z, r, h], k) => {
      const cone = new ConeGeometry(r, h, 9, 2).translate(x, h / 2 - 2, z);
      const pos = cone.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        // Jitter keyed by position, not vertex index: the cone's duplicated seam vertices move together (no crack).
        const [px, py, pz] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const key = Math.round(px * 10) * 31 + Math.round(pz * 10) + Math.round(py * 10) * 7;
        if (py > 0 && py < h - 3) pos.setXYZ(i, px + (hash(key, k) - 0.5) * r * 0.25, py * (0.7 + hash(k, key) * 0.4), pz);
      }
      parts.push(paint(cone, (_x, y, _z, c) => c.set(y < 3 ? '#e6d3a0' : y < h * 0.6 ? '#2f7a3a' : '#4d5b3a')));
      for (let p = 0; p < 3; p++) {
        const px = x + (p - 1) * r * 0.3;
        // Stand the palm on the cone surface (radius shrinks linearly to the apex at y = h − 2).
        const dist = Math.min(r, Math.hypot(px - x, r * 0.3));
        const py = -2 + h * (1 - dist / r);
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

    // The beach side: Wrightsville Beach around Crystal Pier (shore.ts), in scrolling chunks — one
    // near and one far mesh each (one material), so chunks behind the camera are culled.
    const lite = opts.lite ?? isCoarsePointer();
    const shore = buildShore({ lite });
    const shoreMat = retroMaterial(createShoreMaterial());
    this.disposables.push(shoreMat);
    for (const c of shore.chunks) {
      for (const [geo, name] of [[c.near, 'shoreNear'], [c.far, 'shoreFar']] as const) {
        const mesh = new Mesh(geo, shoreMat);
        mesh.name = name;
        this.frameStuff.add(mesh);
        this.disposables.push(geo);
        this.scrollers.push({ obj: mesh, worldX: c.worldX, span: SHORE.span, start: SHORE.start });
      }
    }

    // Crystal Pier, out past the break: one mesh per landmark set, faded near the camera.
    const pierMat = retroMaterial(createShoreMaterial({ cameraFade: true }));
    this.disposables.push(pierMat);
    PIER_TRACK.sets.forEach((_, k) => {
      const geo = buildPier(k, { lite });
      const mesh = new Mesh(geo, pierMat);
      mesh.name = 'pier';
      this.frameStuff.add(mesh);
      this.disposables.push(geo);
      this.piers.push(mesh);
    });

    // Gulls: 5 instanced "V"s circling over the pocket.
    const gullGeo = new BufferGeometry();
    gullGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, -0.6, 0.15, -0.1, 0, 0.05, 0.25, 0, 0, 0, 0.6, 0.15, -0.1, 0, 0.05, 0.25]), 3));
    gullGeo.computeVertexNormals();
    this.gulls = new InstancedMesh(gullGeo, new MeshBasicMaterial({ color: '#f2f2f2', side: DoubleSide, transparent: true }), 5);
    this.gulls.frustumCulled = false;
    // Drawn after the (translucent) water, so the water's depth hides a gull behind the wave instead of
    // it showing through the lip as a dark speck.
    this.gulls.renderOrder = 3;
    this.gulls.name = 'gulls';
    this.frameStuff.add(this.gulls);

    for (const obj of [this.sky, floor, this.sandbed, islandMesh, this.gulls]) {
      const mesh = obj as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      if (mesh.geometry) this.disposables.push(mesh.geometry);
      if (mesh.material) this.disposables.push(mesh.material);
    }
    this.disposables.push(reefGeo, reefMat, this.sun.material, ...this.flares.map((f) => f.material));
  }

  /** The wipeout cut: underwater fog and background, sky dome, sun and flare hidden. */
  setUnderwater(on: boolean): void {
    this.underwater = on;
    this.sky.visible = !on;
    this.sun.visible = !on;
    this.scene.fog = on ? this.underwaterFog : this.fog;
    this.scene.background = on ? UNDERWATER_COLOR : this.background;
    // From below, grazing water would mirror the (hidden) sky as a bright rim.
    seaReflection.uReflect.value = on ? 0 : 1;
    if (on) for (const f of this.flares) f.visible = false;
  }

  /**
   * `time` — free-running ambient clock (drives gulls; keeps animating on the
   * title screen). `travel` — frame distance along the reef (Vp · sim time);
   * drives scenery scroll only. `sideSign` mirrors the sun and its light
   * (+1 = right, −1 = left). `waterTime` — the water clock (stops on pause): the sand's caustics.
   */
  update(time: number, travel: number, sideSign: number, waterTime = time): void {
    for (const s of this.scrollers) s.obj.position.x = scrollWrap(s.worldX, travel, s.span, s.start);
    this.piers.forEach((p, k) => (p.position.x = pierFrameX(k, travel)));
    // The sand is fixed to the reef: its ripples move past at the travel (uv.x = frame x / tile).
    const tile = SHALLOWS.rippleTile;
    this.sandbed.material.map!.offset.x = (((travel / tile) % 1) + 1) % 1;
    this.sandUniforms.uTravel.value = travel % CAUSTIC_REPEAT;
    // The caustics' rates are multiples of 0.1 rad/s: wrapping the clock every 20π s is seamless, and
    // keeps the shader's sin() arguments small. They run on the water clock (still on pause).
    this.sandUniforms.uTime.value = waterTime % (20 * Math.PI);

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
    (this.skyMat.uniforms.uSunDir!.value as Vector3).set(SUN_DIR.x * sideSign, SUN_DIR.y, SUN_DIR.z);
    // Keep the lit side consistent with the visible sun.
    this.sunLight.position.set(SUN_DIR.x * sideSign, SUN_DIR.y, SUN_DIR.z).multiplyScalar(100);

    // Lens flare along the line from the sun through the screen centre.
    this.ndc.copy(this.sunWorld).project(this.camera);
    const visible = !this.underwater && this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.3 && Math.abs(this.ndc.y) < 1.3;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const halfW = halfH * this.camera.aspect;
    this.flares.forEach((f, i) => {
      f.visible = visible;
      const k = 1 - (i + 1) * 0.55;
      f.position.set(this.ndc.x * k * halfW, this.ndc.y * k * halfH, -1);
    });
  }

  dispose(): void {
    seaReflection.uReflect.value = 1;
    for (const f of this.flares) this.camera.remove(f);
    this.scene.remove(this.sky, this.sunLight, this.hemi, this.sun, this.camera);
    if (this.scene.fog === this.fog || this.scene.fog === this.underwaterFog) this.scene.fog = null;
    if (this.scene.background === this.background || this.scene.background === UNDERWATER_COLOR) this.scene.background = null;
    this.disposables.forEach((d) => d.dispose());
  }
}
