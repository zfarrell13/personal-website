import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retroMaterial } from '@/retro/retroMaterial';
import { HOT_CUE_COUNT, type DeckId } from '../../constants';
import type { DjData } from '../../store/djStore';
import type { GearBinding, LedRead } from './bindings';
import { CDJ_LAYOUT, CDJ_SIZE, cdjX, DJM_LAYOUT, DJM_SIZE, TABLE_Y, UNIT_X, unitPoint } from './layout';

export interface GearParts {
  group: THREE.Group;
  bindings: GearBinding[];
  /** Screen and jog-display textures (CanvasTextures of the shared DeckDisplay canvases). */
  textures: THREE.CanvasTexture[];
  /** Frees every geometry, material and texture of the gear. */
  dispose(): void;
}

export interface DeckCanvases {
  screen: HTMLCanvasElement;
  jog: HTMLCanvasElement;
}

/** Flags the display textures for re-upload. Call only after the DeckDisplay canvases were redrawn. */
export function markTexturesDirty(textures: readonly THREE.CanvasTexture[]): void {
  for (const t of textures) t.needsUpdate = true;
}

/** Disposes everything below `group` (geometries, materials and any textures they hold) plus `textures`. */
export function disposeGear(group: THREE.Object3D, textures: readonly THREE.Texture[]): void {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
  for (const t of textures) t.dispose();
}

const flat = (c = '#ffffff') => retroMaterial(new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
const vertexLit = () => retroMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));

/** Accumulates static boxes/cylinders with per-vertex colours and merges them into one geometry (one draw call). */
class Parts {
  private readonly list: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: string): this {
    geo.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.list.push(geo);
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): this {
    return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, color);
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: string, seg = 16): this {
    return this.add(new THREE.CylinderGeometry(r, r, h, seg), x, y, z, color);
  }
  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false);
    for (const p of this.list) p.dispose();
    if (!g) throw new Error('gear: nothing to merge');
    return g;
  }
}

/** Screen plane height above the CDJ top face; must clear the bezel (BEZEL_TOP) or the screen is occluded. */
export const SCREEN_LIFT = 0.002;
export const BEZEL_TOP = 0.0012;

const BODY = '#1a1c22';
const PLATE = '#262932';
const BEZEL = '#08090c';
const SILVER = '#8b909b';
const RUBBER = '#101115';
const LABEL = { trim: '#e8e8ec', hi: '#e8564a', mid: '#e8b03a', low: '#4a90e8', color: '#7be0a5' } as const;

/**
 * Static CDJ body in unit-local coordinates (origin = box centre, y up): a chamfered-looking
 * two-tier chassis, screen bezel, jog well + silver ring, hot cue strip, tempo slot and the
 * unlabelled button rows. Every part is a plain box/cylinder; no text or logos anywhere.
 */
function cdjBody(): THREE.BufferGeometry {
  const { w, d, h } = CDJ_SIZE;
  const L = CDJ_LAYOUT;
  const p = new Parts();
  const top = h / 2;
  const at = (u: number, v: number) => unitPoint(0, CDJ_SIZE, u, v);
  p.box(w, h - 0.004, d, 0, -0.002, 0, BODY); // chassis
  p.box(w - 0.008, 0.004, d - 0.008, 0, top - 0.002, 0, PLATE); // top plate
  p.box(w + 0.004, 0.02, d - 0.03, 0, -top + 0.03, 0, RUBBER); // lower skirt band
  for (const sx of [-1, 1]) p.box(0.012, 0.012, d * 0.9, sx * (w / 2 + 0.001), -top + 0.006, 0, RUBBER); // feet rails
  // screen bezel
  const s = at(L.screen.u, L.screen.v);
  p.box(L.screen.w * w + 0.014, 0.0012, L.screen.h * d + 0.014, s.x, top + 0.0006, s.z, BEZEL);
  // jog well + ring
  const j = at(L.jog.u, L.jog.v);
  const jr = L.jog.r * w;
  p.cyl(jr * 1.16, 0.0014, j.x, top + 0.0007, j.z, BEZEL, 28);
  p.cyl(jr * 1.05, 0.0100, j.x, top + 0.0050, j.z, SILVER, 28);
  // hot cue strip + tempo slot
  const pa = at(L.pads.u0 - 0.06, L.pads.v);
  const pb = at(L.pads.u1 + 0.06, L.pads.v);
  p.box(pb.x - pa.x, 0.0012, 0.036, (pa.x + pb.x) / 2, top + 0.0006, pa.z, BEZEL);
  const t0 = at(L.tempo.u, L.tempo.v0);
  const t1 = at(L.tempo.u, L.tempo.v1);
  p.box(0.022, 0.0012, t1.z - t0.z + 0.04, t0.x, top + 0.0006, (t0.z + t1.z) / 2, BEZEL);
  p.box(0.004, 0.0016, t1.z - t0.z, t0.x, top + 0.0009, (t0.z + t1.z) / 2, '#000000');
  // unlabelled button rows: browse/track/loop/beat-jump above the jog, transport base plates
  for (let i = 0; i < 5; i++) {
    const b = at(0.14 + i * 0.09, 0.44);
    p.box(0.024, 0.005, 0.014, b.x, top + 0.0025, b.z, i === 2 ? '#3a3f4a' : '#30343d');
  }
  for (let i = 0; i < 3; i++) {
    const b = at(0.86, 0.42 + i * 0.03);
    p.box(0.024, 0.004, 0.012, b.x, top + 0.002, b.z, '#30343d');
  }
  for (const v of [L.play.v, L.cue.v]) {
    const b = at(L.play.u, v);
    p.cyl(0.024, 0.0012, b.x, top + 0.0006, b.z, BEZEL);
  }
  return p.merge();
}

