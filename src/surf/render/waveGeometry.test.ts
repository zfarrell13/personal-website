import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { FOG_CONFIG, SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { buildWaveGeometry, columnsX, lipWeight, SEA, waveVertexColor, type OceanLayout } from './waveGeometry';
import { injectWaveShader, LIP_MAX_OFFSET, lipOffset, makeFoamTexture } from './waveMaterial';

const shape = () => new WaveShape(structuredClone(SURF_CONFIG.wave));

describe('columnsX', () => {
  it('spans the range and is denser near the curl', () => {
    const xs = columnsX(160, -30, 90);
    expect(xs).toHaveLength(160);
    expect(xs[0]).toBe(-30);
    expect(xs[159]).toBe(90);
    for (let i = 1; i < 160; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    const spacingAt = (x: number) => {
      const i = xs.findIndex((v) => v >= x);
      return xs[i]! - xs[i - 1]!;
    };
    expect(spacingAt(0)).toBeLessThan(spacingAt(80) / 3);
  });
});

describe('buildWaveGeometry (the whole ocean: wave + flat sea in one surface)', () => {
  const layout = (geo: { userData: unknown }) => geo.userData as OceanLayout;
  const vec = (
    attr: {
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
    },
    i: number,
  ) => new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));

  it('samples the same profile the physics uses on the face', () => {
    const w = shape();
    const xs = columnsX(20, -30, 90);
    const geo = buildWaveGeometry(w, xs, 16);
    const L = layout(geo);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(L.columns * L.rows);
    expect(geo.getIndex()!.count).toBe((L.columns - 1) * (L.rows - 1) * 6);
    expect(geo.getAttribute('color').itemSize).toBe(4);
    const i = L.firstSimColumn + 7;
    const x = L.xs[i]!;
    expect(x).toBe(xs[7]);
    for (const r of [0, 3, 6]) {
      const t = L.t[i * L.rows + L.profileRow + r]!;
      expect(t).toBeLessThanOrEqual(w.crestT(x) + 1e-9);
      expect(vec(pos, i * L.rows + L.profileRow + r).distanceTo(w.profile(x, t))).toBeLessThan(1e-4);
    }
  });

  it('reaches past the fog in every direction, so no sea edge is ever visible', () => {
    const geo = buildWaveGeometry(shape(), columnsX(40, -30, 90), 16);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    for (const v of [-box.min.x, box.max.x, -box.min.z, box.max.z]) expect(v).toBeGreaterThan(FOG_CONFIG.far + 100);
  });

  it('meets the sea seamlessly: the outer edge and every flat vertex are plain sea (same height, normal, colour, opacity, no foam)', () => {
    const w = shape();
    const geo = buildWaveGeometry(w, columnsX(60, -30, 90), 24);
    const L = layout(geo);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const col = geo.getAttribute('color');
    const foam = geo.getAttribute('aFoam');
    const isSea = (v: number) => {
      expect(pos.getY(v)).toBeCloseTo(0, 6);
      expect(vec(nor, v).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
      expect(col.getX(v)).toBeCloseTo(SEA.color.r, 4);
      expect(col.getY(v)).toBeCloseTo(SEA.color.g, 4);
      expect(col.getZ(v)).toBeCloseTo(SEA.color.b, 4);
      expect(col.getW(v)).toBeCloseTo(SEA.alpha, 4);
      expect(foam.getX(v)).toBe(0);
    };
    for (let i = 0; i < L.columns; i++) {
      isSea(i * L.rows);
      isSea(i * L.rows + L.rows - 1);
    }
    for (let r = 0; r < L.rows; r++) {
      isSea(r);
      isSea((L.columns - 1) * L.rows + r);
    }
  });

  it('has no height step or shading jump where the wave runs into the flats (front, back and both ends)', () => {
    const w = shape();
    const geo = buildWaveGeometry(w, columnsX(60, -30, 90), 24);
    const L = layout(geo);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const col = geo.getAttribute('color');
    const D = w.params.tubeDepth;
    for (let i = 0; i < L.columns; i++) {
      // Walking a column from the far sea into the trough, and down the back out to the far sea: no steps.
      for (let r = 1; r < L.rows; r++) {
        if (r > L.profileRow + 2 && r <= L.backRow) continue;
        const a = i * L.rows + r - 1;
        const b = a + 1;
        const run = Math.hypot(pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a));
        if (pos.getY(a) < 1e-6 && pos.getY(b) < 1e-6) continue;
        // no vertical wall between two samples that are far apart (a step)
        expect(Math.abs(pos.getY(b) - pos.getY(a)), `col ${i} row ${r}`).toBeLessThan(Math.max(0.5, 2 * run));
      }
      // Where the flat sea ends (first/last sample off the flat), the water still faces up and is sea-coloured.
      const x = L.xs[i]!;
      if (x < -D) continue; // whitewater spreads over the flats behind the lip (its foam fades out across them)
      for (const v of [i * L.rows + L.profileRow, i * L.rows + L.backRow + L.backSamples - 1]) {
        expect(nor.getY(v), `col ${i}`).toBeGreaterThan(Math.cos((4 * Math.PI) / 180));
        expect(Math.abs(col.getX(v) - SEA.color.r) + Math.abs(col.getY(v) - SEA.color.g) + Math.abs(col.getZ(v) - SEA.color.b)).toBeLessThan(0.05);
        expect(col.getW(v)).toBeCloseTo(SEA.alpha, 2);
      }
    }
    // Past both ends of the ridden range the wave eases down to flat water.
    for (const i of [1, L.columns - 2]) {
      for (let r = 0; r < L.rows; r++) expect(Math.abs(pos.getY(i * L.rows + r))).toBeLessThan(0.01);
    }
  });

  it('gives the lip thickness over the barrel, thinning to the tip', () => {
    const w = shape();
    const geo = buildWaveGeometry(w, columnsX(160, -30, 90), 64);
    const L = layout(geo);
    const pos = geo.getAttribute('position');
    const i = L.xs.findIndex((x) => x >= -2);
    const under = (r: number) => vec(pos, i * L.rows + L.profileRow + r);
    const top = (k: number) => vec(pos, i * L.rows + L.lipRow + k);
    const tip = under(L.profileSamples - 1);
    // the lip top starts at the tip and ends over the crest
    expect(top(0).distanceTo(tip)).toBeLessThan(0.05);
    const tc = w.crestT(L.xs[i]!);
    const crest = w.profile(L.xs[i]!, tc);
    const over = top(L.lipSamples - 1);
    expect(over.y - crest.y).toBeGreaterThan(0.05);
    // mid-lip: a real slab of water between the tube ceiling and the lip top
    const mid = top(Math.floor(L.lipSamples / 2));
    let nearest = Infinity;
    for (let r = 0; r < L.profileSamples; r++) nearest = Math.min(nearest, under(r).distanceTo(mid));
    expect(nearest).toBeGreaterThan(0.15);
  });

  it('winds face triangles so their geometric normal points up and toward shore', () => {
    const w = shape();
    const geo = buildWaveGeometry(w, columnsX(30, -30, 90), 24);
    const L = layout(geo);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.getIndex()!;
    const i = L.xs.findIndex((x) => x >= 20); // shoulder column, well clear of the curl
    const r = L.profileRow + 8; // mid-face
    const tri = (i * (L.rows - 1) + r) * 6;
    const [a, b, c] = [idx.getX(tri), idx.getX(tri + 1), idx.getX(tri + 2)].map((k) => vec(pos, k));
    expect(a!.y).toBeGreaterThan(0.2);
    const faceN = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
    expect(faceN.z).toBeGreaterThan(0.2);
    expect(faceN.y).toBeGreaterThan(0.2);
    expect(faceN.dot(vec(nor, idx.getX(tri)))).toBeGreaterThan(0.9);
  });
});

