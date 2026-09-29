/** setPointerCapture that never throws (synthetic events, already-released pointers). */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // not an active pointer — capture is an optimisation, not a requirement
  }
}

/** True when `pointerId` is known not to be captured by `el` any more (a stale owner). Unknown = false. */
export function captureLost(el: Element, pointerId: number): boolean {
  try {
    return typeof el.hasPointerCapture === 'function' && !el.hasPointerCapture(pointerId);
  } catch {
    return true;
  }
}

/** Only the primary button of a mouse starts a drag/press (touch/pen report button 0 anyway). */
export const isPrimary = (e: { pointerType: string; button: number }): boolean => e.pointerType !== 'mouse' || e.button === 0;
