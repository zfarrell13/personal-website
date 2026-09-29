import * as THREE from 'three';
import { internalSize, levelsFromBits } from './retroMath';
import { retroUniforms } from './retroMaterial';
import { BLEND_FRAG, OUTPUT_FRAG, QUAD_VERT } from './shaders/post';

export interface RetroOptions {
  internalHeight: number;
  colorBits: [number, number, number];
  dither: number;
  trail: number;
  gammaLift: number;
  snapStrength: number;
}

export const DEFAULT_RETRO: RetroOptions = {
  internalHeight: 448,
  colorBits: [5, 6, 5],
  dither: 1,
  trail: 0.25,
  gammaLift: 1.05,
  snapStrength: 0.35,
};

/**
 * Renders a scene at ~448 lines into an offscreen target, blends it with the
 * previous frame (trail), then quantizes + dithers to the canvas with nearest
 * sampling. Canvas CSS should use `image-rendering: pixelated` (.retro-canvas).
 */
export class RetroRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly options: RetroOptions;
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly blendRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private flip = 0;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly blendMat: THREE.ShaderMaterial;
  private readonly outMat: THREE.ShaderMaterial;
  private internal = { width: 1, height: 1 };

  constructor(canvas: HTMLCanvasElement, options: Partial<RetroOptions> = {}) {
    this.options = { ...DEFAULT_RETRO, ...options };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    retroUniforms.uSnapStrength.value = this.options.snapStrength;

    const ext = this.renderer.extensions;
    const type =
      ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType;
    const makeTarget = (depth: boolean) =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type,
        depthBuffer: depth,
      });
    this.sceneRT = makeTarget(true);
    this.blendRT = [makeTarget(false), makeTarget(false)];

    this.blendMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tPrev: { value: null }, trail: { value: this.options.trail } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLEND_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const [lr, lg, lb] = levelsFromBits(this.options.colorBits);
    this.outMat = new THREE.ShaderMaterial({
      uniforms: {
        tBlend: { value: null },
        internalRes: { value: new THREE.Vector2(1, 1) },
        levels: { value: new THREE.Vector3(lr, lg, lb) },
        gammaLift: { value: this.options.gammaLift },
        ditherAmount: { value: this.options.dither },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: OUTPUT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blendMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(cssWidth: number, cssHeight: number): void {
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    this.renderer.setSize(w, h, false);
    this.internal = internalSize(w, h, this.options.internalHeight);
    const { width, height } = this.internal;
    this.sceneRT.setSize(width, height);
    this.blendRT[0].setSize(width, height);
    this.blendRT[1].setSize(width, height);
    (this.outMat.uniforms.internalRes!.value as THREE.Vector2).set(width, height);
    retroUniforms.uSnapRes.value.set(width, height);
  }

  get internalResolution(): { width: number; height: number } {
    return { ...this.internal };
  }

  setTrail(value: number): void {
    this.blendMat.uniforms.trail!.value = value;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const cur = this.blendRT[this.flip];
    const prev = this.blendRT[1 - this.flip]!;
    this.quad.material = this.blendMat;
    this.blendMat.uniforms.tScene!.value = this.sceneRT.texture;
    this.blendMat.uniforms.tPrev!.value = prev.texture;
    r.setRenderTarget(cur);
    r.render(this.quadScene, this.quadCam);

    this.quad.material = this.outMat;
    this.outMat.uniforms.tBlend!.value = cur.texture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    this.flip = 1 - this.flip;
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.blendRT[0].dispose();
    this.blendRT[1].dispose();
    this.blendMat.dispose();
    this.outMat.dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
  }
}
