/** True when a key press belongs to a text field (Backspace deletes, Esc may clear it). */
export function typingInField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
  );
}

/**
 * Esc or Backspace meaning "back to the site's title menu": not held (repeat), not with a modifier
 * (Alt+Backspace, browser shortcuts), not typed into a field. `defaultPrevented` is left to the caller:
 * on /surf the game's own key listener always prevents Esc (a bound key), so it means nothing there.
 */
export function isBackToMenuKey(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' && e.key !== 'Backspace') return false;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return !typingInField(e.target) && !typingInField(document.activeElement);
}
