import { build, context, type BuildOptions } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKLET_SRC = 'src/dj/engine/worklets';
export const WORKLET_OUT = 'public/worklets';
export const VENDOR_SRC = 'node_modules/signalsmith-stretch/SignalsmithStretch.mjs';
export const VENDOR_OUT = 'public/vendor';

/**
 * Turbopack breaks signalsmith-stretch's stringified worklet, so the package file is
 * served untouched from /vendor/SignalsmithStretch.mjs and loaded with turbopackIgnore.
 */
export function copyVendor(src = VENDOR_SRC, outDir = VENDOR_OUT): string {
  mkdirSync(outDir, { recursive: true });
  const dst = join(outDir, 'SignalsmithStretch.mjs');
  copyFileSync(src, dst);
  return dst;
}

/**
 * Bundles every `*.worklet.ts` into a standalone IIFE script for
 * `audioWorklet.addModule()` (worklets can't use the Next.js bundle).
 * Output: `<outDir>/<name>.worklet.js`. `production` (the `--production` flag, passed by
 * `prebuild`) minifies and drops the inline sourcemap; NODE_ENV isn't set during prebuild.
 */
export function workletBuildOptions(srcDir = WORKLET_SRC, outDir = WORKLET_OUT, production = false): BuildOptions {
  const entryPoints = (existsSync(srcDir) ? readdirSync(srcDir) : [])
    .filter((f) => f.endsWith('.worklet.ts'))
    .map((f) => join(srcDir, f));
  return {
    entryPoints,
    outdir: outDir,
    entryNames: '[name]',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: production,
    sourcemap: production ? false : 'inline',
    logLevel: 'warning',
  };
}

export async function buildWorklets(srcDir = WORKLET_SRC, outDir = WORKLET_OUT, production = false): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const options = workletBuildOptions(srcDir, outDir, production);
  if ((options.entryPoints as string[]).length === 0) return [];
  await build(options);
  return (options.entryPoints as string[]).map((e) => join(outDir, e.split('/').pop()!.replace(/\.ts$/, '.js')));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--watch')) {
    copyVendor();
    mkdirSync(WORKLET_OUT, { recursive: true });
    const ctx = await context(workletBuildOptions());
    await ctx.watch();
    console.log(`Watching ${WORKLET_SRC} → ${WORKLET_OUT}`);
  } else {
    copyVendor();
    const production = process.argv.includes('--production');
    const files = await buildWorklets(WORKLET_SRC, WORKLET_OUT, production);
    console.log(`Built ${files.length} ${production ? 'minified ' : ''}worklet(s) → ${WORKLET_OUT}`);
  }
}