/** Static mixer body: chassis, channel strips, fader slots, unlit meter columns, EQ rings, crossfader slot. */
function djmBody(): THREE.BufferGeometry {
  const { w, d, h } = DJM_SIZE;
  const D = DJM_LAYOUT;
  const p = new Parts();
  const top = h / 2;
  const at = (u: number, v: number) => unitPoint(0, DJM_SIZE, u, v);
  p.box(w, h - 0.004, d, 0, -0.002, 0, '#15171c');
  p.box(w - 0.008, 0.004, d - 0.008, 0, top - 0.002, 0, '#20232b');
  p.box(w + 0.004, 0.02, d - 0.03, 0, -top + 0.03, 0, RUBBER);
  for (const u of D.channelU) {
    const c0 = at(u, 0.03);
    const c1 = at(u, 0.98);
    p.box(0.07, 0.0012, c1.z - c0.z, c0.x, top + 0.0006, (c0.z + c1.z) / 2, '#1c2028'); // channel strip
    for (const [key, v] of Object.entries(D.knobsV) as [keyof typeof LABEL, number][]) {
      const k = at(u, v);
      p.cyl(0.0145, 0.0016, k.x, top + 0.0008, k.z, LABEL[key], 16); // colour-coded ring under each knob
    }
    const f0 = at(u, D.faderV[0]);
    const f1 = at(u, D.faderV[1]);
    p.box(0.006, 0.0014, f1.z - f0.z + 0.03, f0.x, top + 0.0007, (f0.z + f1.z) / 2, '#000000'); // fader slot
    // level meter column beside the fader
    for (let i = 0; i < 10; i++) {
      const m = at(u + 0.13, D.faderV[1] - 0.02 - i * 0.022);
      p.box(0.006, 0.0014, 0.005, m.x, top + 0.0007, m.z, i > 7 ? '#a12a24' : i > 5 ? '#a8842a' : '#2a7a3a');
    }
    const cue = at(u, 0.5);
    p.box(0.024, 0.004, 0.012, cue.x, top + 0.002, cue.z, '#3a3f4a'); // headphone CUE button
  }
  const x0 = at(D.crossfader.u0, D.crossfader.v);
  const x1 = at(D.crossfader.u1, D.crossfader.v);
  p.box(x1.x - x0.x + 0.03, 0.0014, 0.008, (x0.x + x1.x) / 2, top + 0.0007, x0.z, '#000000');
  const dp = at(D.depth.u, D.depth.v);
  const mp = at(D.master.u, D.master.v);
  p.cyl(0.0145, 0.0016, dp.x, top + 0.0008, dp.z, '#e86ad0');
  p.cyl(0.0145, 0.0016, mp.x, top + 0.0008, mp.z, '#e8e8ec');
  for (let i = 0; i < 6; i++) {
    const b = at(0.72 + (i % 3) * 0.09, 0.42 + Math.floor(i / 3) * 0.05); // beat FX pad block
    p.box(0.022, 0.004, 0.014, b.x, top + 0.002, b.z, '#30343d');
  }
  return p.merge();
}

/**
 * Control overlays (screens, jogs, knobs, faders, LEDs) for both CDJs and the mixer, laid on
 * top of unit bodies whose top faces are at `topY`. Used by the procedural gear AND on top of
 * the downloaded glTF model, so the interactive parts always match the close-up layout.
 */
