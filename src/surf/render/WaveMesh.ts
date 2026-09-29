import { BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { retroMaterial } from '@/retro/retroMaterial';
import type { SurfConfig } from '../config';
import type { WaveShape } from '../wave/WaveShape';
import { buildBackGeometry, buildWaveGeometry, columnsX } from './waveGeometry';
import { createWaveMaterial, type WaveUniforms } from './waveMaterial';

/**
 * The rendered wave: front surface + back. Geometry is rebuilt only when shape
 * parameters change (`rebuild()`); per-frame work is the shader ripple/foam.
 */
export class WaveMesh {
  readonly group = new Group();
  readonly front: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly back: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly uniforms: WaveUniforms;

  constructor(
    private readonly shape: WaveShape,
    private readonly mesh: SurfConfig['mesh'],
  ) {
    const { material, uniforms } = createWaveMaterial(shape.params.peelSpeed);
    this.uniforms = uniforms;
    this.front = new Mesh(new BufferGeometry(), material);
    this.back = new Mesh(new BufferGeometry(), retroMaterial(new MeshLambertMaterial({ vertexColors: true })));
    this.front.frustumCulled = false;
    this.back.frustumCulled = false;
    this.group.add(this.back, this.front);
    this.rebuild();
  }

  rebuild(): void {
    const { xMin, xMax } = this.shape.params;
    const xs = columnsX(this.mesh.columns, xMin, xMax);
    this.front.geometry.dispose();
    this.back.geometry.dispose();
    this.front.geometry = buildWaveGeometry(this.shape, xs, this.mesh.rows);
    this.back.geometry = buildBackGeometry(this.shape, xs);
    this.uniforms.uPeel.value = this.shape.params.peelSpeed;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.front.geometry.dispose();
    this.back.geometry.dispose();
    this.front.material.dispose();
    this.back.material.dispose();
    this.uniforms.uFoamTex.value.dispose();
  }
}
