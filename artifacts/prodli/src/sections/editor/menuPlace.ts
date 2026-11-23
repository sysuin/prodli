// Where to put a menu that opens at the cursor (the / menu, the [[ note picker):
// below the line if it fits, otherwise above it, never off-screen.

export interface Anchor {
  left: number;
  /** Top and bottom of the line the cursor is on (viewport px). */
  top: number;
  bottom: number;
}

export function placeMenu(anchor: Anchor, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 6): { left: number; top: number } {
  const left = Math.max(8, Math.min(anchor.left, viewport.width - size.width - 8));
  const below = anchor.bottom + gap;
  if (below + size.height <= viewport.height - 8) return { left, top: below };
  const above = anchor.top - gap - size.height;
  if (above >= 8) return { left, top: above };
  // Neither fits fully: use the side with more room.
  return { left, top: viewport.height - anchor.bottom > anchor.top ? below : 8 };
}
