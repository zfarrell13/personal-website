import { BufferAttribute, BufferGeometry, Color, type ColorRepresentation } from 'three';

const c = new Color();

/**
 * Accumulates flat-shaded, vertex-coloured, non-indexed triangles: the low-poly scenery is built
 * straight into arrays (hundreds of houses would be slow as separate geometries to merge).
 * Everything is axis-aligned except where a builder takes explicit corners.
 */
export class LowPoly {
  private pos: number[] = [];
  private col: number[] = [];
  private mark: number[] = [];
  /** Landmark weight (0 … 1) given to the triangles added while it is set: the `aLandmark` attribute. */
  landmark = 0;

  tri(a: readonly number[], b: readonly number[], d: readonly number[], color: ColorRepresentation | Color): this {
    c.set(color);
    this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, d[0]!, d[1]!, d[2]!);
    for (let i = 0; i < 3; i++) this.col.push(c.r, c.g, c.b);
    this.mark.push(this.landmark, this.landmark, this.landmark);
    return this;
  }

  /** Quad a-b-d-e, counter-clockwise seen from the front. */
  quad(a: readonly number[], b: readonly number[], d: readonly number[], e: readonly number[], color: ColorRepresentation | Color): this {
    return this.tri(a, b, d, color).tri(a, d, e, color);
  }

  /** Axis-aligned box from its base centre (x, y0, z): size w (x) × h (y) × d (z). Bottom face omitted. */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, color: ColorRepresentation | Color, top: ColorRepresentation | Color = color): this {
    const [x0, x1, z0, z1, y1] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2, y0 + h];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color); // −z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color); // −x
    return this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top); // top
  }

  /** A thin strut between two points (square section s): pilings' cross-bracing and railings. */
  strut(a: readonly number[], b: readonly number[], s: number, color: ColorRepresentation | Color): this {
    const [dx, dy, dz] = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const len = Math.hypot(dx, dy, dz);
    // Two perpendicular offsets: one horizontal across the strut, one completing the frame.
    let [ux, uy, uz] = Math.abs(dy) < 0.99 * len ? [-dz, 0, dx] : [1, 0, 0];
    const ul = Math.hypot(ux, uy, uz);
    [ux, uy, uz] = [(ux / ul) * s * 0.5, (uy / ul) * s * 0.5, (uz / ul) * s * 0.5];
    let [vx, vy, vz] = [dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux];
    const vl = Math.hypot(vx, vy, vz);
    [vx, vy, vz] = [(vx / vl) * s * 0.5, (vy / vl) * s * 0.5, (vz / vl) * s * 0.5];
    const corner = (p: readonly number[], i: number) => {
      const [su, sv] = [[1, 1], [-1, 1], [-1, -1], [1, -1]][i]!;
      return [p[0]! + su! * ux + sv! * vx, p[1]! + su! * uy + sv! * vy, p[2]! + su! * uz + sv! * vz];
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(corner(a, i), corner(a, j), corner(b, j), corner(b, i), color);
    }
    return this;
  }

  /** Gable roof over a w × d footprint at height y: ridge along x (alongX) or z, rising rise metres. */
  gable(x: number, y: number, z: number, w: number, d: number, rise: number, color: ColorRepresentation | Color, alongX = true, end: ColorRepresentation | Color = color): this {
    const [x0, x1, z0, z1, yr] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + rise];
    if (alongX) {
      this.quad([x0, y, z1], [x1, y, z1], [x1, yr, z], [x0, yr, z], color);
      this.quad([x1, y, z0], [x0, y, z0], [x0, yr, z], [x1, yr, z], color);
      this.tri([x1, y, z1], [x1, y, z0], [x1, yr, z], end);
      return this.tri([x0, y, z0], [x0, y, z1], [x0, yr, z], end);
    }
    this.quad([x1, y, z1], [x1, y, z0], [x, yr, z0], [x, yr, z1], color);
    this.quad([x0, y, z0], [x0, y, z1], [x, yr, z1], [x, yr, z0], color);
    this.tri([x0, y, z1], [x1, y, z1], [x, yr, z1], end);
    return this.tri([x1, y, z0], [x0, y, z0], [x, yr, z0], end);
  }

  /** Hip roof over a w × d footprint at height y: four slopes up to a ridge along the longer side. */
  hip(x: number, y: number, z: number, w: number, d: number, rise: number, color: ColorRepresentation | Color): this {
    const [x0, x1, z0, z1, yr] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + rise];
    const r = Math.abs(w - d) / 2;
    const [ra, rb] = w >= d ? [[x - r, yr, z], [x + r, yr, z]] : [[x, yr, z + r], [x, yr, z - r]];
    if (w >= d) {
      this.quad([x0, y, z1], [x1, y, z1], rb, ra, color);
      this.quad([x1, y, z0], [x0, y, z0], ra, rb, color);
      this.tri([x1, y, z1], [x1, y, z0], rb, color);
      return this.tri([x0, y, z0], [x0, y, z1], ra, color);
    }
    this.quad([x1, y, z1], [x1, y, z0], rb, ra, color);
    this.quad([x0, y, z0], [x0, y, z1], ra, rb, color);
    this.tri([x0, y, z1], [x1, y, z1], ra, color);
    return this.tri([x1, y, z0], [x0, y, z0], rb, color);
  }

  /** Vertical prism (n sides) from y0 to y1, radius r0 at the bottom and r1 at the top (r1 = 0: a cone). */
  prism(x: number, y0: number, z: number, r0: number, r1: number, h: number, n: number, color: ColorRepresentation | Color, phase = 0): this {
    const y1 = y0 + h;
    for (let i = 0; i < n; i++) {
      const [a0, a1] = [phase + (i / n) * Math.PI * 2, phase + ((i + 1) / n) * Math.PI * 2];
      const p = (a: number, r: number, y: number) => [x + Math.cos(a) * r, y, z - Math.sin(a) * r];
      if (r1 > 0) this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), color);
      else this.tri(p(a0, r0, y0), p(a1, r0, y0), [x, y1, z], color);
    }
    return this;
  }

  /** Low-poly ball (lat/long, n around × m down), for the water tower's tank. */
  ball(x: number, y: number, z: number, r: number, n: number, m: number, color: ColorRepresentation | Color): this {
    const p = (i: number, j: number) => {
      const [a, b] = [(i / n) * Math.PI * 2, (j / m) * Math.PI];
      return [x + Math.cos(a) * Math.sin(b) * r, y + Math.cos(b) * r, z - Math.sin(a) * Math.sin(b) * r];
    };
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        if (j === 0) this.tri(p(i, 0), p(i, 1), p(i + 1, 1), color);
        else if (j === m - 1) this.tri(p(i, j), p(i, j + 1), p(i + 1, j), color);
        else this.quad(p(i, j), p(i, j + 1), p(i + 1, j + 1), p(i + 1, j), color);
      }
    }
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aLandmark', new BufferAttribute(new Float32Array(this.mark), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
