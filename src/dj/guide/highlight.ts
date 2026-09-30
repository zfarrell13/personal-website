/** Attribute that makes a booth control glow (styled by HIGHLIGHT_CSS). Styling only: input is never blocked. */
export const HIGHLIGHT_ATTR = 'data-guide-hl';

/*
 * A ring drawn by ::after, not the control's own outline/animation: blinking LED buttons animate their
 * box-shadow and focused controls swap their outline, and either would hide or stop a pulse set on the
 * element. The ring ignores pointer events. Doubled attribute = specificity above `.btn[data-x]` rules.
 * None of the highlighted controls is absolutely positioned, so position: relative never moves one.
 */
const SEL = `[${HIGHLIGHT_ATTR}][${HIGHLIGHT_ATTR}]`;
export const HIGHLIGHT_CSS = `
${SEL} { position: relative; }
${SEL}::after {
  content: '';
  position: absolute;
  inset: -6px;
  border: 3px solid #ffc21a;
  border-radius: inherit;
  box-shadow: 0 0 14px rgba(255, 194, 26, 0.6);
  pointer-events: none;
  z-index: 1;
  animation: dj-guide-pulse 1.1s ease-in-out infinite;
}
@keyframes dj-guide-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) { ${SEL}::after { animation: none; } }
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