export function buildOverlays(canvases: readonly DeckCanvases[], topY: { cdj: number; djm: number }): GearParts {
  const group = new THREE.Group();
  group.name = 'gear-overlays';
  const bindings: GearBinding[] = [];
  const textures: THREE.CanvasTexture[] = [];

  // Knob = dark cylinder + white pointer, so rotation is visible. Fader cap = box + white index line.
  const knobParts = new Parts().cyl(0.011, 0.016, 0, 0, 0, '#2b2e36', 12).box(0.0025, 0.0018, 0.008, 0, 0.0085, -0.0055, '#f2f2f5');
  const knobGeo = knobParts.merge();
  const capGeo = new Parts().box(0.02, 0.012, 0.012, 0, 0, 0, '#5b606b').box(0.02, 0.0014, 0.0022, 0, 0.0067, 0, '#f2f2f5').merge();
  const xfGeo = new Parts().box(0.012, 0.012, 0.02, 0, 0, 0, '#5b606b').box(0.0022, 0.0014, 0.02, 0, 0.0067, 0, '#f2f2f5').merge();
  const knobMat = vertexLit();
  const tinyMats: THREE.Material[] = [knobMat];
  const padGeo = new THREE.BoxGeometry(0.03, 0.006, 0.02);
  const btnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.006, 16);
  const platterGeo = new THREE.CylinderGeometry(CDJ_LAYOUT.jog.r * CDJ_SIZE.w, CDJ_LAYOUT.jog.r * CDJ_SIZE.w, 0.012, 24);
  const jogFaceGeo = new THREE.CircleGeometry(CDJ_LAYOUT.jog.r * CDJ_SIZE.w * 0.62, 24);
  const screenGeo = new THREE.PlaneGeometry(CDJ_LAYOUT.screen.w * CDJ_SIZE.w, CDJ_LAYOUT.screen.h * CDJ_SIZE.d);
  const platterMat = flat('#23262e');
  const capMat = vertexLit();
  tinyMats.push(platterMat, capMat);
  const shared = [knobGeo, capGeo, xfGeo, padGeo, btnGeo, platterGeo, jogFaceGeo, screenGeo];

  for (const deck of [0, 1] as const satisfies readonly DeckId[]) {
    const cx = cdjX(deck);
    const y = topY.cdj + 0.001;
    const screenTex = new THREE.CanvasTexture(canvases[deck]!.screen);
    const jogTex = new THREE.CanvasTexture(canvases[deck]!.jog);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    jogTex.colorSpace = THREE.SRGBColorSpace;
    textures.push(screenTex, jogTex);
    const L = CDJ_LAYOUT;
    const sp = unitPoint(cx, CDJ_SIZE, L.screen.u, L.screen.v);
    const screen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: screenTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(sp.x, topY.cdj + SCREEN_LIFT, sp.z);
    screen.name = `screen-${deck}`;
    const jp = unitPoint(cx, CDJ_SIZE, L.jog.u, L.jog.v);
    const platter = new THREE.Mesh(platterGeo, platterMat);
    platter.position.set(jp.x, y + 0.006, jp.z);
    const jogFace = new THREE.Mesh(jogFaceGeo, new THREE.MeshBasicMaterial({ map: jogTex }));
    jogFace.rotation.x = -Math.PI / 2;
    jogFace.position.set(jp.x, y + 0.0125, jp.z);
    jogFace.name = `jog-${deck}`;

    const tempoCap = new THREE.Mesh(capGeo, capMat);
    const t0 = unitPoint(cx, CDJ_SIZE, L.tempo.u, L.tempo.v0);
    const t1 = unitPoint(cx, CDJ_SIZE, L.tempo.u, L.tempo.v1);
    tempoCap.position.set(t0.x, y + 0.006, (t0.z + t1.z) / 2);
    bindings.push({ kind: 'fader', object: tempoCap, axis: 'z', from: t0.z, to: t1.z, min: -1, max: 1, read: (s) => s.decks[deck].tempoFader });

    const led = (u: number, v: number, on: string, read: LedRead) => {
      const m = new THREE.MeshBasicMaterial({ color: '#222' });
      tinyMats.push(m);
      const p = unitPoint(cx, CDJ_SIZE, u, v);
      const btn = new THREE.Mesh(btnGeo, m);
      btn.position.set(p.x, y + 0.003, p.z);
      group.add(btn);
      bindings.push({ kind: 'led', material: m, on: new THREE.Color(on), off: new THREE.Color('#222'), read });
    };
    led(L.play.u, L.play.v, '#35e06b', (_s, t) => t.decks[deck].state !== 'PAUSED');
    led(L.cue.u, L.cue.v, '#ff9c1a', (_s, t) => t.decks[deck].atCue);
    for (let i = 0; i < HOT_CUE_COUNT; i++) {
      const m = new THREE.MeshBasicMaterial({ color: '#222' });
      tinyMats.push(m);
      const p = unitPoint(cx, CDJ_SIZE, L.pads.u0 + ((L.pads.u1 - L.pads.u0) * i) / (HOT_CUE_COUNT - 1), L.pads.v);
      const pad = new THREE.Mesh(padGeo, m);
      pad.position.set(p.x, y + 0.003, p.z);
      group.add(pad);
      bindings.push({ kind: 'led', material: m, on: new THREE.Color('#28e214'), off: new THREE.Color('#222'), read: (s) => s.decks[deck].hotCues[i]?.color ?? false });
    }
    group.add(screen, platter, jogFace, tempoCap);
  }

  // mixer
  const y = topY.djm + 0.001;
  const D = DJM_LAYOUT;
  for (const ch of [0, 1] as const) {
    const knobs: Array<[number, (s: DjData) => number, number, number]> = [
      [D.knobsV.trim, (s) => s.mixer.ch[ch].trim, 0, 1],
      [D.knobsV.hi, (s) => s.mixer.ch[ch].hi, 0, 1],
      [D.knobsV.mid, (s) => s.mixer.ch[ch].mid, 0, 1],
      [D.knobsV.low, (s) => s.mixer.ch[ch].low, 0, 1],
      [D.knobsV.color, (s) => s.mixer.ch[ch].color, -1, 1],
    ];
    for (const [v, read, min, max] of knobs) {
      const k = new THREE.Mesh(knobGeo, knobMat);
      const p = unitPoint(UNIT_X.djm, DJM_SIZE, D.channelU[ch], v);
      k.position.set(p.x, y + 0.008, p.z);
      group.add(k);
      bindings.push({ kind: 'knob', object: k, min, max, read });
    }
    const f0 = unitPoint(UNIT_X.djm, DJM_SIZE, D.channelU[ch], D.faderV[1]);
    const f1 = unitPoint(UNIT_X.djm, DJM_SIZE, D.channelU[ch], D.faderV[0]);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(f0.x, y + 0.006, f0.z);
    group.add(cap);
    bindings.push({ kind: 'fader', object: cap, axis: 'z', from: f0.z, to: f1.z, min: 0, max: 1, read: (s) => s.mixer.ch[ch].fader });
  }
  const x0 = unitPoint(UNIT_X.djm, DJM_SIZE, D.crossfader.u0, D.crossfader.v);
  const x1 = unitPoint(UNIT_X.djm, DJM_SIZE, D.crossfader.u1, D.crossfader.v);
  const xf = new THREE.Mesh(xfGeo, capMat);
  xf.position.set((x0.x + x1.x) / 2, y + 0.006, x0.z);
  group.add(xf);
  bindings.push({ kind: 'fader', object: xf, axis: 'x', from: x0.x, to: x1.x, min: 0, max: 1, read: (s) => s.mixer.crossfader });
  for (const [pos, read] of [
    [D.depth, (s: DjData) => s.mixer.beatFx.depth],
    [D.master, (s: DjData) => s.mixer.masterLevel],
  ] as const) {
    const k = new THREE.Mesh(knobGeo, knobMat);
    const p = unitPoint(UNIT_X.djm, DJM_SIZE, pos.u, pos.v);
    k.position.set(p.x, y + 0.008, p.z);
    group.add(k);
    bindings.push({ kind: 'knob', object: k, min: 0, max: 1, read });
  }

  return {
    group,
    bindings,
    textures,
    dispose: () => {
      disposeGear(group, textures);
      for (const g of shared) g.dispose();
      for (const m of tinyMats) m.dispose();
    },
  };
}

