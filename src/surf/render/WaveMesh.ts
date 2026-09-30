import { BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { SurfConfig } from '../config';
import type { WaveShape } from '../wave/WaveShape';
import { buildWaveGeometry, columnsX } from './waveGeometry';
import { createWaveMaterial, type WaveUniforms } from './waveMaterial';

/**
 * The rendered ocean: the breaking wave and the sea around it as one surface with one water
 * material (see buildWaveGeometry). Geometry is rebuilt only when shape parameters change
 * (`rebuild()`); per-frame work is the shader ripple, lip and foam.
 */
export class WaveMesh {
  readonly group = new Group();
  readonly ocean: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly uniforms: WaveUniforms;

  constructor(
    private readonly shape: WaveShape,
    private readonly mesh: SurfConfig['mesh'],
  ) {
    const { material, uniforms } = createWaveMaterial();
    this.uniforms = uniforms;
    this.ocean = new Mesh(new BufferGeometry(), material);
    this.ocean.frustumCulled = false;
    this.group.add(this.ocean);
    this.rebuild();
  }

  rebuild(): void {
    const { xMin, xMax } = this.shape.params;
    const xs = columnsX(this.mesh.columns, xMin, xMax);
    this.ocean.geometry.dispose();
    this.ocean.geometry = buildWaveGeometry(this.shape, xs, this.mesh.rows);
  }

  /** `time` = water clock (s), `travel` = frame distance along the reef (m); both freeze on pause. */
  update(time: number, travel: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uTravel.value = travel;
  }

  dispose(): void {
    this.ocean.geometry.dispose();
    this.ocean.material.dispose();
    this.uniforms.uFoamTex.value.dispose();
  }
}
