import { describe, expect, it } from 'vitest';
import { Box3, FrontSide, type BufferGeometry } from 'three';
import { FOG_CONFIG, SURF_CONFIG } from '../config';
import { scrollWrap } from './scroll';
import { buildShore, createShoreMaterial, groundY, SHORE, shoreZ, WATER_TOWER_STEM, type LandmarkKind } from './shore';

const desktop = buildShore();
const lite = buildShore({ lite: true });
const tris = (g: BufferGeometry) => g.getAttribute('position').count / 3;
const box = (g: BufferGeometry) => new Box3().setFromBufferAttribute(g.getAttribute('position') as never);

/** View depth at which three's fog is 99 % (smoothstep(near, far, depth)). */
function fog99(): number {
  const { near, far } = FOG_CONFIG;
  for (let d = near; d <= far; d += 0.1) {
    const t = (d - near) / (far - near);
    if (t * t * (3 - 2 * t) >= 0.99) return d;
  }
  return far;
}
// Widest frustum in play (see the horizon test in Environment.test): a point off-axis by θ is at depth distance·cos θ.
const tanV = Math.tan(((SURF_CONFIG.camera.fov / 2) * Math.PI) / 180);
const cosCorner = 1 / Math.hypot(1, tanV, tanV * 2.4);
const cams = { xMin: SURF_CONFIG.wave.xMin - 20, xMax: SURF_CONFIG.wave.xMax + 20, zMax: 40 };

