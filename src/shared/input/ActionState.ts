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
  private initialized = false;

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
    if (this.initialized) {
      this.pressedNow = new Set(this.pendingPress);
      for (const a of this.cur) if (!this.prev.has(a)) this.pressedNow.add(a);
      this.releasedNow = new Set(this.pendingRelease);
      for (const a of this.prev) if (!this.cur.has(a)) this.releasedNow.add(a);
    } else {
      this.pressedNow.clear();
      this.releasedNow.clear();
      for (const a of this.cur) this.pressedNow.add(a);
    }
    this.pendingPress.clear();
    this.pendingRelease.clear();
    this.initialized = true;
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
