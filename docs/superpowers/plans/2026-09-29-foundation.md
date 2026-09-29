# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Next 12 site with a fresh Next.js 16 app containing the light/dark portal, the shared PS2 renderer, UI primitives, the input action layer, and the track pipeline that both experiences consume.

**Architecture:** Next.js App Router shell; experiences are client-only dynamic imports. Shared engine code is plain TypeScript under `src/retro`, `src/shared` and has no React dependency (except explicitly React files `*.tsx` and `useMode.ts`). A Node pipeline (`scripts/`) turns WAV masters into AAC + binary waveform data under `public/tracks/`.

**Tech Stack:** Next.js 16.3, React 19.3, TypeScript 5.9 (strict), three.js 0.186, zustand 5, Vitest 5 (+ jsdom, Testing Library), Playwright 1.63, tsx, system ffmpeg.

**Spec:** `docs/superpowers/specs/2026-09-29-foundation-design.md`

## Global Constraints

- Node 22+, npm. `ffmpeg`/`ffprobe` on PATH (present at `/opt/homebrew/bin/ffmpeg`).
- TypeScript `strict: true`. No `any` in exported signatures.
- React StrictMode is on: every effect must fully clean up (dev mounts effects twice).
- Engine modules (`src/retro/*.ts`, `src/shared/*.ts` except `useMode.ts`) must not import React.
- Mode values are exactly `'light' | 'dark'`; storage key exactly `zf-mode`; routes exactly light → `/surf`, dark → `/dj`.
- PS2 renderer internal height default **448**; vertex snap strength default **0.35**; color bits **[5,6,5]**; trail **0.25**.
- Fonts: Russo One (`--font-display`), VT323 (`--font-mono`) via `next/font/google`.
- Waveform bins: **150 bins/sec** detail, **1024 bins** overview, bands low < 250 Hz, mid 250 Hz–3 kHz, high > 3 kHz.
- No Pioneer logos or trademarks anywhere in assets or UI.
- Generated output (`public/tracks/`, `content/tracks-test/`) and audio masters are git-ignored.
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Scaffold the app + mode module

**Files:**
- Delete: `src/` (entire old tree), `public/images/`, `.next/`, `node_modules/`, `package-lock.json`, `next.config.js`, `next-env.d.ts`, `tsconfig.json`, `README.md`, `.DS_Store`
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (temporary), `src/shared/mode.ts`, `src/shared/useMode.ts`
- Modify: `.gitignore`
- Test: `src/shared/mode.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = 'light' | 'dark'`
  - `MODE_STORAGE_KEY = 'zf-mode'`
  - `MODE_ROUTES: Record<Mode, '/surf' | '/dj'>`
  - `readMode(storage: Pick<Storage,'getItem'> | null, prefersDark: boolean): Mode`
  - `writeMode(storage: Pick<Storage,'setItem'> | null, mode: Mode): void`
  - `otherMode(mode: Mode): Mode`
  - `browserStorage(): Storage | null`
  - `systemPrefersDark(): boolean`
  - `useMode(): { mode: Mode | null; setMode(m: Mode): void }` (null until hydrated)

- [ ] **Step 1: Remove the old site**

```bash
cd /Users/zachfarrell/Desktop/Coding_Projects/personal_website
rm -rf src public/images .next node_modules package-lock.json next.config.js next-env.d.ts tsconfig.json README.md .DS_Store
ls -la   # expect: .git .gitignore docs public (maybe empty public/fonts)
rm -rf public/fonts
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "zf-personal-website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "next": "16.3.7",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "three": "^0.186.1",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^22.10.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@types/three": "^0.186.0",
    "jsdom": "^30.1.1",
    "tsx": "^4.23.15",
    "typescript": "^5.9.3",
    "vite": "^8.0.0",
    "vitest": "^5.0.2"
  }
}
```

Run: `npm install`
Expected: completes without ERESOLVE errors. If `vite@^8` doesn't resolve, use the highest major vitest's peer range accepts (`^7.0.0`).

- [ ] **Step 3: Write configs**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.gitignore` (replace contents):
```
node_modules/
.next/
out/
.DS_Store
*.tsbuildinfo
next-env.d.ts
public/tracks/
content/tracks-test/
content/tracks/*.wav
content/tracks/*.aif
content/tracks/*.aiff
content/tracks/*.flac
content/tracks/*.mp3
test-results/
playwright-report/
.env*
```

- [ ] **Step 4: Write the failing mode tests** — `src/shared/mode.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { MODE_ROUTES, MODE_STORAGE_KEY, otherMode, readMode, writeMode } from './mode';

const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
};

describe('mode', () => {
  it('uses the stored value when valid', () => {
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'dark' }), false)).toBe('dark');
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'light' }), true)).toBe('light');
  });
  it('falls back to the system preference', () => {
    expect(readMode(memory(), true)).toBe('dark');
    expect(readMode(memory(), false)).toBe('light');
    expect(readMode(memory({ [MODE_STORAGE_KEY]: 'purple' }), true)).toBe('dark');
    expect(readMode(null, false)).toBe('light');
  });
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readMode(broken, true)).toBe('dark');
    expect(() => writeMode(broken, 'dark')).not.toThrow();
  });
  it('writes the mode', () => {
    const m = memory();
    writeMode(m, 'dark');
    expect(m.data[MODE_STORAGE_KEY]).toBe('dark');
  });
  it('maps modes to routes and flips', () => {
    expect(MODE_ROUTES).toEqual({ light: '/surf', dark: '/dj' });
    expect(otherMode('light')).toBe('dark');
    expect(otherMode('dark')).toBe('light');
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/shared/mode.test.ts`
Expected: FAIL — cannot resolve `./mode`.

- [ ] **Step 6: Implement** — `src/shared/mode.ts`

```ts
export type Mode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'zf-mode';

export const MODE_ROUTES: Record<Mode, '/surf' | '/dj'> = { light: '/surf', dark: '/dj' };

export function readMode(storage: Pick<Storage, 'getItem'> | null, prefersDark: boolean): Mode {
  try {
    const stored = storage?.getItem(MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // storage blocked (private mode, sandboxed iframe) — fall through
  }
  return prefersDark ? 'dark' : 'light';
}

export function writeMode(storage: Pick<Storage, 'setItem'> | null, mode: Mode): void {
  try {
    storage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // non-fatal: mode just won't persist
  }
}

export const otherMode = (mode: Mode): Mode => (mode === 'light' ? 'dark' : 'light');

export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}
```

`src/shared/useMode.ts`:
```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { browserStorage, readMode, systemPrefersDark, writeMode, type Mode } from './mode';

/** Mode is null until hydrated on the client, to avoid SSR mismatches. */
export function useMode(): { mode: Mode | null; setMode: (m: Mode) => void } {
  const [mode, setModeState] = useState<Mode | null>(null);
  useEffect(() => {
    setModeState(readMode(browserStorage(), systemPrefersDark()));
  }, []);
  const setMode = useCallback((m: Mode) => {
    writeMode(browserStorage(), m);
    setModeState(m);
  }, []);
  return { mode, setMode };
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/shared/mode.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: App shell**

`src/app/globals.css`:
```css
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: #05060f;
  color: #e8ecff;
  font-family: var(--font-display), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
button { font: inherit; color: inherit; }
.retro-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  image-rendering: pixelated;
  touch-action: none;
}
```

`src/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from 'next';
import { Russo_One, VT323 } from 'next/font/google';
import './globals.css';

const display = Russo_One({ weight: '400', subsets: ['latin'], variable: '--font-display' });
const mono = VT323({ weight: '400', subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Zach Farrell',
  description: 'Surf by day. DJ by night.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#05060f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (temporary, replaced in Task 5):
```tsx
export default function Home() {
  return <main style={{ padding: 32 }}>ZF — scaffold</main>;
}
```

- [ ] **Step 9: Verify build + typecheck**

Run: `npm run typecheck && npm run build`
Expected: both succeed; build lists route `/`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: replace old site with Next.js 16 scaffold and mode module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Input action layer

**Files:**
- Create: `src/shared/input/ActionState.ts`
- Test: `src/shared/input/ActionState.test.ts`

**Interfaces:**
- Produces:
  - `type Bindings<A extends string> = Record<A, readonly string[]>` — values are `KeyboardEvent.code` strings (e.g. `'ArrowLeft'`, `'KeyW'`, `'Space'`)
  - `class ActionState<A extends string>` with `constructor(bindings: Bindings<A>)`, `press(action: A, source?: string): void`, `release(action: A, source?: string): void`, `keyDown(code: string): boolean`, `keyUp(code: string): boolean`, `tick(): void`, `isDown(a: A): boolean`, `pressedThisFrame(a: A): boolean`, `releasedThisFrame(a: A): boolean`, `reset(): void`, `attach(target?: Window): () => void`
  - Semantics: call `tick()` exactly once per simulation step *before* reading. A press+release between two ticks still reports `pressedThisFrame` (and `isDown`) for one tick. Touch controls call `press/release` with their own source id.

- [ ] **Step 1: Write the failing tests** — `src/shared/input/ActionState.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ActionState } from './ActionState';

