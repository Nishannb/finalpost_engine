/**
 * Region geometry: safe areas and simple rect splitting. All values are pixels
 * inside the graphic's own region (0,0 is its top-left corner).
 */

/** Insets the editor reserves (captions, platform UI, split seam). Px from each edge of the region. */
export type SafeArea = {top: number; right: number; bottom: number; left: number};

export type Rect = {x: number; y: number; width: number; height: number};

export const NO_SAFE_AREA: SafeArea = {top: 0, right: 0, bottom: 0, left: 0};

/** The rectangle where important content should go: region minus safe area minus extra padding. */
export function contentBox(width: number, height: number, safeArea: SafeArea = NO_SAFE_AREA, padding = 0): Rect {
  const x = safeArea.left + padding;
  const y = safeArea.top + padding;
  return {
    x,
    y,
    width: Math.max(1, width - x - safeArea.right - padding),
    height: Math.max(1, height - y - safeArea.bottom - padding),
  };
}

/** n equal rects side by side inside `rect`. */
export function splitRow(rect: Rect, n: number, gap = 0): Rect[] {
  const w = (rect.width - gap * (n - 1)) / Math.max(1, n);
  return Array.from({length: n}, (_, i) => ({x: rect.x + i * (w + gap), y: rect.y, width: w, height: rect.height}));
}

/** n equal rects stacked top to bottom inside `rect`. */
export function splitColumn(rect: Rect, n: number, gap = 0): Rect[] {
  const h = (rect.height - gap * (n - 1)) / Math.max(1, n);
  return Array.from({length: n}, (_, i) => ({x: rect.x, y: rect.y + i * (h + gap), width: rect.width, height: h}));
}

/** Takes a slice off the top of a rect: returns [slice, rest]. `size` ≤ 1 is a fraction of the height, > 1 is px. */
export function sliceTop(rect: Rect, size: number, gap = 0): [Rect, Rect] {
  const h = size <= 1 ? rect.height * size : size;
  return [
    {x: rect.x, y: rect.y, width: rect.width, height: h},
    {x: rect.x, y: rect.y + h + gap, width: rect.width, height: Math.max(1, rect.height - h - gap)},
  ];
}

export function center(rect: Rect): {x: number; y: number} {
  return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}

/** Region orientation hint: lay things out in a row when the region is wide. */
export function isWide(width: number, height: number): boolean {
  return width >= height * 0.9;
}
