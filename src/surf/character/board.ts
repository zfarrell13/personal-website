import { BufferAttribute, BufferGeometry, CanvasTexture, Mesh, MeshLambertMaterial, TextureLoader, type Texture } from 'three';
import { retroMaterial, retroTexture } from '@/retro/retroMaterial';
import type { SurferLook } from '../config';

export const BOARD = { length: 1.9, width: 0.52, thickness: 0.07 } as const;
const ALONG = 16;
const ACROSS = 6;

/** Half-width of the outline at u ∈ [0, 1] (tail → nose): squash tail, pointed nose. */
export function boardHalfWidth(u: number): number {
  const s = Math.sin(Math.PI * Math.min(1, Math.max(0, 0.08 + 0.9 * u)));
  return (BOARD.width / 2) * Math.pow(s, 0.55);
}

/** Rocker: height of the bottom at u (nose kicks up more than the tail). */
export function boardRocker(u: number): number {
  return 0.18 * Math.max(0, u - 0.6) ** 2 / 0.16 + 0.04 * Math.max(0, 0.25 - u) ** 2 / 0.0625;
}

/**
 * Low-poly board along +z (nose), deck up. Group 0 = deck (textured, uv 0–1),
 * group 1 = bottom + rails. Bottom sits at y = rocker(u); deck at + thickness.
 */
export function buildBoardGeometry(): BufferGeometry {
  const verts: number[] = [];
  const uvs: number[] = [];
  const idxDeck: number[] = [];
  const idxRest: number[] = [];
  const ring = (u: number, a: number, top: boolean) => {
    const hw = boardHalfWidth(u);
    const x = (a * 2 - 1) * hw;
    const edge = Math.abs(a * 2 - 1);
    const y = boardRocker(u) + (top ? BOARD.thickness * (1 - 0.5 * edge * edge) : 0.01 * edge);
    verts.push(x, y, (u - 0.5) * BOARD.length);
    uvs.push(a, u);
  };
  for (const top of [true, false]) {
    for (let i = 0; i <= ALONG; i++) for (let j = 0; j <= ACROSS; j++) ring(i / ALONG, j / ACROSS, top);
  }
  const W = ACROSS + 1;
  const topBase = 0;
  const botBase = (ALONG + 1) * W;
  for (let i = 0; i < ALONG; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * W + j;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idxDeck.push(topBase + a, topBase + c, topBase + b, topBase + b, topBase + c, topBase + d);
      idxRest.push(botBase + a, botBase + b, botBase + c, botBase + b, botBase + d, botBase + c);
    }
    // rails: connect top and bottom outer edges
    for (const j of [0, ACROSS]) {
      const t0 = topBase + i * W + j;
      const t1 = t0 + W;
      const b0 = botBase + i * W + j;
      const b1 = b0 + W;
      if (j === 0) idxRest.push(t0, b0, t1, t1, b0, b1);
      else idxRest.push(t0, t1, b0, t1, b1, b0);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex([...idxDeck, ...idxRest]);
  geo.addGroup(0, idxDeck.length, 0);
  geo.addGroup(idxDeck.length, idxRest.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** 128×256 deck graphic: stripe + big italic text (or the user's image). */
export function makeDeckTexture(look: SurferLook): Texture {
  if (look.boardImage) return retroTexture(new TextureLoader().load(look.boardImage));
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = look.boardDeck;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = look.boardStripe;
  g.fillRect(58, 0, 12, 256);
  g.fillRect(0, 196, 128, 10);
  g.save();
  g.translate(64, 110);
  g.rotate(-Math.PI / 2);
  g.font = 'italic bold 56px "Russo One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#0a1a5c';
  g.strokeText(look.boardText, 0, 0);
  g.fillStyle = '#ffe16b';
  g.fillText(look.boardText, 0, 0);
  g.restore();
  return retroTexture(new CanvasTexture(canvas));
}

export function buildBoard(look: SurferLook, deck: Texture | null): Mesh {
  const deckMat = retroMaterial(new MeshLambertMaterial(deck ? { map: deck } : { color: look.boardDeck }));
  const restMat = retroMaterial(new MeshLambertMaterial({ color: look.boardBottom }));
  return new Mesh(buildBoardGeometry(), [deckMat, restMat]);
}