describe('shore strip', () => {
  it('cuts the strip into equal chunks that tile the scroll span', () => {
    const n = SHORE.span / SHORE.chunk;
    expect(desktop.chunks).toHaveLength(n);
    desktop.chunks.forEach((c, k) => expect(c.worldX).toBe(k * SHORE.chunk + SHORE.chunk / 2));
  });

  it('keeps the strip continuous past full fog both ways down the beach at every travel (no chunk pops in view)', () => {
    const margin = fog99() / cosCorner;
    for (let travel = 0; travel < 2 * SHORE.span; travel += 7.3) {
      const spans = desktop.chunks
        .map((c) => scrollWrap(c.worldX, travel, SHORE.span, SHORE.start))
        .map((x) => [x - SHORE.chunk / 2, x + SHORE.chunk / 2] as const)
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeCloseTo(spans[i - 1]![1], 6);
      expect(spans[0]![0]).toBeLessThan(cams.xMin - margin);
      expect(spans[spans.length - 1]![1]).toBeGreaterThan(cams.xMax + margin);
    }
  });

  it('wraps seamlessly: the ground at the end of the strip meets its start', () => {
    for (const zr of [-30, 0, 20, 70, 150, 240, 300, 420, 700]) {
      const z = shoreZ(0) + zr;
      expect(groundY(SHORE.span, z)).toBeCloseTo(groundY(0, z), 6);
    }
    expect(shoreZ(SHORE.span)).toBeCloseTo(shoreZ(0), 6);
  });

  it('rises out of the shallows: under the sea floor offshore, at sea level on the waterline, dry beach behind', () => {
    for (let u = 0; u < SHORE.span; u += 37) {
      const s = shoreZ(u);
      expect(groundY(u, s - 45)).toBeLessThan(-4.3); // below the opaque sea floor (SEA_FLOOR_Y): no seam
      expect(Math.abs(groundY(u, s))).toBeLessThan(0.15);
      expect(groundY(u, s + 20)).toBeGreaterThan(0.4);
      expect(groundY(u, s + 75)).toBeGreaterThan(2.5); // dunes
      expect(groundY(u, s + 235)).toBeLessThan(-1); // Banks Channel
    }
  });

  it('is all on the beach side, shoreward of the wave and the flats the rider uses', () => {
    for (const c of desktop.chunks) {
      expect(box(c.near).min.z).toBeGreaterThan(SHORE.pierEndZ - 1);
      expect(box(c.far).min.z).toBeGreaterThan(SHORE.z + SHORE.splitZr - 10);
      expect(box(c.near).min.x).toBeGreaterThan(-SHORE.chunk);
      expect(box(c.near).max.x).toBeLessThan(SHORE.chunk);
    }
  });

  it('runs the land out past full fog (no far edge in view)', () => {
    const farEdge = Math.min(...desktop.chunks.map((c) => box(c.far).max.z));
    expect((farEdge - cams.zMax) * cosCorner).toBeGreaterThan(fog99());
  });

  it('places the water tower every 650 m: often enough to be seen, not so often it repeats', () => {
    const us = desktop.landmarks.filter((l) => l.kind === 'waterTower').map((l) => l.u).sort((a, b) => a - b);
    expect(us).toHaveLength(SHORE.landmarkU.length * SHORE.waterTowerAt.length);
    for (let i = 0; i < us.length; i++) {
      const d = (us[(i + 1) % us.length]! - us[i]! + SHORE.span) % SHORE.span;
      expect(d).toBeGreaterThanOrEqual(600);
      expect(d).toBeLessThanOrEqual(700);
    }
  });

  it('stands the water tower just behind the beach, its tank well above every roof, marked as a landmark', () => {
    for (const t of desktop.landmarks.filter((l) => l.kind === 'waterTower')) {
      const zr = t.z - shoreZ(t.u);
      expect(zr).toBeGreaterThan(100); // behind the front row of houses (≈ 97 m) …
      expect(zr).toBeLessThan(150); // … well in front of the channel (≈ 205 m)
    }
    // Every landmark-marked vertex (the towers) and the tallest unmarked one (houses, condos, the Oceanic).
    let marked = 0;
    let tallestOther = 0;
    let tallestMarked = 0;
    for (const c of desktop.chunks) {
      const pos = c.near.getAttribute('position');
      const mark = c.near.getAttribute('aLandmark');
      for (let i = 0; i < pos.count; i++) {
        if (mark.getX(i) > 0) {
          marked++;
          tallestMarked = Math.max(tallestMarked, pos.getY(i));
        } else if (Math.abs(pos.getX(i)) < SHORE.chunk) tallestOther = Math.max(tallestOther, pos.getY(i));
      }
    }
    expect(marked).toBeGreaterThan(0);
    expect(tallestMarked).toBeGreaterThan(WATER_TOWER_STEM + 10);
    // Well above the houses; only the resort tower comes near it.
    expect(tallestMarked).toBeGreaterThan(tallestOther + 15);
  });

  it('places each landmark once per set, the sets no closer than the old pier wrap (1300 m)', () => {
    const kinds: LandmarkKind[] = ['pier', 'oceanic', 'lifeguard', 'resort'];
    for (const kind of kinds) {
      const us = desktop.landmarks.filter((l) => l.kind === kind).map((l) => l.u);
      expect(us).toHaveLength(SHORE.landmarkU.length);
      for (let i = 0; i < us.length; i++) {
        const d = Math.abs(us[(i + 1) % us.length]! - us[i]!);
        expect(Math.min(d, SHORE.span - d)).toBeGreaterThanOrEqual(1300);
      }
    }
    // Landmarks stand on the beach side: the pier reaches out toward the break, the rest are ashore.
    for (const l of desktop.landmarks) {
      if (l.kind === 'pier') expect(l.z).toBeGreaterThan(0);
      else expect(l.z).toBeGreaterThan(shoreZ(l.u));
    }
  });

  it('starts with the pier down the line, in view from the title and the drop-in but not on top of the rider', () => {
    const pier = desktop.landmarks.find((l) => l.kind === 'pier')!;
    const x = scrollWrap(pier.u, 0, SHORE.span, SHORE.start);
    expect(x).toBeGreaterThan(cams.xMax + 100);
    expect(x).toBeLessThan(FOG_CONFIG.near + 300);
  });

  it('stays within a triangle budget, and the phone build is much lighter', () => {
    const sum = (s: typeof desktop) => s.chunks.reduce((a, c) => a + tris(c.near) + tris(c.far), 0);
    // At most ~6 chunks are in a chase view; the e2e budget (150k with the wave) holds the rest.
    expect(Math.max(...desktop.chunks.map((c) => tris(c.near) + tris(c.far)))).toBeLessThan(9000);
    expect(sum(lite)).toBeLessThan(0.6 * sum(desktop));
  });

  it('uses one lit, fogged, single-sided material with the sunny glow; landmarks glow more and keep some haze off (open air only)', () => {
    const m = createShoreMaterial();
    expect(m.fog).toBe(true);
    expect(m.vertexColors).toBe(true);
    expect(m.side).toBe(FrontSide);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main(){\n#include <emissivemap_fragment>\n#include <fog_fragment>\n}',
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vLandmark = aLandmark;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    expect(shader.fragmentShader).toContain('vLandmark');
    // The haze clearing is gated on the open-air fog: the underwater fog (far 18 m) still hides everything.
    expect(shader.fragmentShader).toContain('step(100.0, fogFar)');
    // … and eases out before fog far: a landmark is fully fogged beyond it (no tower in the far haze or at a wrap).
    expect(shader.fragmentShader).toContain('(1.0 - smoothstep(0.75 * fogFar, fogFar, vFogDepth))');
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
    m.dispose();
  });

  it('keeps condos, houses and dune tufts out of the landmarks (no buried or overlapping geometry)', () => {
    // Nothing unmarked rises inside a water tower's stem footprint, over the tower's height range.
    for (const t of desktop.landmarks.filter((l) => l.kind === 'waterTower')) {
      const k = Math.floor((((t.u % SHORE.span) + SHORE.span) % SHORE.span) / SHORE.chunk);
      const c = desktop.chunks[k]!;
      const tx = (((t.u % SHORE.span) + SHORE.span) % SHORE.span) - c.worldX;
      const pos = c.near.getAttribute('position');
      const mark = c.near.getAttribute('aLandmark');
      const ground = groundY(t.u, t.z);
      for (let i = 0; i < pos.count; i++) {
        if (mark.getX(i) > 0) continue;
        const near = Math.abs(pos.getX(i) - tx) < 3 && Math.abs(pos.getZ(i) - t.z) < 3;
        if (near) expect(pos.getY(i)).toBeLessThan(ground + 1.5); // only the ground itself
      }
    }
  });
});
