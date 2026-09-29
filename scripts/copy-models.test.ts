import { Document, NodeIO } from '@gltf-transform/core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncModels } from './copy-models';

const quiet = () => {};

async function glbWithTexture(): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = doc.createTexture('logo').setImage(new Uint8Array([137, 80, 78, 71])).setMimeType('image/png');
  const mat = doc.createMaterial('body').setBaseColorTexture(tex).setBaseColorFactor([1, 0, 0, 1]);
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf);
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', pos);
  doc.createScene().addChild(doc.createNode('CDJ').setMesh(doc.createMesh().addPrimitive(prim)));
  return new NodeIO().writeBinary(doc);
}

describe('syncModels', () => {
  it('writes a null manifest when there is no model', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-m-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-m-out-'));
    expect(await syncModels(src, out, quiet)).toEqual({ booth: null });
    expect(JSON.parse(readFileSync(join(out, 'models.json'), 'utf8'))).toEqual({ booth: null });
  });

  it('publishes booth.glb with every texture stripped', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-m-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-m-out-'));
    writeFileSync(join(src, 'booth.glb'), await glbWithTexture());
    expect(await syncModels(src, out, quiet)).toEqual({ booth: '/models/booth.glb' });
    const doc = await new NodeIO().read(join(out, 'booth.glb'));
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listMaterials()[0]!.getBaseColorFactor()).toEqual([1, 0, 0, 1]);
  });

  it('falls back to procedural gear when the file is not a valid GLB', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-m-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-m-out-'));
    writeFileSync(join(src, 'booth.glb'), 'not a glb');
    expect(await syncModels(src, out, quiet)).toEqual({ booth: null });
  });

  it('keeps using an already-published stripped model when the source is absent', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-m-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-m-out-'));
    writeFileSync(join(out, 'booth.glb'), 'stripped');
    expect(await syncModels(src, out, quiet)).toEqual({ booth: '/models/booth.glb' });
  });
});
