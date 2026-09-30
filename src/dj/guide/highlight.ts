/** Attribute that makes a booth control glow (styled by HIGHLIGHT_CSS). Styling only: input is never blocked. */
export const HIGHLIGHT_ATTR = 'data-guide-hl';

export const HIGHLIGHT_CSS = `
[${HIGHLIGHT_ATTR}] { outline: 3px solid #ffc21a; outline-offset: 4px; animation: dj-guide-pulse 1.1s ease-in-out infinite; }
@keyframes dj-guide-pulse {
  0%, 100% { outline-color: rgba(255, 194, 26, 1); outline-offset: 4px; }
  50% { outline-color: rgba(255, 194, 26, 0.3); outline-offset: 8px; }
}
@media (prefers-reduced-motion: reduce) { [${HIGHLIGHT_ATTR}] { animation: none; } }
`;

/**
 * Marks the controls for the current step by data-testid. set() is cheap to call every frame: it
 * only touches elements that changed, so a pulse never restarts, and it picks up remounted controls.
 */
export class Highlighter {
  private marked = new Map<string, Element>();

  constructor(private readonly root: ParentNode) {}

  set(ids: readonly string[]): void {
    for (const [id, el] of this.marked) {
      if (!ids.includes(id)) {
        el.removeAttribute(HIGHLIGHT_ATTR);
        this.marked.delete(id);
      }
    }
    for (const id of ids) {
      const el = this.root.querySelector(`[data-testid="${id}"]`);
      const old = this.marked.get(id);
      if (el === old) continue;
      old?.removeAttribute(HIGHLIGHT_ATTR);
      if (el) {
        el.setAttribute(HIGHLIGHT_ATTR, '');
        this.marked.set(id, el);
      } else {
        this.marked.delete(id);
      }
    }
  }

  clear(): void {
    for (const el of this.marked.values()) el.removeAttribute(HIGHLIGHT_ATTR);
    this.marked.clear();
  }
}