/** Fallback gear when content/models/booth.glb is absent: low-poly bodies + the shared overlays. */
export function buildProceduralGear(canvases: readonly DeckCanvases[]): GearParts {
  const group = new THREE.Group();
  group.name = 'gear-procedural';
  const cdjGeo = cdjBody();
  const djmGeo = djmBody();
  const bodyMat = vertexLit();
  for (const deck of [0, 1] as const) {
    const m = new THREE.Mesh(cdjGeo, bodyMat);
    m.position.set(cdjX(deck), TABLE_Y + CDJ_SIZE.h / 2, 0);
    m.name = `cdj-${deck}`;
    group.add(m);
  }
  const djm = new THREE.Mesh(djmGeo, bodyMat);
  djm.position.set(UNIT_X.djm, TABLE_Y + DJM_SIZE.h / 2, 0);
  djm.name = 'djm';
  group.add(djm);
  const overlays = buildOverlays(canvases, { cdj: TABLE_Y + CDJ_SIZE.h, djm: TABLE_Y + DJM_SIZE.h });
  group.add(overlays.group);
  return {
    group,
    bindings: overlays.bindings,
    textures: overlays.textures,
    dispose: () => {
      overlays.dispose();
      cdjGeo.dispose();
      djmGeo.dispose();
      bodyMat.dispose();
    },
  };
}
