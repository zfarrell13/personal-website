import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { buildBackGeometry, buildWaveGeometry, columnsX, FRONT_SKIRT, waveVertexColor } from './waveGeometry';
import { injectWaveShader, makeFoamTexture } from './waveMaterial';

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

describe('buildWaveGeometry', () => {
  it('samples the same profile the physics uses, plus a flat skirt row', () => {
    const w = shape();
    const xs = columnsX(20, -30, 90);
    const geo = buildWaveGeometry(w, xs, 16);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(20 * 17);
    const R = 17;
    const i = 7;
    const expected = w.profile(xs[i]!, 5 / 15);
    const v = i * R + 6; // row 6 = t 5/15
    expect(new Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)).distanceTo(expected)).toBeLessThan(1e-4);
    expect(pos.getZ(i * R)).toBeCloseTo(w.profile(xs[i]!, 0).z + FRONT_SKIRT, 3);
    expect(geo.getIndex()!.count).toBe(19 * 16 * 6);
    expect(geo.getAttribute('color').itemSize).toBe(4);
  });

  it('winds face triangles so their geometric normal points up and toward shore', () => {
    const w = shape();
    const xs = columnsX(30, -30, 90);
    const rows = 24;
    const geo = buildWaveGeometry(w, xs, rows);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.getIndex()!;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const i = xs.findIndex((x) => x >= 20); // shoulder column, well clear of the curl
    const r = 8; // quad row 8 of 24 => t ~ 0.3, mid-face (row 0 is the skirt)
    const tri = (i * rows + r) * 6;
    const [ia, ib, ic] = [idx.getX(tri), idx.getX(tri + 1), idx.getX(tri + 2)];
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    expect(a.y).toBeGreaterThan(0.2); // genuinely on the face, not the flat skirt
    const faceN = b.sub(a).cross(c.sub(a)).normalize();
    expect(faceN.z).toBeGreaterThan(0.2); // toward shore
    expect(faceN.y).toBeGreaterThan(0.2); // up
    n.fromBufferAttribute(nor, ia);
    expect(faceN.dot(n)).toBeGreaterThan(0.9); // agrees with the shading normal
  });

  it('builds a back surface from the crest down to sea level', () => {
    const w = shape();
    const xs = columnsX(10, -30, 90);
    const geo = buildBackGeometry(w, xs);
    const pos = geo.getAttribute('position');
    expect(pos.getY(4)).toBeCloseTo(0, 5);
    expect(pos.getY(0)).toBeGreaterThan(0.3);
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
    const u = { uTime: { value: 0 }, uPeel: { value: 7 }, uFoamTex: { value: makeFoamTexture() }, uSSS: { value: new Vector3() } };
    injectWaveShader(shader as never, u);
    expect(shader.vertexShader).toContain('attribute float aFoam;');
    expect(shader.vertexShader.indexOf('transformed +=')).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uSSS');
    expect(shader.uniforms.uPeel).toBe(u.uPeel);
  });
});
