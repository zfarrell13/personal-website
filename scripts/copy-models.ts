import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODELS_SRC = 'content/models';
export const MODELS_OUT = 'public/models';

export interface ModelsManifest {
  booth: string | null;
}

/**
 * Publishes the optional CC-BY booth model: content/models/booth.glb → public/models/booth.glb
 * with EVERY texture removed (logos live in textures, so none are ever served). Without a
 * source file, an existing (already stripped) public/models/booth.glb is used as-is.
 * Always writes public/models/models.json so the client never requests a missing file.
 */
export async function syncModels(srcDir = MODELS_SRC, outDir = MODELS_OUT, log: (m: string) => void = console.log): Promise<ModelsManifest> {
  mkdirSync(outDir, { recursive: true });
  const src = join(srcDir, 'booth.glb');
  const dst = join(outDir, 'booth.glb');
  let booth: string | null = null;
  if (existsSync(src)) {
    try {
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
        const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
        const doc = await io.read(src);
        const textures = doc.getRoot().listTextures();
        for (const t of textures) t.dispose();
        await io.write(dst, doc);
        log(`Booth model: stripped ${textures.length} texture(s) → ${dst}`);
      }
      booth = '/models/booth.glb';
    } catch (err) {
      log(`Booth model could not be processed (${String(err)}); the club uses procedural gear.`);
    }
  } else if (existsSync(dst)) {
    booth = '/models/booth.glb'; // an already-stripped copy committed for deployment
  }
  const manifest: ModelsManifest = { booth };
  writeFileSync(join(outDir, 'models.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const m = await syncModels();
  if (!m.booth) console.log('No usable content/models/booth.glb — the club uses procedural gear.');
}