type A = 'left' | 'right' | 'jump';
const make = () => new ActionState<A>({ left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight'], jump: ['Space'] });

describe('ActionState', () => {
  it('maps keys to actions and reports edges once', () => {
    const s = make();
    expect(s.keyDown('ArrowLeft')).toBe(true);
    s.tick();
    expect(s.isDown('left')).toBe(true);
    expect(s.pressedThisFrame('left')).toBe(true);
    s.tick();
    expect(s.isDown('left')).toBe(true);
    expect(s.pressedThisFrame('left')).toBe(false);
    s.keyUp('ArrowLeft');
    s.tick();
    expect(s.isDown('left')).toBe(false);
    expect(s.releasedThisFrame('left')).toBe(true);
    s.tick();
    expect(s.releasedThisFrame('left')).toBe(false);
  });

  it('ignores unknown keys', () => {
    const s = make();
    expect(s.keyDown('KeyZ')).toBe(false);
  });

  it('keeps an action down while any source holds it', () => {
    const s = make();
    s.keyDown('ArrowLeft');
    s.keyDown('KeyA');
    s.keyUp('ArrowLeft');
    s.tick();
    expect(s.isDown('left')).toBe(true);
    s.keyUp('KeyA');
    s.tick();
    expect(s.isDown('left')).toBe(false);
  });

  it('does not lose a tap that happens between ticks', () => {
    const s = make();
    s.tick();
    s.keyDown('Space');
    s.keyUp('Space');
    s.tick();
    expect(s.pressedThisFrame('jump')).toBe(true);
    expect(s.isDown('jump')).toBe(true);
    s.tick();
    expect(s.pressedThisFrame('jump')).toBe(false);
    expect(s.isDown('jump')).toBe(false);
  });

  it('supports virtual (touch) sources alongside keys', () => {
    const s = make();
    s.press('right', 'touch:1');
    s.keyDown('ArrowRight');
    s.release('right', 'touch:1');
    s.tick();
    expect(s.isDown('right')).toBe(true);
  });

  it('repeated keyDown from the same key does not double count', () => {
    const s = make();
    s.keyDown('ArrowRight');
    s.keyDown('ArrowRight');
    s.keyUp('ArrowRight');
    s.tick();
    expect(s.isDown('right')).toBe(false);
  });

  it('reset releases everything', () => {
    const s = make();
    s.keyDown('ArrowLeft');
    s.tick();
    s.reset();
    s.tick();
    expect(s.isDown('left')).toBe(false);
    expect(s.releasedThisFrame('left')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/input`
Expected: FAIL — cannot resolve `./ActionState`.

- [ ] **Step 3: Implement** — `src/shared/input/ActionState.ts`

```ts
export type Bindings<A extends string> = Record<A, readonly string[]>;

/**
 * Named-action input. Games read actions, never raw keys, so keyboard, touch
 * and (later) gamepad all feed the same state. Call tick() once per sim step.
 */
export class ActionState<A extends string> {
  private readonly keyToActions = new Map<string, A[]>();
  private readonly sources = new Map<A, Set<string>>();
  private readonly pendingPress = new Set<A>();
  private readonly pendingRelease = new Set<A>();
  private prev = new Set<A>();
  private cur = new Set<A>();
  private pressedNow = new Set<A>();
  private releasedNow = new Set<A>();

  constructor(bindings: Bindings<A>) {
    for (const action of Object.keys(bindings) as A[]) {
      this.sources.set(action, new Set());
      for (const code of bindings[action]) {
        const list = this.keyToActions.get(code) ?? [];
        list.push(action);
        this.keyToActions.set(code, list);
      }
    }
  }

  press(action: A, source = 'virtual'): void {
    const held = this.sources.get(action);
    if (!held || held.has(source)) return;
    if (held.size === 0) this.pendingPress.add(action);
    held.add(source);
  }

  release(action: A, source = 'virtual'): void {
    const held = this.sources.get(action);
    if (!held || !held.delete(source)) return;
    if (held.size === 0) this.pendingRelease.add(action);
  }

  keyDown(code: string): boolean {
    const actions = this.keyToActions.get(code);
    if (!actions) return false;
    for (const a of actions) this.press(a, `key:${code}`);
    return true;
  }

  keyUp(code: string): boolean {
    const actions = this.keyToActions.get(code);
    if (!actions) return false;
    for (const a of actions) this.release(a, `key:${code}`);
    return true;
  }

  tick(): void {
    this.prev = this.cur;
    this.cur = new Set();
    for (const [a, held] of this.sources) if (held.size > 0) this.cur.add(a);
    this.pressedNow = new Set(this.pendingPress);
    for (const a of this.cur) if (!this.prev.has(a)) this.pressedNow.add(a);
    this.releasedNow = new Set(this.pendingRelease);
    for (const a of this.prev) if (!this.cur.has(a)) this.releasedNow.add(a);
    this.pendingPress.clear();
    this.pendingRelease.clear();
  }

  isDown(a: A): boolean {
    return this.cur.has(a) || this.pressedNow.has(a);
  }

  pressedThisFrame(a: A): boolean {
    return this.pressedNow.has(a);
  }

  releasedThisFrame(a: A): boolean {
    return this.releasedNow.has(a);
  }

  reset(): void {
    for (const [a, held] of this.sources) {
      if (held.size > 0) this.pendingRelease.add(a);
      held.clear();
    }
  }

  attach(target: Window = window): () => void {
    const down = (e: KeyboardEvent) => {
      if (!this.keyToActions.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) this.keyDown(e.code);
    };
    const up = (e: KeyboardEvent) => {
      if (this.keyUp(e.code)) e.preventDefault();
    };
    const blur = () => this.reset();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/input`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/input
git commit -m "feat(shared): named-action input layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: PS2 renderer

**Files:**
- Create: `src/retro/retroMath.ts`, `src/retro/shaders/post.ts`, `src/retro/retroMaterial.ts`, `src/retro/RetroRenderer.ts`, `src/retro/dev/RetroDemo.tsx`, `src/app/dev/retro/page.tsx`, `src/app/dev/retro/RetroDemoLoader.tsx`
- Test: `src/retro/retroMath.test.ts`, `src/retro/retroMaterial.test.ts`

**Interfaces:**
- Produces:
  - `internalSize(viewW: number, viewH: number, internalHeight: number): { width: number; height: number }`
  - `bayer4(x: number, y: number): number` (TS mirror of the GLSL, values k/16)
  - `levelsFromBits(bits: readonly [number, number, number]): [number, number, number]`
  - `interface RetroOptions { internalHeight: number; colorBits: [number, number, number]; dither: number; trail: number; gammaLift: number; snapStrength: number }`, `DEFAULT_RETRO: RetroOptions`
  - `class RetroRenderer { readonly renderer: THREE.WebGLRenderer; readonly options: RetroOptions; constructor(canvas: HTMLCanvasElement, options?: Partial<RetroOptions>); setSize(cssWidth: number, cssHeight: number): void; get internalResolution(): { width: number; height: number }; setTrail(v: number): void; render(scene: THREE.Scene, camera: THREE.Camera): void; dispose(): void }`
  - `retroUniforms: { uSnapRes: { value: THREE.Vector2 }; uSnapStrength: { value: number } }`
  - `retroMaterial<M extends THREE.Material>(m: M, opts?: { snap?: boolean }): M`
  - `retroTexture<T extends THREE.Texture>(t: T): T`
  - Dev page `/dev/retro` sets `window.__retroFrames` (incrementing frame counter) for e2e tests.
  - Canvas convention: experiences render into `<canvas className="retro-canvas">` and call `setSize(canvas.clientWidth, canvas.clientHeight)` from a `ResizeObserver`.

- [ ] **Step 1: Write failing math tests** — `src/retro/retroMath.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { bayer4, internalSize, levelsFromBits } from './retroMath';

describe('internalSize', () => {
  it('keeps 448 lines and the viewport aspect', () => {
    expect(internalSize(1920, 1080, 448)).toEqual({ width: 796, height: 448 });
    expect(internalSize(1440, 900, 448)).toEqual({ width: 717, height: 448 });
  });
  it('never renders above the viewport size', () => {
    expect(internalSize(300, 200, 448)).toEqual({ width: 300, height: 200 });
  });
  it('is safe for zero sizes', () => {
    expect(internalSize(0, 0, 448)).toEqual({ width: 1, height: 1 });
  });
});

describe('bayer4', () => {
  it('produces each of the 16 thresholds exactly once per 4x4 tile', () => {
    const values: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) values.push(bayer4(x, y) * 16);
    expect(values.map((v) => Math.round(v)).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });
  it('tiles with period 4', () => {
    expect(bayer4(5, 6)).toBeCloseTo(bayer4(1, 2));
  });
});

describe('levelsFromBits', () => {
  it('converts bit depths to max levels', () => {
    expect(levelsFromBits([5, 6, 5])).toEqual([31, 63, 31]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/retro/retroMath.test.ts`
Expected: FAIL — cannot resolve `./retroMath`.

- [ ] **Step 3: Implement** — `src/retro/retroMath.ts`

```ts
export function internalSize(viewW: number, viewH: number, internalHeight: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(viewW));
  const h = Math.max(1, Math.round(viewH));
  const height = Math.min(internalHeight, h);
  const width = Math.max(1, Math.round(height * (w / h)));
  return { width, height };
}

const fract = (v: number) => v - Math.floor(v);

function bayer2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return fract(fx * 0.5 + fy * fy * 0.75);
}

/** Ordered-dither threshold in [0, 1). Mirrors `bayer4` in shaders/post.ts exactly. */
export function bayer4(x: number, y: number): number {
  return bayer2(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y);
}

export function levelsFromBits(bits: readonly [number, number, number]): [number, number, number] {
  return [2 ** bits[0] - 1, 2 ** bits[1] - 1, 2 ** bits[2] - 1];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/retro/retroMath.test.ts` → PASS.

- [ ] **Step 5: Shaders** — `src/retro/shaders/post.ts`

```ts
export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Pass A (internal res): blend the new frame with the previous blend — the PS2 "trail". */
export const BLEND_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform float trail;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tScene, vUv).rgb;
  vec3 p = texture2D(tPrev, vUv).rgb;
  gl_FragColor = vec4(mix(s, p, trail), 1.0);
}
`;

/** Pass B (screen): chunky pixels, gamma, ordered dither, RGB565-style quantization. */
export const OUTPUT_FRAG = /* glsl */ `
uniform sampler2D tBlend;
uniform vec2 internalRes;
uniform vec3 levels;
uniform float gammaLift;
uniform float ditherAmount;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 px = floor(vUv * internalRes);
  vec2 uv = (px + 0.5) / internalRes;
  vec3 c = texture2D(tBlend, uv).rgb;
  c = pow(max(c, vec3(0.0)), vec3(1.0 / (2.2 * gammaLift)));
  float d = (bayer4(px) - 0.5) * ditherAmount;
  c = floor(c * levels + d + 0.5) / levels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
```

- [ ] **Step 6: Write failing material test** — `src/retro/retroMaterial.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { retroMaterial, retroTexture, retroUniforms } from './retroMaterial';

describe('retroMaterial', () => {
  it('injects vertex snapping after project_vertex and shares uniforms', () => {
    const m = retroMaterial(new THREE.MeshLambertMaterial());
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: 'void main() {\n#include <project_vertex>\n}',
      fragmentShader: '',
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('uniform vec2 uSnapRes;');
    expect(shader.vertexShader.indexOf('uSnapStrength)')).toBeGreaterThan(shader.vertexShader.indexOf('#include <project_vertex>'));
    expect(shader.uniforms.uSnapRes).toBe(retroUniforms.uSnapRes);
    expect(m.customProgramCacheKey()).toBe('retro-snap');
  });
  it('can opt out of snapping', () => {
    const base = new THREE.MeshBasicMaterial();
    const before = base.onBeforeCompile;
    expect(retroMaterial(base, { snap: false }).onBeforeCompile).toBe(before);
  });
  it('makes textures nearest-filtered without mipmaps', () => {
    const t = retroTexture(new THREE.Texture());
    expect(t.magFilter).toBe(THREE.NearestFilter);
    expect(t.minFilter).toBe(THREE.NearestFilter);
    expect(t.generateMipmaps).toBe(false);
  });
});
```

Run: `npx vitest run src/retro/retroMaterial.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement** — `src/retro/retroMaterial.ts`

```ts
import * as THREE from 'three';

export const retroUniforms = {
  uSnapRes: { value: new THREE.Vector2(640, 448) },
  uSnapStrength: { value: 0.35 },
};

const SNAP_GLSL = /* glsl */ `
{
  vec4 sp = gl_Position;
  vec2 ndc = sp.xy / sp.w;
  vec2 grid = uSnapRes * 0.5;
  vec2 snapped = floor(ndc * grid + 0.5) / grid;
  sp.xy = mix(ndc, snapped, uSnapStrength) * sp.w;
  gl_Position = sp;
}
`;

/** Adds PS2-style vertex snapping to any built-in material. Fog/lighting stay three.js-native. */
export function retroMaterial<M extends THREE.Material>(material: M, opts: { snap?: boolean } = {}): M {
  if (opts.snap === false) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = retroUniforms.uSnapRes;
    shader.uniforms.uSnapStrength = retroUniforms.uSnapStrength;
    shader.vertexShader =
      'uniform vec2 uSnapRes;\nuniform float uSnapStrength;\n' +
      shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${SNAP_GLSL}`);
  };
  material.customProgramCacheKey = () => 'retro-snap';
  return material;
}

export function retroTexture<T extends THREE.Texture>(texture: T): T {
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
```

Run: `npx vitest run src/retro` → PASS.

- [ ] **Step 8: Implement** — `src/retro/RetroRenderer.ts`

```ts
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
```

- [ ] **Step 9: Demo page** — `src/retro/dev/RetroDemo.tsx`

```tsx
'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RetroRenderer } from '@/retro/RetroRenderer';
import { retroMaterial } from '@/retro/retroMaterial';

declare global {
  interface Window {
    __retroFrames?: number;
  }
}

export default function RetroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const retro = new RetroRenderer(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b2a6b');
    scene.fog = new THREE.Fog('#1b2a6b', 6, 22);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 1.5, 7);
    scene.add(new THREE.HemisphereLight('#bcd4ff', '#3b2a1a', 1.2));
    const sun = new THREE.DirectionalLight('#ffe2b0', 2);
    sun.position.set(3, 5, 2);
    scene.add(sun);

    const colors = ['#ff8a3d', '#2ec4b6', '#f7f052'];
    const geometries = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.TorusKnotGeometry(0.7, 0.25, 48, 6),
      new THREE.OctahedronGeometry(1, 0),
    ];
    const meshes = geometries.map((g, i) => {
      const m = new THREE.Mesh(g, retroMaterial(new THREE.MeshLambertMaterial({ color: colors[i], flatShading: true })));
      m.position.x = (i - 1) * 2.6;
      scene.add(m);
      return m;
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40, 20, 20),
      retroMaterial(new THREE.MeshLambertMaterial({ color: '#0f5e6e' })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.5;
    scene.add(floor);

    const resize = () => {
      retro.setSize(canvas.clientWidth, canvas.clientHeight);
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    window.__retroFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      meshes.forEach((m, i) => {
        m.rotation.x = t * (0.4 + i * 0.1);
        m.rotation.y = t * 0.7;
      });
      retro.render(scene, camera);
      window.__retroFrames = (window.__retroFrames ?? 0) + 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      retro.dispose();
    };
  }, []);

  return <canvas ref={ref} className="retro-canvas" />;
}
```

`src/app/dev/retro/RetroDemoLoader.tsx`:
```tsx
'use client';
import dynamic from 'next/dynamic';

const RetroDemo = dynamic(() => import('@/retro/dev/RetroDemo'), { ssr: false });

export default function RetroDemoLoader() {
  return <RetroDemo />;
}
```

`src/app/dev/retro/page.tsx`:
```tsx
import RetroDemoLoader from './RetroDemoLoader';

export const metadata = { title: 'Retro renderer test' };

export default function RetroDevPage() {
  return <RetroDemoLoader />;
}
```

- [ ] **Step 10: Visual check**

Run: `npm run dev`, open `http://localhost:3000/dev/retro`.
Expected: three spinning flat-shaded shapes over a teal floor, visibly chunky (≈448 lines), dithered gradients, faint motion trails, slight vertex wobble, no console errors. Stop the server.

- [ ] **Step 11: Typecheck + commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

```bash
git add src/retro src/app/dev
git commit -m "feat(retro): PS2-style renderer with dither, trail, vertex snap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Retro UI primitives + support detection

**Files:**
- Create: `src/retro/ui/retro.module.css`, `src/retro/ui/Panel.tsx`, `src/retro/ui/RetroButton.tsx`, `src/retro/ui/Meter.tsx`, `src/retro/ui/LoadingScreen.tsx`, `src/retro/ui/RotateDevice.tsx`, `src/retro/ui/SupportGate.tsx`, `src/retro/support.ts`
- Test: `src/retro/support.test.ts`, `src/retro/ui/Meter.test.tsx`

**Interfaces:**
- Produces:
  - `interface SupportReport { webgl2: boolean; audioWorklet: boolean }`, `checkSupport(win: Window): SupportReport`
  - `<Panel title?: string className?: string>{children}</Panel>`
  - `<RetroButton ...ButtonHTMLAttributes & { active?: boolean }>` (focus glow, `data-active`)
  - `<Meter value: number segments?: number label?: string />` — renders `segments` spans; `round(clamp(value)*segments)` have `data-on="true"`
  - `<LoadingScreen label?: string progress?: number />`
  - `<RotateDevice />` — CSS-only portrait overlay (`max-width: 900px` and portrait)
  - `<SupportGate needs: Array<keyof SupportReport>>{children}</SupportGate>` — renders children only when all needs are met, else an explanatory Panel

- [ ] **Step 1: Failing tests**

`src/retro/support.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkSupport } from './support';

const fakeWindow = (webgl2: boolean, worklet: boolean) =>
  ({
    document: { createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' && webgl2 ? {} : null) }) },
    AudioWorkletNode: worklet ? function AudioWorkletNode() {} : undefined,
  }) as unknown as Window;

describe('checkSupport', () => {
  it('detects both features', () => {
    expect(checkSupport(fakeWindow(true, true))).toEqual({ webgl2: true, audioWorklet: true });
  });
  it('detects missing features', () => {
    expect(checkSupport(fakeWindow(false, false))).toEqual({ webgl2: false, audioWorklet: false });
  });
  it('treats a throwing getContext as unsupported', () => {
    const w = { document: { createElement: () => ({ getContext: () => { throw new Error('x'); } }) } } as unknown as Window;
    expect(checkSupport(w).webgl2).toBe(false);
  });
});
```

`src/retro/ui/Meter.test.tsx`:
```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Meter } from './Meter';

afterEach(cleanup);

describe('Meter', () => {
  it('lights the right number of segments', () => {
    const { container } = render(<Meter value={0.5} segments={10} label="speed" />);
    expect(container.querySelectorAll('[data-on="true"]').length).toBe(5);
    expect(container.querySelectorAll('[data-on]').length).toBe(10);
  });
  it('clamps out-of-range values', () => {
    const { container } = render(<Meter value={3} segments={4} />);
    expect(container.querySelectorAll('[data-on="true"]').length).toBe(4);
  });
});
```

Run: `npx vitest run src/retro` → FAIL (modules missing).

- [ ] **Step 2: Implement support** — `src/retro/support.ts`

```ts
export interface SupportReport {
  webgl2: boolean;
  audioWorklet: boolean;
}

export function checkSupport(win: Window): SupportReport {
  let webgl2 = false;
  try {
    webgl2 = !!win.document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  const audioWorklet = typeof (win as Window & { AudioWorkletNode?: unknown }).AudioWorkletNode === 'function';
  return { webgl2, audioWorklet };
}
```

- [ ] **Step 3: Implement UI** — `src/retro/ui/retro.module.css`

```css
.panel {
  position: relative;
  padding: 18px 22px;
  background: linear-gradient(180deg, rgba(34, 46, 110, 0.92), rgba(10, 14, 42, 0.94));
  border: 2px solid #8fb4ff;
  border-radius: 6px;
  box-shadow: 0 0 0 2px #0a0f2c, 0 0 24px rgba(90, 150, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  color: #eef3ff;
}
.panelTitle {
  margin: 0 0 12px;
  font-size: 1.1rem;
  letter-spacing: 0.12em;
  font-style: italic;
  transform: skewX(-8deg);
  text-shadow: 2px 2px 0 #0a0f2c;
}
.button {
  padding: 10px 22px;
  border: 2px solid #c9d8ff;
  border-radius: 999px;
  background: linear-gradient(180deg, #3c5bd8, #1a2a86);
  letter-spacing: 0.14em;
  font-style: italic;
  cursor: pointer;
  text-shadow: 1px 1px 0 #050a24;
  transition: transform 80ms ease, box-shadow 120ms ease;
}
.button:hover,
.button:focus-visible,
.button[data-active='true'] {
  outline: none;
  box-shadow: 0 0 0 3px #ffe16b, 0 0 18px #ffe16b;
}
.button:active { transform: scale(0.96); }
.meter { display: inline-flex; gap: 3px; }
.seg, .segOn { width: 8px; height: 16px; border-radius: 1px; background: #1b2350; }
.segOn { background: linear-gradient(180deg, #9dff6b, #2fbf4a); box-shadow: 0 0 6px #6bff7e; }
.loading {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 18px;
  align-content: center;
  background: radial-gradient(ellipse at center, #13206b 0%, #03040f 70%);
  font-family: var(--font-mono), monospace;
  font-size: 1.6rem;
  letter-spacing: 0.2em;
}
.disc {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: conic-gradient(#8fb4ff, #3c5bd8, #ffe16b, #8fb4ff);
  mask: radial-gradient(circle, transparent 12px, #000 13px);
  animation: spin 1.1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.rotate {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
  place-items: center;
  align-content: center;
  gap: 12px;
  background: #03040f;
  text-align: center;
  padding: 24px;
}
@media (orientation: portrait) and (max-width: 900px) {
  .rotate { display: grid; }
}
.unsupported { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; }
```

`src/retro/ui/Panel.tsx`:
```tsx
import styles from './retro.module.css';

export function Panel({ title, className, children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`${styles.panel} ${className ?? ''}`}>
      {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
      {children}
    </div>
  );
}
```

`src/retro/ui/RetroButton.tsx`:
```tsx
import styles from './retro.module.css';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean };

export function RetroButton({ active, className, type = 'button', ...rest }: Props) {
  return <button type={type} className={`${styles.button} ${className ?? ''}`} data-active={active ? 'true' : undefined} {...rest} />;
}
```

`src/retro/ui/Meter.tsx`:
```tsx
import styles from './retro.module.css';

export function Meter({ value, segments = 12, label }: { value: number; segments?: number; label?: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  const lit = Math.round(clamped * segments);
  return (
    <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={clamped} aria-label={label}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? styles.segOn : styles.seg} data-on={i < lit ? 'true' : 'false'} />
      ))}
    </div>
  );
}
```

`src/retro/ui/LoadingScreen.tsx`:
```tsx
import { Meter } from './Meter';
import styles from './retro.module.css';

export function LoadingScreen({ label = 'Loading', progress }: { label?: string; progress?: number }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.disc} aria-hidden />
      <div>{label.toUpperCase()}…</div>
      {progress !== undefined ? <Meter value={progress} segments={16} label="Loading progress" /> : null}
    </div>
  );
}
```

`src/retro/ui/RotateDevice.tsx`:
```tsx
import styles from './retro.module.css';

export function RotateDevice() {
  return (
    <div className={styles.rotate} aria-live="polite">
      <div style={{ fontSize: '3rem' }} aria-hidden>⟳</div>
      <p>ROTATE YOUR DEVICE TO LANDSCAPE</p>
    </div>
  );
}
```

`src/retro/ui/SupportGate.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { checkSupport, type SupportReport } from '../support';
import { Panel } from './Panel';
import styles from './retro.module.css';

const NAMES: Record<keyof SupportReport, string> = { webgl2: 'WebGL 2', audioWorklet: 'Web Audio worklets' };

export function SupportGate({ needs, children }: { needs: Array<keyof SupportReport>; children: React.ReactNode }) {
  const [report, setReport] = useState<SupportReport | null>(null);
  useEffect(() => setReport(checkSupport(window)), []);
  if (!report) return null;
  const missing = needs.filter((n) => !report[n]);
  if (missing.length === 0) return <>{children}</>;
  return (
    <div className={styles.unsupported}>
      <Panel title="NEEDS A MODERN BROWSER">
        <p>This experience needs {missing.map((m) => NAMES[m]).join(' and ')}.</p>
        <p>Try the latest Chrome, Edge, Firefox or Safari on a desktop.</p>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/retro` → PASS. `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/retro
git commit -m "feat(retro): PS2 UI primitives and browser support gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Portal, ModeSwitch, experience route shells

**Files:**
- Create: `src/portal/Portal.tsx`, `src/portal/portal.module.css`, `src/shared/ModeSwitch.tsx`, `src/shared/modeSwitch.module.css`, `src/app/surf/page.tsx`, `src/app/surf/SurfLoader.tsx`, `src/surf/SurfApp.tsx` (placeholder), `src/app/dj/page.tsx`, `src/app/dj/DjLoader.tsx`, `src/dj/DjApp.tsx` (placeholder)
- Modify: `src/app/page.tsx`
- Test: `src/portal/Portal.test.tsx`

**Interfaces:**
- Consumes: `useMode`, `MODE_ROUTES`, `otherMode`, `writeMode`, `browserStorage` (Task 1); `LoadingScreen`, `Panel`, `RotateDevice`, `SupportGate` (Task 4)
- Produces:
  - `<ModeSwitch current: Mode />` — fixed top-right; on mount persists `current`; click persists the other mode and `router.push`es its route. `data-testid="mode-switch"`.
  - `src/surf/SurfApp.tsx` and `src/dj/DjApp.tsx` are **default-exported client components**; the surf/DJ plans replace their bodies. Loaders wrap them in `SupportGate` (`['webgl2']` for surf, `['webgl2','audioWorklet']` for DJ) and `RotateDevice`.

- [ ] **Step 1: Failing test** — `src/portal/Portal.test.tsx`

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import Portal from './Portal';

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
});
afterEach(cleanup);

const ready = async () => {
  const main = screen.getByRole('main');
  await waitFor(() => expect(main.getAttribute('data-ready')).toBe('true'));
  return main;
};

describe('Portal', () => {
  it('defaults to light and starts the surf game', async () => {
    render(<Portal />);
    await ready();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('mode-caption').textContent).toContain('SURF');
    fireEvent.click(screen.getByText('PRESS START'));
    expect(push).toHaveBeenCalledWith('/surf');
  });

  it('toggles to dark, persists, and starts the DJ booth', async () => {
    render(<Portal />);
    await ready();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('zf-mode')).toBe('dark');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/dj');
  });

  it('restores the stored mode and toggles with arrow keys', async () => {
    localStorage.setItem('zf-mode', 'dark');
    render(<Portal />);
    await ready();
    expect(screen.getByTestId('mode-caption').textContent).toContain('DJ');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('mode-caption').textContent).toContain('SURF');
  });
});
```

Run: `npx vitest run src/portal` → FAIL (module missing).

- [ ] **Step 2: Implement Portal** — `src/portal/Portal.tsx`

```tsx
'use client';
import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MODE_ROUTES, otherMode, type Mode } from '@/shared/mode';
import { useMode } from '@/shared/useMode';
import styles from './portal.module.css';

const SHAPES = Array.from({ length: 10 }, (_, i) => i);

export default function Portal() {
  const router = useRouter();
  const { mode, setMode } = useMode();

  const start = useCallback(() => {
    if (mode) router.push(MODE_ROUTES[mode]);
  }, [mode, router]);

  const toggle = useCallback(() => {
    if (mode) setMode(otherMode(mode));
  }, [mode, setMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        start();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, toggle]);

  const current: Mode = mode ?? 'light';

  return (
    <main className={styles.portal} data-mode={current} data-ready={mode !== null ? 'true' : 'false'}>
      <div className={styles.day} aria-hidden />
      <div className={styles.night} aria-hidden />
      <div className={styles.shapes} aria-hidden>
        {SHAPES.map((i) => (
          <span key={i} className={styles.shape} style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>
      <section className={styles.center}>
        <h1 className={styles.title}>ZACH FARRELL</h1>
        <button
          type="button"
          role="switch"
          aria-checked={current === 'dark'}
          aria-label="Dark mode"
          className={styles.toggle}
          onClick={toggle}
        >
          <span className={styles.sun} aria-hidden />
          <span className={styles.moon} aria-hidden />
          <span className={styles.knob} aria-hidden />
        </button>
        <p className={styles.caption} data-testid="mode-caption">
          {current === 'light' ? 'LIGHT MODE — SURF' : 'DARK MODE — DJ'}
        </p>
        <button type="button" className={styles.start} onClick={start}>
          PRESS START
        </button>
        <p className={styles.hint}>← → switch · ENTER start</p>
      </section>
    </main>
  );
}
```

`src/portal/portal.module.css`:
```css
.portal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  perspective: 900px;
}
.portal[data-ready='false'] .center { visibility: hidden; }
.day, .night {
  position: absolute;
  inset: 0;
  transition: opacity 900ms ease;
}
.day { background: linear-gradient(180deg, #4fb6ff 0%, #9ee0ff 45%, #ffd08a 75%, #ff9d5c 100%); }
.night { background: radial-gradient(ellipse at 50% 120%, #3a1760 0%, #0b0a2e 55%, #03030c 100%); opacity: 0; }
.portal[data-mode='dark'] .night { opacity: 1; }
.shapes { position: absolute; inset: 0; transform-style: preserve-3d; }
.shape {
  position: absolute;
  left: calc(8% + var(--i) * 9%);
  bottom: -20%;
  width: 34px;
  height: calc(90px + var(--i) * 18px);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.05));
  border: 1px solid rgba(255, 255, 255, 0.5);
  animation: rise calc(9s + var(--i) * 1.3s) linear infinite;
  animation-delay: calc(var(--i) * -2.1s);
  opacity: 0.55;
}
.portal[data-mode='dark'] .shape {
  background: linear-gradient(180deg, rgba(160, 110, 255, 0.6), rgba(60, 20, 120, 0.05));
  border-color: rgba(200, 160, 255, 0.6);
}
@keyframes rise {
  from { transform: translateY(0) rotateY(0deg) rotateX(10deg); }
  to { transform: translateY(-140vh) rotateY(360deg) rotateX(10deg); }
}
.center {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 22px;
  text-align: center;
  padding: 16px;
}
.title {
  margin: 0;
  font-size: clamp(2.2rem, 7vw, 5rem);
  font-style: italic;
  letter-spacing: 0.08em;
  transform: skewX(-10deg);
  color: #fff;
  text-shadow: 4px 4px 0 #0a1a5c, 0 0 30px rgba(255, 255, 255, 0.5);
}
.toggle {
  position: relative;
  width: 168px;
  height: 76px;
  border-radius: 999px;
  border: 3px solid #fff;
  background: rgba(10, 20, 70, 0.35);
  cursor: pointer;
  box-shadow: 0 0 24px rgba(255, 255, 255, 0.35);
}
.toggle:focus-visible { outline: 3px solid #ffe16b; outline-offset: 4px; }
.sun, .moon {
  position: absolute;
  top: 50%;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  transform: translateY(-50%);
}
.sun { left: 18px; background: radial-gradient(circle, #fff6b0, #ffb300); box-shadow: 0 0 16px #ffcf40; }
.moon { right: 18px; background: transparent; box-shadow: inset -10px -4px 0 0 #e8e4ff; }
.knob {
  position: absolute;
  top: 7px;
  left: 8px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #c8d6ff 60%, #7d8fd6);
  transition: transform 450ms cubic-bezier(0.34, 1.56, 0.64, 1);
  opacity: 0.85;
}
.toggle[aria-checked='true'] .knob { transform: translateX(90px); }
.caption {
  margin: 0;
  font-size: 1.3rem;
  letter-spacing: 0.25em;
  color: #fff;
  text-shadow: 2px 2px 0 #0a1a5c;
}
.start {
  padding: 12px 34px;
  border: none;
  background: none;
  font-size: 1.6rem;
  letter-spacing: 0.3em;
  font-style: italic;
  color: #ffe16b;
  text-shadow: 3px 3px 0 #5a2a00;
  cursor: pointer;
  animation: blink 1.2s steps(2, jump-none) infinite;
}
.start:focus-visible { outline: 3px solid #fff; }
@keyframes blink { 50% { opacity: 0.25; } }
.hint {
  margin: 0;
  font-family: var(--font-mono), monospace;
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.8);
}
@media (prefers-reduced-motion: reduce) {
  .shape, .start { animation: none; }
}
```

`src/app/page.tsx`:
```tsx
import Portal from '@/portal/Portal';

export default function Home() {
  return <Portal />;
}
```

- [ ] **Step 3: Run tests** — `npx vitest run src/portal` → PASS (3 tests).

- [ ] **Step 4: ModeSwitch** — `src/shared/ModeSwitch.tsx`

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { browserStorage, MODE_ROUTES, otherMode, writeMode, type Mode } from './mode';
import styles from './modeSwitch.module.css';

/** Declares which mode the current page is, and jumps to the other experience. */
export default function ModeSwitch({ current }: { current: Mode }) {
  const router = useRouter();
  useEffect(() => {
    writeMode(browserStorage(), current);
  }, [current]);
  const next = otherMode(current);
  return (
    <button
      type="button"
      data-testid="mode-switch"
      className={styles.switch}
      aria-label={next === 'dark' ? 'Switch to dark mode (DJ booth)' : 'Switch to light mode (surf game)'}
      onClick={() => {
        writeMode(browserStorage(), next);
        router.push(MODE_ROUTES[next]);
      }}
    >
      <span className={next === 'dark' ? styles.moon : styles.sun} aria-hidden />
    </button>
  );
}
```

`src/shared/modeSwitch.module.css`:
```css
.switch {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 50;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  background: rgba(8, 12, 40, 0.55);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.switch:focus-visible { outline: 3px solid #ffe16b; outline-offset: 3px; }
.sun { width: 22px; height: 22px; border-radius: 50%; background: radial-gradient(circle, #fff6b0, #ffb300); box-shadow: 0 0 10px #ffcf40; }
.moon { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset -7px -3px 0 0 #e8e4ff; }
```

- [ ] **Step 5: Route shells**

`src/surf/SurfApp.tsx` (placeholder — replaced by the surf plan):
```tsx
'use client';
import ModeSwitch from '@/shared/ModeSwitch';
import { Panel } from '@/retro/ui/Panel';

export default function SurfApp() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#4fb6ff' }}>
      <Panel title="SURF">Paddling out — under construction.</Panel>
      <ModeSwitch current="light" />
    </div>
  );
}
```

`src/app/surf/SurfLoader.tsx`:
```tsx
'use client';
import dynamic from 'next/dynamic';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import { RotateDevice } from '@/retro/ui/RotateDevice';
import { SupportGate } from '@/retro/ui/SupportGate';

const SurfApp = dynamic(() => import('@/surf/SurfApp'), {
  ssr: false,
  loading: () => <LoadingScreen label="Paddling out" />,
});

export default function SurfLoader() {
  return (
    <SupportGate needs={['webgl2']}>
      <SurfApp />
      <RotateDevice />
    </SupportGate>
  );
}
```

`src/app/surf/page.tsx`:
```tsx
import SurfLoader from './SurfLoader';

export const metadata = { title: 'Surf — Zach Farrell' };

export default function SurfPage() {
  return <SurfLoader />;
}
```

`src/dj/DjApp.tsx` (placeholder — replaced by the DJ plan):
```tsx
'use client';
import ModeSwitch from '@/shared/ModeSwitch';
import { Panel } from '@/retro/ui/Panel';

export default function DjApp() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#0b0a2e' }}>
      <Panel title="DJ BOOTH">Soundcheck — under construction.</Panel>
      <ModeSwitch current="dark" />
    </div>
  );
}
```

`src/app/dj/DjLoader.tsx`:
```tsx
'use client';
import dynamic from 'next/dynamic';
import { LoadingScreen } from '@/retro/ui/LoadingScreen';
import { RotateDevice } from '@/retro/ui/RotateDevice';
import { SupportGate } from '@/retro/ui/SupportGate';

const DjApp = dynamic(() => import('@/dj/DjApp'), {
  ssr: false,
  loading: () => <LoadingScreen label="Soundcheck" />,
});

export default function DjLoader() {
  return (
    <SupportGate needs={['webgl2', 'audioWorklet']}>
      <DjApp />
      <RotateDevice />
    </SupportGate>
  );
}
```

`src/app/dj/page.tsx`:
```tsx
import DjLoader from './DjLoader';

export const metadata = { title: 'DJ Booth — Zach Farrell' };

export default function DjPage() {
  return <DjLoader />;
}
```

- [ ] **Step 6: Verify** — `npm run typecheck && npx vitest run && npm run build` → all PASS. Manually: `npm run dev`, open `/`, toggle with mouse and ←/→, Enter goes to the right route, corner switch flips between `/surf` and `/dj`.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: light/dark portal, mode switch, and experience route shells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Track manifest types + waveform codec

**Files:**
- Create: `src/shared/tracks.ts`, `src/shared/waveform.ts`
- Test: `src/shared/tracks.test.ts`, `src/shared/waveform.test.ts`

**Interfaces:**
- Produces (`src/shared/tracks.ts`):
  - `interface TrackSource { id: string; title: string; artist: string; file: string; artwork?: string; bpm: number; key: string; firstBeatSec: number; memoryCues?: number[]; surf?: boolean }`
  - `interface TrackEntry { id: string; title: string; artist: string; bpm: number; key: string; firstBeatSec: number; memoryCues: number[]; surf: boolean; durationSec: number; sampleRate: number; audioUrl: string; artworkUrl: string | null; artworkSmallUrl: string | null; waveformUrl: string; overviewUrl: string }`
  - `interface TrackManifest { version: 1; tracks: TrackEntry[] }`
  - `parseTrackSources(json: unknown): TrackSource[]` (throws `Error('Invalid tracks.json: <path> <problem>')`)
  - `parseManifest(json: unknown): TrackManifest`
  - `loadManifest(fetchFn?: typeof fetch, url?: string): Promise<TrackManifest>` (default url `/tracks/manifest.json`)
  - `secondsPerBeat(bpm: number): number`, `beatTimeSec(t: Pick<TrackEntry,'bpm'|'firstBeatSec'>, beat: number): number`, `beatAtTime(t: Pick<TrackEntry,'bpm'|'firstBeatSec'>, sec: number): number`
- Produces (`src/shared/waveform.ts`):
  - `interface WaveformData { binsPerSec: number; binCount: number; low: Uint8Array; mid: Uint8Array; high: Uint8Array }` (binsPerSec `0` = whole-track overview)
  - `WAVEFORM_HEADER_BYTES = 16`
  - Binary layout (little-endian): bytes 0–3 ASCII `ZFWF`; byte 4 version `1`; bytes 5–7 zero; bytes 8–11 float32 binsPerSec; bytes 12–15 uint32 binCount; then binCount × `[low, mid, high]` uint8.
  - `encodeWaveform(d: WaveformData): Uint8Array`, `decodeWaveform(buf: ArrayBuffer): WaveformData`

- [ ] **Step 1: Failing tests**

`src/shared/waveform.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeWaveform, encodeWaveform, WAVEFORM_HEADER_BYTES } from './waveform';

const sample = () => ({
  binsPerSec: 150,
  binCount: 3,
  low: new Uint8Array([1, 2, 3]),
  mid: new Uint8Array([4, 5, 6]),
  high: new Uint8Array([7, 8, 255]),
});

describe('waveform codec', () => {
  it('round-trips', () => {
    const bytes = encodeWaveform(sample());
    expect(bytes.byteLength).toBe(WAVEFORM_HEADER_BYTES + 9);
    const back = decodeWaveform(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(back.binsPerSec).toBe(150);
    expect(back.binCount).toBe(3);
    expect([...back.low]).toEqual([1, 2, 3]);
    expect([...back.mid]).toEqual([4, 5, 6]);
    expect([...back.high]).toEqual([7, 8, 255]);
  });
  it('interleaves bins after the header', () => {
    const bytes = encodeWaveform(sample());
    expect([...bytes.slice(16, 19)]).toEqual([1, 4, 7]);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('ZFWF');
  });
  it('rejects bad data', () => {
    expect(() => decodeWaveform(new ArrayBuffer(4))).toThrow(/too short/);
    const bytes = encodeWaveform(sample());
    bytes[0] = 0;
    expect(() => decodeWaveform(bytes.buffer)).toThrow(/magic/);
    const truncated = encodeWaveform(sample()).slice(0, 20);
    expect(() => decodeWaveform(truncated.buffer)).toThrow(/length/);
  });
});
```

`src/shared/tracks.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { beatAtTime, beatTimeSec, loadManifest, parseManifest, parseTrackSources, secondsPerBeat } from './tracks';

const source = {
  id: 'sunset-drive',
  title: 'Sunset Drive',
  artist: 'Zach Farrell',
  file: 'sunset-drive.wav',
  bpm: 124,
  key: '8A',
  firstBeatSec: 0.05,
};

const entry = {
  ...source,
  memoryCues: [],
  surf: true,
  durationSec: 200,
  sampleRate: 44100,
  audioUrl: '/tracks/sunset-drive/audio.m4a',
  artworkUrl: null,
  artworkSmallUrl: null,
  waveformUrl: '/tracks/sunset-drive/waveform.bin',
  overviewUrl: '/tracks/sunset-drive/overview.bin',
};

describe('parseTrackSources', () => {
  it('accepts valid sources and applies defaults', () => {
    const [t] = parseTrackSources({ tracks: [source] });
    expect(t).toMatchObject({ id: 'sunset-drive', bpm: 124, memoryCues: [], surf: false });
  });
  it('rejects bad fields with a path', () => {
    expect(() => parseTrackSources({ tracks: [{ ...source, bpm: -1 }] })).toThrow('tracks[0].bpm');
    expect(() => parseTrackSources({ tracks: [{ ...source, key: 'H9' }] })).toThrow('tracks[0].key');
    expect(() => parseTrackSources({ tracks: [{ ...source, id: 'Bad Id' }] })).toThrow('tracks[0].id');
    expect(() => parseTrackSources({ tracks: [source, source] })).toThrow('duplicate id');
    expect(() => parseTrackSources({})).toThrow('tracks');
  });
});

describe('manifest', () => {
  it('parses a manifest', () => {
    expect(parseManifest({ version: 1, tracks: [entry] }).tracks[0]!.id).toBe('sunset-drive');
  });
  it('rejects wrong versions', () => {
    expect(() => parseManifest({ version: 2, tracks: [] })).toThrow('version');
  });
  it('loads over fetch', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ version: 1, tracks: [entry] })));
    const m = await loadManifest(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('/tracks/manifest.json');
    expect(m.tracks).toHaveLength(1);
  });
  it('reports HTTP failures', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(loadManifest(fetchFn as unknown as typeof fetch)).rejects.toThrow('404');
  });
});

describe('beat math', () => {
  it('converts between beats and seconds', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(beatTimeSec({ bpm: 120, firstBeatSec: 0.25 }, 4)).toBeCloseTo(2.25);
    expect(beatAtTime({ bpm: 120, firstBeatSec: 0.25 }, 2.25)).toBeCloseTo(4);
    expect(beatAtTime({ bpm: 120, firstBeatSec: 0.25 }, 0)).toBeCloseTo(-0.5);
  });
});
```

Run: `npx vitest run src/shared` → FAIL (modules missing).

- [ ] **Step 2: Implement** — `src/shared/waveform.ts`

```ts
export interface WaveformData {
  /** Bins per second of audio; 0 for a whole-track overview. */
  binsPerSec: number;
  binCount: number;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
}

export const WAVEFORM_HEADER_BYTES = 16;
const MAGIC = [0x5a, 0x46, 0x57, 0x46]; // "ZFWF"
const VERSION = 1;

export function encodeWaveform(d: WaveformData): Uint8Array {
  const out = new Uint8Array(WAVEFORM_HEADER_BYTES + d.binCount * 3);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  const view = new DataView(out.buffer);
  view.setFloat32(8, d.binsPerSec, true);
  view.setUint32(12, d.binCount, true);
  for (let i = 0, o = WAVEFORM_HEADER_BYTES; i < d.binCount; i++, o += 3) {
    out[o] = d.low[i]!;
    out[o + 1] = d.mid[i]!;
    out[o + 2] = d.high[i]!;
  }
  return out;
}

export function decodeWaveform(buf: ArrayBuffer): WaveformData {
  if (buf.byteLength < WAVEFORM_HEADER_BYTES) throw new Error('Waveform data too short');
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('Waveform data has bad magic');
  if (bytes[4] !== VERSION) throw new Error(`Unsupported waveform version ${bytes[4]}`);
  const view = new DataView(buf);
  const binsPerSec = view.getFloat32(8, true);
  const binCount = view.getUint32(12, true);
  if (buf.byteLength !== WAVEFORM_HEADER_BYTES + binCount * 3) throw new Error('Waveform data length mismatch');
  const low = new Uint8Array(binCount);
  const mid = new Uint8Array(binCount);
  const high = new Uint8Array(binCount);
  for (let i = 0, o = WAVEFORM_HEADER_BYTES; i < binCount; i++, o += 3) {
    low[i] = bytes[o]!;
    mid[i] = bytes[o + 1]!;
    high[i] = bytes[o + 2]!;
  }
  return { binsPerSec, binCount, low, mid, high };
}
```

- [ ] **Step 3: Implement** — `src/shared/tracks.ts`

```ts
export interface TrackSource {
  id: string;
  title: string;
  artist: string;
  file: string;
  artwork?: string;
  bpm: number;
  key: string;
  firstBeatSec: number;
  memoryCues?: number[];
  surf?: boolean;
}

export interface TrackEntry {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  firstBeatSec: number;
  memoryCues: number[];
  surf: boolean;
  durationSec: number;
  sampleRate: number;
  audioUrl: string;
  artworkUrl: string | null;
  artworkSmallUrl: string | null;
  waveformUrl: string;
  overviewUrl: string;
}

export interface TrackManifest {
  version: 1;
  tracks: TrackEntry[];
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAMELOT_RE = /^(1[0-2]|[1-9])[AB]$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid tracks.json: ${path} ${problem}`);
};
const str = (o: Obj, k: string, path: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${k}`, 'must be a non-empty string');
  return v as string;
};
const num = (o: Obj, k: string, path: string, min: number, exclusive = false): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || (exclusive ? v <= min : v < min)) {
    fail(`${path}.${k}`, `must be a number ${exclusive ? '>' : '>='} ${min}`);
  }
  return v as number;
};

export function parseTrackSources(json: unknown): TrackSource[] {
  if (!isObj(json) || !Array.isArray(json.tracks)) fail('tracks', 'must be an array');
  const seen = new Set<string>();
  return ((json as Obj).tracks as unknown[]).map((raw, i) => {
    const path = `tracks[${i}]`;
    if (!isObj(raw)) fail(path, 'must be an object');
    const o = raw as Obj;
    const id = str(o, 'id', path);
    if (!ID_RE.test(id)) fail(`${path}.id`, 'must be kebab-case');
    if (seen.has(id)) fail(`${path}.id`, `duplicate id "${id}"`);
    seen.add(id);
    const key = str(o, 'key', path);
    if (!CAMELOT_RE.test(key)) fail(`${path}.key`, 'must be Camelot notation like 8A');
    const memoryCues = o.memoryCues ?? [];
    if (!Array.isArray(memoryCues) || memoryCues.some((c) => typeof c !== 'number' || c < 0)) {
      fail(`${path}.memoryCues`, 'must be an array of beat numbers >= 0');
    }
    if (o.artwork !== undefined && typeof o.artwork !== 'string') fail(`${path}.artwork`, 'must be a string');
    return {
      id,
      title: str(o, 'title', path),
      artist: str(o, 'artist', path),
      file: str(o, 'file', path),
      artwork: o.artwork as string | undefined,
      bpm: num(o, 'bpm', path, 0, true),
      key,
      firstBeatSec: num(o, 'firstBeatSec', path, 0),
      memoryCues: memoryCues as number[],
      surf: o.surf === true,
    };
  });
}

export function parseManifest(json: unknown): TrackManifest {
  if (!isObj(json) || json.version !== 1) throw new Error('Invalid manifest: version must be 1');
  if (!Array.isArray(json.tracks)) throw new Error('Invalid manifest: tracks must be an array');
  for (const [i, t] of (json.tracks as unknown[]).entries()) {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.bpm !== 'number' || typeof t.audioUrl !== 'string') {
      throw new Error(`Invalid manifest: tracks[${i}] is malformed`);
    }
  }
  return json as unknown as TrackManifest;
}

export async function loadManifest(fetchFn: typeof fetch = fetch, url = '/tracks/manifest.json'): Promise<TrackManifest> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load track manifest: HTTP ${res.status}`);
  return parseManifest(await res.json());
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

export function beatTimeSec(t: Pick<TrackEntry, 'bpm' | 'firstBeatSec'>, beat: number): number {
  return t.firstBeatSec + beat * secondsPerBeat(t.bpm);
}

export function beatAtTime(t: Pick<TrackEntry, 'bpm' | 'firstBeatSec'>, sec: number): number {
  return (sec - t.firstBeatSec) / secondsPerBeat(t.bpm);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/shared` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared
git commit -m "feat(shared): track manifest types and binary waveform codec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Waveform analysis library

**Files:**
- Create: `scripts/lib/analyze.ts`
- Test: `scripts/lib/analyze.test.ts`

**Interfaces:**
- Consumes: `WaveformData` (Task 6)
- Produces:
  - `interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }`
  - `lowpass(freq: number, sampleRate: number, q?: number): Biquad`, `highpass(freq: number, sampleRate: number, q?: number): Biquad`
  - `applyBiquad(input: Float32Array, c: Biquad): Float32Array`
  - `bandSplit(mono: Float32Array, sampleRate: number): { low: Float32Array; mid: Float32Array; high: Float32Array }`
  - `peakBins(signal: Float32Array, binCount: number): Float32Array`
  - `DETAIL_BINS_PER_SEC = 150`, `OVERVIEW_BINS = 1024`
  - `analyzeWaveform(mono: Float32Array, sampleRate: number): { detail: WaveformData; overview: WaveformData }`

- [ ] **Step 1: Failing tests** — `scripts/lib/analyze.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { analyzeWaveform, bandSplit, OVERVIEW_BINS, peakBins } from './analyze';

const SR = 44100;
const sine = (hz: number, sec: number, amp = 0.8) => {
  const out = new Float32Array(Math.round(SR * sec));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const mean = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;

describe('bandSplit', () => {
  it.each([
    [80, 'low'],
    [1000, 'mid'],
    [8000, 'high'],
  ] as const)('routes %d Hz to %s', (hz, band) => {
    const bands = bandSplit(sine(hz, 1), SR);
    const levels = { low: rms(bands.low), mid: rms(bands.mid), high: rms(bands.high) };
    for (const other of ['low', 'mid', 'high'] as const) {
      if (other !== band) expect(levels[band]).toBeGreaterThan(5 * levels[other]);
    }
  });
});

describe('peakBins', () => {
  it('takes the max absolute value per bin', () => {
    const bins = peakBins(new Float32Array([0.1, -0.5, 0.2, 0.3, -0.9, 0]), 3);
    expect([...bins].map((v) => +v.toFixed(2))).toEqual([0.5, 0.3, 0.9]);
  });
});

describe('analyzeWaveform', () => {
  it('produces 150 bins/sec detail and a 1024-bin overview', () => {
    const { detail, overview } = analyzeWaveform(sine(80, 2), SR);
    expect(detail.binsPerSec).toBe(150);
    expect(detail.binCount).toBe(300);
    expect(overview.binsPerSec).toBe(0);
    expect(overview.binCount).toBe(OVERVIEW_BINS);
    expect(mean(detail.low)).toBeGreaterThan(5 * mean(detail.high));
    expect(Math.max(...detail.low)).toBe(255);
  });
  it('handles silence without NaN', () => {
    const { detail } = analyzeWaveform(new Float32Array(SR), SR);
    expect(Math.max(...detail.low, ...detail.mid, ...detail.high)).toBe(0);
  });
});
```

Run: `npx vitest run scripts/lib/analyze.test.ts` → FAIL.

- [ ] **Step 2: Implement** — `scripts/lib/analyze.ts`

```ts
import type { WaveformData } from '../../src/shared/waveform';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const DETAIL_BINS_PER_SEC = 150;
export const OVERVIEW_BINS = 1024;
const LOW_MID_HZ = 250;
const MID_HIGH_HZ = 3000;

// RBJ Audio EQ Cookbook, normalized by a0.
export function lowpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Transposed direct form II. */
export function applyBiquad(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    out[i] = y;
  }
  return out;
}

const cascade = (input: Float32Array, filters: Biquad[]) => filters.reduce((sig, f) => applyBiquad(sig, f), input);

/** Two cascaded Butterworth sections per edge (24 dB/oct, Linkwitz-Riley style). */
export function bandSplit(mono: Float32Array, sampleRate: number) {
  const lp1 = lowpass(LOW_MID_HZ, sampleRate);
  const hp1 = highpass(LOW_MID_HZ, sampleRate);
  const lp2 = lowpass(MID_HIGH_HZ, sampleRate);
  const hp2 = highpass(MID_HIGH_HZ, sampleRate);
  return {
    low: cascade(mono, [lp1, lp1]),
    mid: cascade(mono, [hp1, hp1, lp2, lp2]),
    high: cascade(mono, [hp2, hp2]),
  };
}

export function peakBins(signal: Float32Array, binCount: number): Float32Array {
  const out = new Float32Array(binCount);
  const n = signal.length;
  for (let b = 0; b < binCount; b++) {
    const start = Math.floor((b * n) / binCount);
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / binCount));
    let peak = 0;
    for (let i = start; i < end && i < n; i++) {
      const v = Math.abs(signal[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

const toBytes = (peaks: Float32Array, scale: number) => {
  const out = new Uint8Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) out[i] = Math.min(255, Math.round(peaks[i]! * scale));
  return out;
};

export function analyzeWaveform(mono: Float32Array, sampleRate: number): { detail: WaveformData; overview: WaveformData } {
  const bands = bandSplit(mono, sampleRate);
  const detailCount = Math.max(1, Math.ceil((mono.length / sampleRate) * DETAIL_BINS_PER_SEC));
  const d = { low: peakBins(bands.low, detailCount), mid: peakBins(bands.mid, detailCount), high: peakBins(bands.high, detailCount) };
  const o = {
    low: peakBins(bands.low, OVERVIEW_BINS),
    mid: peakBins(bands.mid, OVERVIEW_BINS),
    high: peakBins(bands.high, OVERVIEW_BINS),
  };
  let max = 0;
  for (const arr of [d.low, d.mid, d.high]) for (const v of arr) if (v > max) max = v;
  // One shared scale keeps relative band energy honest (a quiet hi-hat stays small).
  const scale = max > 0 ? 255 / max : 0;
  return {
    detail: {
      binsPerSec: DETAIL_BINS_PER_SEC,
      binCount: detailCount,
      low: toBytes(d.low, scale),
      mid: toBytes(d.mid, scale),
      high: toBytes(d.high, scale),
    },
    overview: {
      binsPerSec: 0,
      binCount: OVERVIEW_BINS,
      low: toBytes(o.low, scale),
      mid: toBytes(o.mid, scale),
      high: toBytes(o.high, scale),
    },
  };
}
```

- [ ] **Step 3: Run tests** — `npx vitest run scripts/lib` → PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib
git commit -m "feat(pipeline): 3-band waveform analysis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Synthesized placeholder tracks

**Files:**
- Create: `scripts/lib/wav.ts`, `scripts/lib/synth.ts`, `scripts/make-test-tracks.ts`
- Test: `scripts/lib/wav.test.ts`, `scripts/lib/synth.test.ts`

**Interfaces:**
- Produces:
  - `encodeWav16(channels: Float32Array[], sampleRate: number): Buffer`
  - `interface SynthOptions { bpm: number; rootHz: number; bars: number; sampleRate: number; leadInSec: number; seed: number }`
  - `synthTestTrack(o: SynthOptions): { left: Float32Array; right: Float32Array }` — deterministic; first kick exactly at `leadInSec`; arrangement intro (first ⅙ of bars: kick + hats), main (kick, clap, hats, bass, stabs), outro (last ⅙: kick + hats)
  - `TEST_TRACKS: Array<{ id; title; bpm; key; rootHz; color }>` and `makeTestTracks(dir: string): Promise<void>` — writes `<dir>/<id>.wav`, `<dir>/<id>.jpg`, `<dir>/tracks.json`

- [ ] **Step 1: Failing tests**

`scripts/lib/wav.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { encodeWav16 } from './wav';

describe('encodeWav16', () => {
  it('writes a valid 16-bit PCM header and clipped samples', () => {
    const buf = encodeWav16([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, -0.5, 0, -2])], 48000);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(4)).toBe(36 + 16);
    expect(buf.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(buf.readUInt16LE(20)).toBe(1);
    expect(buf.readUInt16LE(22)).toBe(2);
    expect(buf.readUInt32LE(24)).toBe(48000);
    expect(buf.readUInt32LE(28)).toBe(48000 * 4);
    expect(buf.readUInt16LE(32)).toBe(4);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(16);
    expect(buf.readInt16LE(44 + 4 * 1)).toBe(32767); // L frame 1 = 1.0
    expect(buf.readInt16LE(44 + 4 * 3)).toBe(32767); // L frame 3 = 2.0 clipped
    expect(buf.readInt16LE(44 + 4 * 3 + 2)).toBe(-32768); // R frame 3 = -2.0 clipped
  });
});
```

`scripts/lib/synth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { synthTestTrack } from './synth';

const opts = { bpm: 120, rootHz: 55, bars: 12, sampleRate: 22050, leadInSec: 0.25, seed: 7 };
const rmsWindow = (a: Float32Array, start: number, len: number) => {
  let s = 0;
  for (let i = start; i < start + len; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / len);
};

describe('synthTestTrack', () => {
  it('has the exact expected length', () => {
    const { left, right } = synthTestTrack(opts);
    const expected = Math.round(0.25 * 22050) + Math.round(12 * 4 * 0.5 * 22050);
    expect(left.length).toBe(expected);
    expect(right.length).toBe(expected);
  });
  it('stays within [-1, 1]', () => {
    const { left } = synthTestTrack(opts);
    expect(left.every((v) => v >= -1 && v <= 1)).toBe(true);
  });
  it('is deterministic', () => {
    const a = synthTestTrack(opts).left;
    const b = synthTestTrack(opts).left;
    expect(a).toEqual(b);
  });
  it('puts kicks on the beat grid', () => {
    const { left } = synthTestTrack(opts);
    const sr = opts.sampleRate;
    const win = Math.round(0.03 * sr);
    const beat4 = Math.round((0.25 + 4 * 0.5) * sr);
    expect(rmsWindow(left, beat4, win)).toBeGreaterThan(3 * rmsWindow(left, beat4 - win - Math.round(0.1 * sr), win));
  });
});
```

Run: `npx vitest run scripts/lib` → FAIL (modules missing).

- [ ] **Step 2: Implement** — `scripts/lib/wav.ts`

```ts
export function encodeWav16(channels: Float32Array[], sampleRate: number): Buffer {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataSize = frames * numCh * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numCh * 2, 28);
  buf.writeUInt16LE(numCh * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      buf.writeInt16LE(v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}
```

- [ ] **Step 3: Implement** — `scripts/lib/synth.ts`

```ts
export interface SynthOptions {
  bpm: number;
  rootHz: number;
  bars: number;
  sampleRate: number;
  leadInSec: number;
  seed: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 4/4 house loop — a DJ-friendly placeholder with a known beatgrid. */
export function synthTestTrack(o: SynthOptions): { left: Float32Array; right: Float32Array } {
  const sr = o.sampleRate;
  const spb = 60 / o.bpm;
  const lead = Math.round(o.leadInSec * sr);
  const total = lead + Math.round(o.bars * 4 * spb * sr);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const rand = mulberry32(o.seed);
  const noise = new Float32Array(Math.round(sr * 0.25)).map(() => rand() * 2 - 1);
  const introBars = Math.floor(o.bars / 6);
  const outroStart = o.bars - introBars;

  const add = (start: number, len: number, fn: (t: number, i: number) => number, panL = 1, panR = 1) => {
    for (let i = 0; i < len && start + i < total; i++) {
      const v = fn(i / sr, i);
      left[start + i]! += v * panL;
      right[start + i]! += v * panR;
    }
  };

  for (let bar = 0; bar < o.bars; bar++) {
    const full = bar >= introBars && bar < outroStart;
    for (let beat = 0; beat < 4; beat++) {
      const beatStart = lead + Math.round((bar * 4 + beat) * spb * sr);
      // Kick: pitch-swept sine, exponential decay.
      let phase = 0;
      add(beatStart, Math.round(0.35 * sr), (t) => {
        const f = 50 + 100 * Math.exp(-t * 30);
        phase += (2 * Math.PI * f) / sr;
        return 0.55 * Math.sin(phase) * Math.exp(-t * 7);
      });
      // Open hat on the off-beat.
      const hatStart = beatStart + Math.round(0.5 * spb * sr);
      let prev = 0;
      add(
        hatStart,
        Math.round(0.08 * sr),
        (t, i) => {
          const n = noise[i % noise.length]!;
          const hp = n - prev;
          prev = n;
          return 0.12 * hp * Math.exp(-t * 45);
        },
        beat % 2 === 0 ? 0.7 : 1,
        beat % 2 === 0 ? 1 : 0.7,
      );
      if (!full) continue;
      // Clap on 2 and 4.
      if (beat === 1 || beat === 3) {
        add(beatStart, Math.round(0.15 * sr), (t, i) => 0.18 * noise[(i * 3) % noise.length]! * Math.exp(-t * 22));
      }
      // Off-beat bass.
      let bp = 0;
      add(hatStart, Math.round(0.45 * spb * sr), (t) => {
        bp += (2 * Math.PI * o.rootHz) / sr;
        return 0.3 * (Math.sin(bp) + 0.3 * Math.sin(2 * bp)) * Math.min(1, t * 200) * Math.exp(-t * 4);
      });
    }
    // Minor-triad stab every 2 bars in the main section.
    if (full && bar % 2 === 0) {
      const start = lead + Math.round(bar * 4 * spb * sr);
      const freqs = [o.rootHz * 4, o.rootHz * 4 * 2 ** (3 / 12), o.rootHz * 4 * 2 ** (7 / 12)];
      const phases = [0, 0, 0];
      add(
        start,
        Math.round(0.6 * sr),
        (t) => {
          let v = 0;
          freqs.forEach((f, k) => {
            phases[k]! += (2 * Math.PI * f) / sr;
            v += Math.sin(phases[k]!) + 0.25 * Math.sin(3 * phases[k]!);
          });
          return 0.06 * v * Math.exp(-t * 5);
        },
        0.85,
        1,
      );
    }
  }
  for (let i = 0; i < total; i++) {
    left[i] = Math.tanh(left[i]!);
    right[i] = Math.tanh(right[i]!);
  }
  return { left, right };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run scripts/lib` → PASS.

- [ ] **Step 5: CLI** — `scripts/make-test-tracks.ts`

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { synthTestTrack } from './lib/synth';
import { encodeWav16 } from './lib/wav';

export const TEST_TRACKS = [
  { id: 'test-sunrise', title: 'Sunrise (Test 120)', bpm: 120, key: '8A', rootHz: 55, color: '0xff8a3d' },
  { id: 'test-tidal', title: 'Tidal (Test 124)', bpm: 124, key: '5A', rootHz: 65.41, color: '0x2ec4b6' },
  { id: 'test-midnight', title: 'Midnight (Test 128)', bpm: 128, key: '1A', rootHz: 51.91, color: '0x7b2ff7' },
] as const;

const SAMPLE_RATE = 44100;
const LEAD_IN = 0.25;
const BARS = 96;

export async function makeTestTracks(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  TEST_TRACKS.forEach((t, i) => {
    const { left, right } = synthTestTrack({ bpm: t.bpm, rootHz: t.rootHz, bars: BARS, sampleRate: SAMPLE_RATE, leadInSec: LEAD_IN, seed: i + 1 });
    writeFileSync(join(dir, `${t.id}.wav`), encodeWav16([left, right], SAMPLE_RATE));
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${t.color}:s=500x500`, '-frames:v', '1', join(dir, `${t.id}.jpg`)]);
  });
  const tracks = TEST_TRACKS.map((t) => ({
    id: t.id,
    title: t.title,
    artist: 'ZF Test Signal',
    file: `${t.id}.wav`,
    artwork: `${t.id}.jpg`,
    bpm: t.bpm,
    key: t.key,
    firstBeatSec: LEAD_IN,
    memoryCues: [64],
    surf: true,
  }));
  writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'content/tracks-test';
  await makeTestTracks(dir);
  console.log(`Wrote ${TEST_TRACKS.length} test tracks to ${dir}`);
}
```

Run: `npx tsx scripts/make-test-tracks.ts`
Expected: `Wrote 3 test tracks to content/tracks-test`; `ls content/tracks-test` shows 3 `.wav`, 3 `.jpg`, `tracks.json`. Play one WAV (`afplay content/tracks-test/test-tidal.wav`, Ctrl-C to stop) — a recognizable house loop.

- [ ] **Step 6: Commit**

```bash
git add scripts
git commit -m "feat(pipeline): synthesized placeholder tracks with exact beatgrids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Track build pipeline + auto-ensure on dev/build

**Files:**
- Create: `scripts/lib/pipeline.ts`, `scripts/build-tracks.ts`, `scripts/ensure-tracks.ts`, `content/tracks/tracks.json`, `content/tracks/README.md`
- Modify: `package.json` (scripts)
- Test: `scripts/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `parseTrackSources`, `TrackManifest`, `TrackEntry` (Task 6); `encodeWaveform` (Task 6); `analyzeWaveform` (Task 7); `makeTestTracks` (Task 8)
- Produces:
  - `buildTracks(opts: { sourceDir: string; outDir: string; urlPrefix?: string; log?: (msg: string) => void }): Promise<TrackManifest>` — `urlPrefix` default `/tracks`
  - Output per track in `<outDir>/<id>/`: `audio.m4a`, `waveform.bin`, `overview.bin`, `artwork.jpg` + `artwork-128.jpg` (if artwork given), `meta.json` (`{ sourceMtimeMs, durationSec, sampleRate }`, for incremental rebuilds); plus `<outDir>/manifest.json`
  - `npm run tracks` builds `content/tracks`; `predev`/`prebuild` run `ensure-tracks` (real tracks if `content/tracks/tracks.json` has ≥1 entry, else synthesized test tracks)

- [ ] **Step 1: Failing integration test** — `scripts/lib/pipeline.test.ts`

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWaveform } from '../../src/shared/waveform';
import { buildTracks } from './pipeline';
import { synthTestTrack } from './synth';
import { encodeWav16 } from './wav';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('buildTracks', () => {
  it('builds audio, waveforms and a manifest', async () => {
    const src = mkdtempSync(join(tmpdir(), 'zf-src-'));
    const out = mkdtempSync(join(tmpdir(), 'zf-out-'));
    const { left, right } = synthTestTrack({ bpm: 120, rootHz: 55, bars: 2, sampleRate: 44100, leadInSec: 0.25, seed: 1 });
    writeFileSync(join(src, 'loop.wav'), encodeWav16([left, right], 44100));
    writeFileSync(
      join(src, 'tracks.json'),
      JSON.stringify({ tracks: [{ id: 'loop', title: 'Loop', artist: 'Test', file: 'loop.wav', bpm: 120, key: '8A', firstBeatSec: 0.25, surf: true }] }),
    );

    const manifest = await buildTracks({ sourceDir: src, outDir: out });
    const expectedDur = 0.25 + 2 * 4 * 0.5;
    const t = manifest.tracks[0]!;
    expect(t.durationSec).toBeCloseTo(expectedDur, 1);
    expect(t.sampleRate).toBe(44100);
    expect(t.audioUrl).toBe('/tracks/loop/audio.m4a');
    expect(t.artworkUrl).toBeNull();
    expect(t.surf).toBe(true);
    expect(existsSync(join(out, 'loop', 'audio.m4a'))).toBe(true);
    const wf = readFileSync(join(out, 'loop', 'waveform.bin'));
    const detail = decodeWaveform(wf.buffer.slice(wf.byteOffset, wf.byteOffset + wf.byteLength) as ArrayBuffer);
    expect(detail.binCount).toBe(Math.ceil(expectedDur * 150));
    const onDisk = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(onDisk.version).toBe(1);

    // Second run is incremental and still yields the same manifest.
    const logs: string[] = [];
    const again = await buildTracks({ sourceDir: src, outDir: out, log: (m) => logs.push(m) });
    expect(again).toEqual(manifest);
    expect(logs.some((l) => l.includes('up to date'))).toBe(true);
  }, 60_000);
});
```

Run: `npx vitest run scripts/lib/pipeline.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement** — `scripts/lib/pipeline.ts`

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrackSources, type TrackEntry, type TrackManifest } from '../../src/shared/tracks';
import { encodeWaveform } from '../../src/shared/waveform';
import { analyzeWaveform } from './analyze';

const ANALYSIS_RATE = 44100;

interface Meta {
  sourceMtimeMs: number;
  durationSec: number;
  sampleRate: number;
}

function ffprobeSampleRate(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]);
  const rate = parseInt(out.toString().trim(), 10);
  if (!Number.isFinite(rate)) throw new Error(`ffprobe could not read sample rate of ${file}`);
  return rate;
}

function decodeMono(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  const aligned = new Uint8Array(raw); // copy: Buffer offsets aren't guaranteed 4-byte aligned
  return new Float32Array(aligned.buffer, 0, aligned.byteLength >> 2);
}

export async function buildTracks(opts: {
  sourceDir: string;
  outDir: string;
  urlPrefix?: string;
  log?: (msg: string) => void;
}): Promise<TrackManifest> {
  const { sourceDir, outDir, urlPrefix = '/tracks', log = console.log } = opts;
  const sources = parseTrackSources(JSON.parse(readFileSync(join(sourceDir, 'tracks.json'), 'utf8')));
  mkdirSync(outDir, { recursive: true });
  const tracks: TrackEntry[] = [];

  for (const s of sources) {
    const srcFile = join(sourceDir, s.file);
    if (!existsSync(srcFile)) throw new Error(`Track "${s.id}": missing audio file ${srcFile}`);
    const dir = join(outDir, s.id);
    mkdirSync(dir, { recursive: true });
    const mtime = statSync(srcFile).mtimeMs;
    const metaPath = join(dir, 'meta.json');
    let meta: Meta | null = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as Meta) : null;
    const fresh =
      meta?.sourceMtimeMs === mtime && ['audio.m4a', 'waveform.bin', 'overview.bin'].every((f) => existsSync(join(dir, f)));

    if (fresh) {
      log(`• ${s.id}: up to date`);
    } else {
      log(`• ${s.id}: encoding + analyzing…`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', srcFile, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', join(dir, 'audio.m4a')]);
      const mono = decodeMono(srcFile);
      const { detail, overview } = analyzeWaveform(mono, ANALYSIS_RATE);
      writeFileSync(join(dir, 'waveform.bin'), encodeWaveform(detail));
      writeFileSync(join(dir, 'overview.bin'), encodeWaveform(overview));
      meta = { sourceMtimeMs: mtime, durationSec: mono.length / ANALYSIS_RATE, sampleRate: ffprobeSampleRate(srcFile) };
      writeFileSync(metaPath, JSON.stringify(meta));
    }

    let artworkUrl: string | null = null;
    let artworkSmallUrl: string | null = null;
    if (s.artwork) {
      const art = join(sourceDir, s.artwork);
      if (!existsSync(art)) throw new Error(`Track "${s.id}": missing artwork ${art}`);
      const big = join(dir, 'artwork.jpg');
      const small = join(dir, 'artwork-128.jpg');
      if (!fresh || !existsSync(big) || statSync(big).mtimeMs < statSync(art).mtimeMs) {
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', art, '-vf', 'scale=500:500', '-q:v', '3', big]);
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', art, '-vf', 'scale=128:128', '-q:v', '4', small]);
      }
      artworkUrl = `${urlPrefix}/${s.id}/artwork.jpg`;
      artworkSmallUrl = `${urlPrefix}/${s.id}/artwork-128.jpg`;
    }

    tracks.push({
      id: s.id,
      title: s.title,
      artist: s.artist,
      bpm: s.bpm,
      key: s.key,
      firstBeatSec: s.firstBeatSec,
      memoryCues: s.memoryCues ?? [],
      surf: s.surf ?? false,
      durationSec: meta!.durationSec,
      sampleRate: meta!.sampleRate,
      audioUrl: `${urlPrefix}/${s.id}/audio.m4a`,
      artworkUrl,
      artworkSmallUrl,
      waveformUrl: `${urlPrefix}/${s.id}/waveform.bin`,
      overviewUrl: `${urlPrefix}/${s.id}/overview.bin`,
    });
  }

  const manifest: TrackManifest = { version: 1, tracks };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
```

- [ ] **Step 3: Run test** — `npx vitest run scripts/lib/pipeline.test.ts` → PASS.

- [ ] **Step 4: CLIs + content folder**

`scripts/build-tracks.ts`:
```ts
import { buildTracks } from './lib/pipeline';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const sourceDir = arg('source', 'content/tracks');
const outDir = arg('out', 'public/tracks');
const manifest = await buildTracks({ sourceDir, outDir });
console.log(`Built ${manifest.tracks.length} track(s) → ${outDir}`);
```

`scripts/ensure-tracks.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildTracks } from './lib/pipeline';
import { makeTestTracks } from './make-test-tracks';

const REAL = 'content/tracks';
const TEST = 'content/tracks-test';
const OUT = 'public/tracks';

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('✖ ffmpeg is required to build tracks. Install it (macOS: `brew install ffmpeg`) and retry.');
  process.exit(1);
}

const hasReal = (() => {
  try {
    const json = JSON.parse(readFileSync(`${REAL}/tracks.json`, 'utf8')) as { tracks?: unknown[] };
    return Array.isArray(json.tracks) && json.tracks.length > 0;
  } catch {
    return false;
  }
})();

if (hasReal) {
  await buildTracks({ sourceDir: REAL, outDir: OUT });
} else {
  if (!existsSync(`${TEST}/tracks.json`)) {
    console.log('No tracks in content/tracks yet — synthesizing placeholder tracks…');
    await makeTestTracks(TEST);
  }
  await buildTracks({ sourceDir: TEST, outDir: OUT });
}
```

Note: switching from test tracks to real tracks leaves stale test folders in `public/tracks/`; they're harmless (not in the manifest). `rm -rf public/tracks` cleans them.

`content/tracks/tracks.json`:
```json
{ "tracks": [] }
```

`content/tracks/README.md`:
```markdown
# Tracks

Drop WAV/AIFF masters and square artwork here, then list them in `tracks.json`:

    {
      "tracks": [{
        "id": "sunset-drive",
        "title": "Sunset Drive",
        "artist": "Zach Farrell",
        "file": "sunset-drive.wav",
        "artwork": "sunset-drive.jpg",
        "bpm": 124.0,
        "key": "8A",
        "firstBeatSec": 0.052,
        "memoryCues": [32, 96],
        "surf": true
      }]
    }

- `bpm` must be exact and constant; `firstBeatSec` is the time of the first downbeat.
- `key` uses Camelot notation (1A–12B). `memoryCues` are beat numbers counted from the first downbeat.
- `surf: true` adds the track to the surf game soundtrack.
- Run `npm run tracks` (also runs automatically before `npm run dev` / `npm run build`).
- Audio masters are git-ignored; only this JSON and artwork are committed.
- While this list is empty, synthesized placeholder tracks are used.
```

`package.json` scripts — add:
```json
"predev": "tsx scripts/ensure-tracks.ts",
"prebuild": "tsx scripts/ensure-tracks.ts",
"tracks": "tsx scripts/build-tracks.ts",
```

- [ ] **Step 5: Verify end to end**

Run: `npx tsx scripts/ensure-tracks.ts && cat public/tracks/manifest.json | head -30 && ls public/tracks/test-tidal`
Expected: manifest with 3 test tracks with durations ≈ 192.25 s (120 BPM), 186.06 s (124), 180.25 s (128) (`0.25 + 96*4*60/bpm`); folder contains `audio.m4a artwork.jpg artwork-128.jpg meta.json overview.bin waveform.bin`. Second run prints "up to date" for each.

Run: `npx vitest run && npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts content package.json
git commit -m "feat(pipeline): build AAC + waveform data and manifest; auto-run before dev/build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Browser smoke tests, README, push

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/foundation.spec.ts`, `README.md`

**Interfaces:**
- Consumes: routes `/`, `/surf`, `/dj`, `/dev/retro`; `window.__retroFrames`; `data-testid="mode-switch"`, `data-testid="mode-caption"`
- Produces: `tests/e2e/helpers.ts` → `trackConsoleErrors(page): () => string[]` for later e2e specs

- [ ] **Step 1: Install browsers** — `npx playwright install chromium`

- [ ] **Step 2: Config** — `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
});
```

- [ ] **Step 3: Helpers + tests**

`tests/e2e/helpers.ts`:
```ts
import type { Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions for the page's lifetime. */
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return () => errors.filter((e) => !e.includes('Download the React DevTools'));
}
```

`tests/e2e/foundation.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

test.describe('portal', () => {
  test('light by default, toggles to dark and starts the DJ booth', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    const toggle = page.getByRole('switch');
    await expect(page.getByTestId('mode-caption')).toHaveText(/SURF/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByText('PRESS START').click();
    await expect(page).toHaveURL(/\/dj$/);
    expect(errors()).toEqual([]);
  });

  test('follows the OS dark preference and Enter starts', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.getByTestId('mode-caption')).toHaveText(/DJ/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mode-caption')).toHaveText(/SURF/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/surf$/);
  });
});

test('mode switch jumps between experiences and persists', async ({ page }) => {
  await page.goto('/surf');
  await page.getByTestId('mode-switch').click();
  await expect(page).toHaveURL(/\/dj$/);
  expect(await page.evaluate(() => localStorage.getItem('zf-mode'))).toBe('dark');
  await page.getByTestId('mode-switch').click();
  await expect(page).toHaveURL(/\/surf$/);
});

test('retro renderer draws frames without errors', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/dev/retro');
  await page.waitForFunction(() => (window.__retroFrames ?? 0) > 30);
  expect(errors()).toEqual([]);
});

test('track manifest is served', async ({ request }) => {
  const res = await request.get('/tracks/manifest.json');
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.version).toBe(1);
  expect(json.tracks.length).toBeGreaterThan(0);
});
```

Note: `window.__retroFrames` is typed by the `declare global` in `RetroDemo.tsx`; if tsc complains in the test file, add `tests/e2e/globals.d.ts` with `interface Window { __retroFrames?: number }` inside `declare global {}` and `export {}`.

- [ ] **Step 4: Run** — `npm run test:e2e`
Expected: 5 passed. Fix any failure before continuing (use superpowers:systematic-debugging).

- [ ] **Step 5: README** — `README.md`

```markdown
# Zach Farrell — Surf by day, DJ by night

Two interactive experiences behind a light/dark switch:

- **Light mode → Surf** (`/surf`): a PS2-era surf game on an endless peeling reef wave.
- **Dark mode → DJ booth** (`/dj`): two fully functional CDJ-style decks and a 2-channel club mixer in a reactive low-poly club.

## Requirements

- Node 22+
- ffmpeg (`brew install ffmpeg`)

## Run it

    npm install
    npm run dev        # http://localhost:3000

The first `npm run dev` synthesizes placeholder tracks if `content/tracks/tracks.json` is empty.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (builds tracks first) |
| `npm run build && npm start` | Production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser smoke tests (Playwright) |
| `npm run typecheck` | TypeScript |
| `npm run tracks` | Rebuild audio + waveform data from `content/tracks` |

## Adding your tracks

See `content/tracks/README.md`.

## Layout

- `src/app` — routes (portal, `/surf`, `/dj`)
- `src/retro` — shared PS2 renderer and UI primitives
- `src/shared` — mode, input actions, track manifest + waveform codec
- `src/surf`, `src/dj` — the two experiences
- `scripts` — track pipeline
- `docs/superpowers` — design specs and implementation plans

## Credits

See `CREDITS.md` (third-party models, samples and libraries).
```

`CREDITS.md`:
```markdown
# Credits

Third-party assets and libraries used in this project. Added to as assets are integrated.

- three.js — MIT
- Fonts: Russo One, VT323 — SIL Open Font License (Google Fonts)
```

- [ ] **Step 6: Final verification** — `npm run typecheck && npm test && npm run build && npm run test:e2e` → all PASS.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "test: browser smoke tests; docs: README and credits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git branch -M main
git remote add origin https://github.com/zfarrell13/personal-website.git 2>/dev/null || git remote set-url origin https://github.com/zfarrell13/personal-website.git
git push -u origin main
```
Expected: push succeeds to the (previously empty) repo.
