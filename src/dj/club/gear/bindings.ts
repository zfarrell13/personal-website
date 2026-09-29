import * as THREE from 'three';
import type { EngineTelemetry } from '../../engine/telemetry';
import type { DjData } from '../../store/djStore';
import { valueToAngle } from '../../ui/controls/knobMath';

/** true/false = on/off colour; a string = light in that colour (hot cue pads). */
export type LedRead = (s: DjData, t: EngineTelemetry) => boolean | string;

export type GearBinding =
  | { kind: 'knob'; object: THREE.Object3D; min: number; max: number; read: (s: DjData) => number }
  | { kind: 'fader'; object: THREE.Object3D; axis: 'x' | 'z'; from: number; to: number; min: number; max: number; read: (s: DjData) => number }
  | { kind: 'led'; material: THREE.MeshBasicMaterial; on: THREE.Color; off: THREE.Color; read: LedRead; /** Last applied value; the colour is only touched on change. */ last?: boolean | string };

/** Moves knob/fader meshes and LEDs of the 3D gear to match the store (called every frame in room view). No allocation. */
export function applyBindings(bindings: readonly GearBinding[], s: DjData, t: EngineTelemetry): void {
  for (const b of bindings) {
    if (b.kind === 'knob') {
      b.object.rotation.y = (-valueToAngle(b.read(s), b) * Math.PI) / 180;
    } else if (b.kind === 'fader') {
      const f = (Math.min(b.max, Math.max(b.min, b.read(s))) - b.min) / (b.max - b.min);
      b.object.position[b.axis] = b.from + (b.to - b.from) * f;
    } else {
      const v = b.read(s, t);
      if (v === b.last) continue;
      b.last = v;
      if (typeof v === 'string') b.material.color.set(v);
      else b.material.color.copy(v ? b.on : b.off);
    }
  }
}