describe('wave colors', () => {
  it('goes teal in the trough, green on the face and white on foam', () => {
    const c = new Color();
    waveVertexColor(0, 2.4, 0.1, 0.7, 0, c);
    const trough = c.clone();
    waveVertexColor(1.2, 2.4, 0.4, 0.7, 0, c);
    expect(c.g).toBeGreaterThan(trough.g);
    waveVertexColor(1.2, 2.4, 0.4, 0.7, 1, c);
    expect(c.r).toBeGreaterThan(0.9);
  });
});

describe('injectWaveShader', () => {
  it('adds ripple, foam and subsurface code at the right include points', () => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: 'void main(){\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>\n}',
      fragmentShader: 'void main(){\n#include <color_fragment>\n#include <emissivemap_fragment>\n}',
    };
    const u = { uTime: { value: 0 }, uTravel: { value: 0 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() } };
    injectWaveShader(shader as never, u);
    expect(shader.vertexShader).toContain('attribute float aFoam;');
    expect(shader.vertexShader).toContain('attribute float aLip;');
    expect(shader.vertexShader).toContain('position.x + uTravel');
    expect(shader.vertexShader.indexOf('transformed +=')).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uSSS');
    expect(shader.uniforms.uTravel).toBe(u.uTravel);
  });
});

describe('lip animation weight', () => {
  it('is zero on the rideable face and at the crest, and grows past the crest where the lip pitches', () => {
    const w = shape();
    const geo = buildWaveGeometry(w, columnsX(40, -10, 60), 32);
    const L = geo.userData as OceanLayout;
    const lip = geo.getAttribute('aLip');
    const { xMin, xMax } = w.params;
    let maxOnFace = 0;
    let maxPastCrest = 0;
    for (let i = 0; i < L.columns; i++) {
      const xc = Math.min(xMax, Math.max(xMin, L.xs[i]!));
      const tc = w.crestT(xc);
      for (let r = 0; r < L.rows; r++) {
        const v = i * L.rows + r;
        const a = lip.getX(v);
        const t = L.t[v]!;
        // Every row that isn't past the crest on the profile — the flats, the face, the back — is still.
        if (Number.isNaN(t) ? r < L.lipRow || r >= L.backRow : t <= tc) maxOnFace = Math.max(maxOnFace, a);
        else if (xc > -3 && xc < 2) maxPastCrest = Math.max(maxPastCrest, a);
      }
    }
    expect(maxOnFace).toBe(0);
    expect(maxPastCrest).toBeGreaterThan(0.9);
    expect(lipWeight(w, 40, 1, w.crestT(40))).toBeLessThan(0.01); // the shoulder does not pitch
  });

  it('only ever moves the lip up and out (away from the face, never down into the tube), within LIP_MAX_OFFSET', () => {
    const out = new Vector3();
    let maxLen = 0;
    for (let k = 0; k < 400; k++) {
      const x = -8 + (k % 40) * 0.5;
      const time = k * 0.137;
      lipOffset(x, 1, time, out);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.z).toBeGreaterThanOrEqual(0);
      maxLen = Math.max(maxLen, out.length());
      lipOffset(x, 0, time, out);
      expect(out.length()).toBe(0);
    }
    expect(maxLen).toBeGreaterThan(0.15); // it visibly throws
    expect(maxLen).toBeLessThanOrEqual(LIP_MAX_OFFSET + 1e-9);
  });
});
