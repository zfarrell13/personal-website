import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorklets, copyVendor, workletBuildOptions } from './build-worklets';

describe('buildWorklets', () => {
  it('bundles each *.worklet.ts into a self-contained script', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-wk-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-wk-out-'));
    writeFileSync(join(src, 'helper.ts'), 'export const gain = (x: number): number => x * 0.5;\n');
    writeFileSync(
      join(src, 'demo.worklet.ts'),
      [
        "import { gain } from './helper';",
        'declare const registerProcessor: (n: string, c: unknown) => void;',
        "registerProcessor('demo', class { process() { return gain(2) > 0; } });",
      ].join('\n'),
    );
    writeFileSync(join(src, 'not-a-worklet.ts'), 'export {};\n');
    const files = await buildWorklets(src, out);
    expect(files).toEqual([join(out, 'demo.worklet.js')]);
    const js = readFileSync(files[0]!, 'utf8');
    expect(js).toContain('registerProcessor');
    expect(js).not.toMatch(/^\s*import\s/m);
    expect(js).not.toMatch(/^\s*export\s/m);
  });

  it('minifies without an inline sourcemap only for production builds', () => {
    expect(workletBuildOptions('x', 'y', true)).toMatchObject({ minify: true, sourcemap: false });
    expect(workletBuildOptions('x', 'y')).toMatchObject({ minify: false, sourcemap: 'inline' });
  });

  it('is a no-op when there are no worklets yet', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-wk-empty-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-wk-out-'));
    expect(await buildWorklets(src, out)).toEqual([]);
    expect(await buildWorklets(join(src, 'missing'), out)).toEqual([]);
  });
});

describe('copyVendor', () => {
  it('copies SignalsmithStretch.mjs into the vendor output dir', () => {
    const from = mkdtempSync(join(tmpdir(), 'zf-v-src-'));
    const out = join(mkdtempSync(join(tmpdir(), 'zf-v-out-')), 'vendor');
    writeFileSync(join(from, 'SignalsmithStretch.mjs'), 'export default 1;\n');
    const dst = copyVendor(join(from, 'SignalsmithStretch.mjs'), out);
    expect(dst).toBe(join(out, 'SignalsmithStretch.mjs'));
    expect(readFileSync(dst, 'utf8')).toBe('export default 1;\n');
  });
});
