/**
 * WP4G: the words an inset graphic template draws when its text is empty. Without `legibility` (a legacy blueprint) the template's own fallback is drawn exactly as before (KEY POINT, an em
 * dash); on a blueprint with `legibility` an empty text draws no words. Pure.
 */
export function insetDisplayText(text: string, fallback: string, legible: boolean): string {
  return text || (legible ? '' : fallback);
}
