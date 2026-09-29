/** setPointerCapture that never throws (synthetic events, already-released pointers). */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // not an active pointer — capture is an optimisation, not a requirement
  }
}
