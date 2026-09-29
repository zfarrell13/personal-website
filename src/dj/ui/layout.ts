/** Native size of the booth (CDJ 460 + gap + DJM 420 + gap + CDJ 460). */
export const BOOTH_W = 1380;
export const BOOTH_H = 900;
/** Space kept free at the top for the VIEW / SETTINGS / mode buttons. */
export const HUD_H = 64;
export const PANEL_SIZES = [
  { w: 460, h: 900 },
  { w: 420, h: 900 },
  { w: 460, h: 900 },
] as const;

/** Uniform scale that fits `w × h` content into the viewport with a margin. */
export function fitScale(contentW: number, contentH: number, viewW: number, viewH: number, margin = 16): number {
  return Math.max(0.2, Math.min((viewW - margin * 2) / contentW, (viewH - margin * 2) / contentH));
}

/** Mobile layout: phones in landscape (or narrow screens) get the 3 swipeable panels. */
export const isCompact = (viewW: number, viewH: number): boolean => viewW < 900 || viewH < 520;

/** Which panel is centred after a horizontal scroll (scroll-snap). */
export const panelAt = (scrollLeft: number, panelWidth: number): 0 | 1 | 2 =>
  Math.min(2, Math.max(0, Math.round(scrollLeft / Math.max(1, panelWidth)))) as 0 | 1 | 2;

/**
 * Phone panels stay at native size so every control keeps a full-size touch target; a panel only
 * shrinks when it is wider than the screen. Taller panels scroll vertically inside their slot.
 */
export const compactPanelScale = (panelW: number, viewW: number, margin = 8): number => Math.min(1, (viewW - margin * 2) / panelW);
