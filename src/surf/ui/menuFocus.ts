/**
 * True when keyboard focus is on a button inside `root` other than the menu's
 * primary action, so a global Enter handler should leave native activation alone.
 */
export function otherButtonFocused(root: HTMLElement | null): boolean {
  const el = document.activeElement;
  return !!root && el instanceof HTMLButtonElement && root.contains(el) && el.dataset.primary !== 'true';
}
