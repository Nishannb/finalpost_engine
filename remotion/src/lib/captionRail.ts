/**
 * WP4I: keep a centered caption line clear of the platform button rail (like / comment / share) on the right. Pure.
 *
 * The conflict validator treats the right-hand rail as starting at x = 0.86 of the width (`PLATFORM_RAIL` in server/src/lib/editConflicts.ts). A caption centered on the frame ends at
 * `0.5 + maxWidth / 2`, so it stays at or before the rail when `maxWidth <= 2 * (railX - 0.5)`. `CAPTION_RAIL_X` is a copy of that server constant (the renderer cannot import server code);
 * a test asserts the two are equal, so there is no second, different rail.
 */
export const CAPTION_RAIL_X = 0.86;

/** Widest centered caption (fraction of the frame width) that ends at or before the rail: 2 * (railX - 0.5). */
export const CAPTION_RAIL_MAX_WIDTH_FRAC = Math.round(2 * (CAPTION_RAIL_X - 0.5) * 1e6) / 1e6;

/** `frac` as is, or capped at the rail-clear width when `railClear` (blueprints with `legibility.captions`). A width at or under the cap is returned unchanged. */
export function captionMaxWidthFrac(frac: number, railClear: boolean): number {
  return railClear ? Math.min(frac, CAPTION_RAIL_MAX_WIDTH_FRAC) : frac;
}

/** The same cap as a CSS percentage string (`'88%'` stays `'88%'` unless it is capped): for `maxWidth` values written as percentages. */
export function captionMaxWidthPercent(frac: number, railClear: boolean): string {
  return `${Math.round(captionMaxWidthFrac(frac, railClear) * 10000) / 100}%`;
}

/**
 * WP4J: the width fraction for a caption block centered on `centerXFrac` (translateX(-50%)), so its right edge ends at or before the rail: `2 * (railX - centerX)`, never more than the
 * template's own `templateFrac`. At center 0.5 this is the same 0.72 cap. With the flag off, a non-finite center, or a non-positive allowance (a center at or past the rail) the template's
 * own fraction is kept, rather than a zero-width line.
 */
export function captionRailWidthFrac(templateFrac: number, centerXFrac: number, railClear: boolean): number {
  if (!railClear) return templateFrac;
  const allowance = 2 * (CAPTION_RAIL_X - centerXFrac);
  if (!Number.isFinite(allowance) || allowance <= 0) return templateFrac;
  return Math.min(templateFrac, Math.round(allowance * 1e6) / 1e6);
}
