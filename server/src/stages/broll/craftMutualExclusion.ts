/**
 * WP52: offline craft gates for the polish path (pure, no env, no IO). Each function maps one FAIL from the test2 live burn to a deterministic rule:
 *   B dropBubbleOverlays        - ChatBubbleStack scatter chips never ship on polish
 *   D dropDoubleStatEmphasis / dedupeStatKinetic - the same number is never stated twice on overlapping time
 *   E refuseOverlappingImages / capRepeatedPlateStyle / paletteRepeats - no random sticker stacks, no identical black cards back to back
 *   F clampStickyEnds           - a graphic never outlives its spoken beat or the next plate
 * The analyzeVideo wiring only calls these and forwards their warnings.
 */

export type CraftSpan = {id: string; start: number; end: number};
export type CraftGraphic = CraftSpan & {compositionId?: string; text: string};

/** Overlay on screen with one of these compositions states a claim; a second statement of the same number on the same window is a double-stat. */
const CLAIM_COMPOSITIONS: ReadonlySet<string> = new Set(['StatHighlight', 'WikiCallout', 'NewspaperCallout', 'TweetCard', 'BigKineticHeadline']);
const EMPHASIS_STAT_TREATMENTS: ReadonlySet<string> = new Set(['count', 'pop']);
const EPS = 0.02;

const overlaps = (a: {start: number; end: number}, b: {start: number; end: number}): boolean => a.start < b.end - EPS && b.start < a.end - EPS;

const normalizePhrase = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "10,000" -> "10000", "$1.5 billion" -> "1.5". Digits only; word numbers are compared as phrases. */
export function craftNumbers(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(token => token.replace(/,/g, '')).filter(Boolean);
}

/** True when two on-screen texts state the same number, or one normalized phrase contains the other (>= 2 chars). */
export function statesSameClaim(a: string, b: string): boolean {
  const na = craftNumbers(a);
  const nb = craftNumbers(b);
  if (na.length > 0 && nb.length > 0 && na.some(n => nb.includes(n))) return true;
  const pa = normalizePhrase(a);
  const pb = normalizePhrase(b);
  if (pa.length < 2 || pb.length < 2) return false;
  return pa === pb || (pa.length >= 4 && pb.includes(pa)) || (pb.length >= 4 && pa.includes(pb));
}

/** B: layout === 'bubble' overlays are dropped on polish. Returns the kept list and a count for `polish_craft:bubble_banned:<n>`. */
export function dropBubbleOverlays<T extends {layout: string}>(overlays: readonly T[]): {kept: T[]; dropped: number} {
  const kept = overlays.filter(overlay => overlay.layout !== 'bubble');
  return {kept, dropped: overlays.length - kept.length};
}

/** D: drop count/pop semanticEmphasis that restates a number / phrase a claim graphic already shows on an overlapping window. */
export function dropDoubleStatEmphasis<E extends {start: number; end: number; text: string; treatment: string}>(
  graphics: readonly CraftGraphic[],
  emphasis: readonly E[],
): {kept: E[]; warnings: string[]} {
  const warnings: string[] = [];
  const claims = graphics.filter(graphic => graphic.compositionId && CLAIM_COMPOSITIONS.has(graphic.compositionId));
  const kept = emphasis.filter(item => {
    if (!EMPHASIS_STAT_TREATMENTS.has(item.treatment)) return true;
    const clash = claims.find(graphic => overlaps(graphic, item) && statesSameClaim(graphic.text, item.text));
    if (!clash) return true;
    warnings.push(`polish_craft:double_stat_dropped:${craftNumbers(item.text)[0] ?? clash.id}`);
    return false;
  });
  return {kept, warnings};
}

/** D: BigKineticHeadline and StatHighlight never share time for the same number; the StatHighlight (the designed stat plate) wins. */
export function dedupeStatKinetic(graphics: readonly CraftGraphic[]): {dropIds: string[]; warnings: string[]} {
  const dropIds: string[] = [];
  const warnings: string[] = [];
  const stats = graphics.filter(graphic => graphic.compositionId === 'StatHighlight');
  for (const big of graphics.filter(graphic => graphic.compositionId === 'BigKineticHeadline')) {
    const clash = stats.find(stat => overlaps(stat, big) && statesSameClaim(stat.text, big.text));
    if (!clash) continue;
    dropIds.push(big.id);
    warnings.push(`polish_craft:double_stat_dropped:${craftNumbers(big.text)[0] ?? big.id}`);
  }
  return {dropIds, warnings};
}

export const CLAMP_HOLD_SEC = 0.35;
export const CLAMP_MIN_SEC = 0.4;

