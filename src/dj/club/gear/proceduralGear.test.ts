import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createTelemetry } from '../../engine/telemetry';
import { initialDjData } from '../../store/djStore';
import { applyBindings } from './bindings';
import { BEZEL_TOP, buildProceduralGear, markTexturesDirty } from './proceduralGear';
import { CDJ_SIZE, TABLE_Y } from './layout';

const canvas = () => ({ width: 4, height: 4 }) as unknown as HTMLCanvasElement;
const canvases = [
  { screen: canvas(), jog: canvas() },
  { screen: canvas(), jog: canvas() },
];

describe('procedural gear', () => {
  it('builds two CDJs, a mixer and bindings for every mirrored control', () => {
    const g = buildProceduralGear(canvases);
    expect(g.group.getObjectByName('cdj-0')).toBeTruthy();
    expect(g.group.getObjectByName('cdj-1')).toBeTruthy();
    expect(g.group.getObjectByName('djm')).toBeTruthy();
    expect(g.group.getObjectByName('screen-1')).toBeTruthy();
    expect(g.textures).toHaveLength(4);
    const kinds = g.bindings.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.kind]: (acc[b.kind] ?? 0) + 1 }), {});
    // knobs: 5 per channel × 2 + depth + master; faders: 2 tempo + 2 channel + crossfader; leds: (play, cue, 8 pads) × 2
    expect(kinds).toEqual({ fader: 5, led: 20, knob: 12 });
  });

  it('follows the store: crossfader cap moves, knobs rotate, pads light', () => {
    const g = buildProceduralGear(canvases);
    const s = initialDjData();
    const t = createTelemetry();
    const xf = g.bindings.find((b) => b.kind === 'fader' && b.axis === 'x')!;
    s.mixer.crossfader = 0;
    applyBindings(g.bindings, s, t);
    const left = (xf as { object: { position: { x: number } } }).object.position.x;
    s.mixer.crossfader = 1;
    applyBindings(g.bindings, s, t);
    expect((xf as { object: { position: { x: number } } }).object.position.x).toBeGreaterThan(left);

    const trim = g.bindings.find((b) => b.kind === 'knob')!;
    s.mixer.ch[0].trim = 1;
    applyBindings(g.bindings, s, t);
    expect((trim as { object: { rotation: { y: number } } }).object.rotation.y).toBeCloseTo((-135 * Math.PI) / 180, 6);

    s.decks[0].hotCues[0] = { sec: 1, color: '#28e214' };
    applyBindings(g.bindings, s, t);
    const pad = g.bindings.filter((b) => b.kind === 'led')[2]!;
    expect((pad as { material: { color: { getHexString(): string } } }).material.color.getHexString()).toBe('28e214');
  });

  it('keeps draw calls modest, uses SRGB textures and flags them only when asked', () => {
    const g = buildProceduralGear(canvases);
    let meshes = 0;
    g.group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeLessThan(80);
    expect(g.textures.every((t) => t.colorSpace === THREE.SRGBColorSpace)).toBe(true);
    const v = g.textures[0]!.version;
    markTexturesDirty(g.textures);
    expect(g.textures[0]!.version).toBe(v + 1);
  });

  it('disposes textures, geometries and materials', () => {
    const g = buildProceduralGear(canvases);
    const texSpy = vi.spyOn(g.textures[0]!, 'dispose');
    const geo = (g.group.getObjectByName('djm') as THREE.Mesh).geometry;
    const geoSpy = vi.spyOn(geo, 'dispose');
    const mat = (g.group.getObjectByName('djm') as THREE.Mesh).material as THREE.Material;
    const matSpy = vi.spyOn(mat, 'dispose');
    const screenMat = (g.group.getObjectByName('screen-0') as THREE.Mesh).material as THREE.Material;
    const screenMatSpy = vi.spyOn(screenMat, 'dispose');
    g.dispose();
    expect(matSpy).toHaveBeenCalled();
    expect(screenMatSpy).toHaveBeenCalled();
    expect(texSpy).toHaveBeenCalled();
    expect(geoSpy).toHaveBeenCalled();
  });

  it('lays display planes above the static surfaces beneath them (no occlusion)', () => {
    const g = buildProceduralGear(canvases);
    const topY = TABLE_Y + CDJ_SIZE.h;
    for (const deck of [0, 1]) {
      const screen = g.group.getObjectByName(`screen-${deck}`)!;
      expect(screen.position.y - topY).toBeGreaterThan(BEZEL_TOP);
      // jog display sits on the platter (top = topY + 0.001 + 0.012)
      expect(g.group.getObjectByName(`jog-${deck}`)!.position.y - topY).toBeGreaterThan(0.013);
    }
  });
});