/**
 * F: end = min(declaredEnd, nextBoundary - epsilon, spokenEnd + <=0.35 s hold). Boundaries are the next layout change / plate start strictly after the item's start. A clamp that would leave the item
 * shorter than CLAMP_MIN_SEC is not applied (the item is left alone rather than killed).
 */
export function clampStickyEnds<T extends CraftSpan>(
  items: readonly T[],
  options: {boundaries: readonly number[]; spokenEndOf?: (item: T) => number | undefined; epsilon?: number},
): {items: T[]; warnings: string[]} {
  const epsilon = options.epsilon ?? 0.04;
  const warnings: string[] = [];
  const out = items.map(item => {
    let end = item.end;
    const next = options.boundaries.filter(boundary => boundary > item.start + CLAMP_MIN_SEC).sort((a, b) => a - b)[0];
    if (next !== undefined) end = Math.min(end, next - epsilon);
    const spoken = options.spokenEndOf?.(item);
    if (spoken !== undefined && Number.isFinite(spoken)) end = Math.min(end, spoken + CLAMP_HOLD_SEC);
    if (end < item.end - 1e-6 && end - item.start >= CLAMP_MIN_SEC) {
      warnings.push(`polish_craft:end_clamped:${item.id}`);
      return {...item, end: Math.round(end * 1000) / 1000};
    }
    return item;
  });
  return {items: out, warnings};
}

export type CraftImageOverlay = CraftSpan & {layout: string; mediaKind: string; provider?: string};
const SMALL_IMAGE_LAYOUTS: ReadonlySet<string> = new Set(['pip', 'sticker', 'card']);

/**
 * E: two image overlays never overlap in time and a small image (pip / sticker / card) never sits on a full-screen still. `fullScreen` are the blocked ranges of full-screen stills / plates. The earlier
 * (or full-screen) overlay is kept; the later weaker one is refused. Returns `polish_craft:overlap_refused` per refusal.
 */
export function refuseOverlappingImages<T extends CraftImageOverlay>(overlays: readonly T[], fullScreen: ReadonlyArray<{start: number; end: number}>): {kept: T[]; refusedIds: string[]; warnings: string[]} {
  const refusedIds: string[] = [];
  const kept: T[] = [];
  const isImage = (overlay: T) => overlay.mediaKind === 'image' || overlay.mediaKind === 'video';
  const ordered = [...overlays].sort((a, b) => a.start - b.start);
  for (const overlay of ordered) {
    const small = isImage(overlay) && SMALL_IMAGE_LAYOUTS.has(overlay.layout);
    const onHero = small && fullScreen.some(range => overlaps(range, overlay));
    const stacked = isImage(overlay) && kept.some(other => isImage(other) && overlaps(other, overlay) && (SMALL_IMAGE_LAYOUTS.has(other.layout) || SMALL_IMAGE_LAYOUTS.has(overlay.layout)));
    if (onHero || stacked) refusedIds.push(overlay.id);
    else kept.push(overlay);
  }
  return {kept, refusedIds, warnings: refusedIds.map(() => 'polish_craft:overlap_refused')};
}

export type CraftPlate = CraftSpan & {style: string};
/** Styles that are "black ground + centred rounded still + top label": at most one per window before the next leave-the-face beat must differ. */
export const BLACK_CARD_STYLES: ReadonlySet<string> = new Set(['explainer_text_plate', 'cadence_plate_full', 'text_plate', 'explainer_d']);

/** E: ids of plates to demote (switch toolkit) because they repeat a black-card style inside `windowSec` of the previous kept one. */
export function capRepeatedPlateStyle(plates: readonly CraftPlate[], windowSec = 12): string[] {
  const demote: string[] = [];
  let lastKept: CraftPlate | undefined;
  for (const plate of [...plates].sort((a, b) => a.start - b.start)) {
    if (!BLACK_CARD_STYLES.has(plate.style)) continue;
    if (lastKept && plate.start - lastKept.start < windowSec) demote.push(plate.id);
    else lastKept = plate;
  }
  return demote;
}

/** E: count of full-screen plates of the same style that abut with (almost) no cut between them -> `polish_craft:palette_repeat:<n>`. */
export function paletteRepeats(plates: readonly CraftPlate[], gapSec = 0.1): string[] {
  const ordered = [...plates].sort((a, b) => a.start - b.start);
  let count = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.style === ordered[i - 1]!.style && ordered[i]!.start - ordered[i - 1]!.end <= gapSec) count += 1;
  return count > 0 ? [`polish_craft:palette_repeat:${count}`] : [];
}
