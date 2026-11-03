/**
 * WP3H: when the speaker could not be detected (occupancy source `fallback`), the pipeline holds a conservative DEFAULT box (x .18, y .16, w .64, h .62). That box is not where the
 * speaker is. `legalSlots` used to subtract it from every accent slot, so with the default box NO accent slot survived ("no legal slots", Phase 34), and the Director was told to
 * use none. On the `mvp` profile the unknown face is no longer subtracted. Unknown stays unknown: no face rectangle is invented and nothing is placed because a face is "elsewhere".
 *
 * What stays usable is decided by what IS known: an accent slot must be clear of the caption band, must start below the top safe inset the mvp hook uses (HOOK.topFrac, the platform-UI
 * inset), and must lie inside the safe frame. Hero slots are unchanged (legacy keeps them whatever the box). A measured face (source `vision`) and every legacy profile are untouched.
 *
 * Pure (a type import only): no logger, `.env` or network.
 */
import {isMvpLikeProfile, type ProductEditProfile} from '../../lib/productEditProfile.ts';
import {carryProvenance} from '../../lib/provenance.ts';
import type {Occupancy} from './occupancy.ts';

type Rect = {x: number; y: number; w: number; h: number};
type SlotLike = {rect: Rect; size: 'accent' | 'hero'};

/** Mirrors CAPTION_BAND in occupancy.ts (that module imports the logger; a test compares the two sources). */
export const UNMEASURED_CAPTION_BAND: Rect = {x: 0, y: 0.76, w: 1, h: 0.24};
/** The top inset the mvp hook starts below: HOOK.topFrac in stages/broll/legibility.ts. Copied, not imported, so the legacy-reachable occupancy module does not load the mvp legibility module (a test compares the two). */
export const UNMEASURED_TOP_INSET = 0.06;
/** Mirrors SAFE_FRAME in lib/editConflicts.ts (a test compares the sources). */
export const UNMEASURED_SAFE_FRAME: Rect = {x: 0.03, y: 0.04, w: 0.94, h: 0.93};
const EPS = 1e-9;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

function insideSafeFrame(rect: Rect): boolean {
  const f = UNMEASURED_SAFE_FRAME;
  return rect.x >= f.x - EPS && rect.y >= f.y - EPS && rect.x + rect.w <= f.x + f.w + EPS && rect.y + rect.h <= f.y + f.h + EPS;
}

/** The slots that stay usable when the face is unmeasured. Order and identity of the kept slots are preserved. */
export function usableSlotsWithUnmeasuredFace<T extends SlotLike>(candidates: readonly T[]): T[] {
  return candidates.filter(slot => {
    if (slot.size === 'hero') return true;
    if (overlaps(slot.rect, UNMEASURED_CAPTION_BAND)) return false;
    if (slot.rect.y < UNMEASURED_TOP_INSET - EPS) return false;
    return insideSafeFrame(slot.rect);
  });
}

/** True only for the mvp profile and a default (undetected) box. */
export function unmeasuredPolicyApplies(source: Occupancy['source'], profile: ProductEditProfile | undefined): boolean {
  return isMvpLikeProfile(profile) && source === 'fallback';
}

/** Marks the occupancy object so every `legalSlots` caller applies the policy. A measured face, or any other profile, returns the same object and no warning. */
export function markUnmeasuredFace(occupancy: Occupancy, profile: ProductEditProfile | undefined): {occupancy: Occupancy; warnings: string[]} {
  if (!unmeasuredPolicyApplies(occupancy.source, profile)) return {occupancy, warnings: []};
  return {occupancy: {...occupancy, unmeasuredSlots: true}, warnings: ['occupancy_unmeasured']};
}

// ---- WP3I: the layout critique must not treat the default box as a face -----------------------------------------------------------------------------------------------------
/**
 * False for an occupancy marked unmeasured (mvp, undetected speaker): its `speaker` is a default, not a face. Every other occupancy (a measured face, any legacy one) is true, so the
 * layout critique behaves as before. These helpers hold the DECISIONS; the legacy expressions they replace are reproduced exactly (including for NaN) and pinned by tests.
 */
export function boxCountsAsFace(occupancy: Pick<Occupancy, 'source' | 'unmeasuredSlots'>): boolean {
  return !(occupancy.unmeasuredSlots && occupancy.source === 'fallback');
}

/**
 * Legacy: a graphic is re-anchored unless `overlap <= 0.03` and it is not centred. Unmeasured (WP3J): the layout critique never re-anchors a graphic, a centred one included: where
 * the face is, is unknown, so nothing is moved "away from" it. (WP3I kept the centre rule; WP3J removes it on request.)
 */
export function graphicNeedsMove(input: {boxIsFace: boolean; overlapWithBox: number; anchor: string}): boolean {
  if (!input.boxIsFace) return false;
  return !(input.overlapWithBox <= 0.03 && input.anchor !== 'center');
}

/** Legacy: emphasis is re-anchored unless `overlap <= 0.03`. Unmeasured: never because of the box. */
export function emphasisNeedsMove(input: {boxIsFace: boolean; overlapWithBox: number}): boolean {
  if (!input.boxIsFace) return false;
  return !(input.overlapWithBox <= 0.03);
}

/** Legacy issue tests are `overlap > threshold`. Unmeasured: the box produces no issue. */
export function boxOverlapIsIssue(input: {boxIsFace: boolean; overlapWithBox: number; threshold: number}): boolean {
  return input.boxIsFace && input.overlapWithBox > input.threshold;
}

// ---- WP3J: the vision critique and the compositor -----------------------------------------------------------------------------------------------------------------------
/** The vision critique sends the speaker box to Gemini as the speaker and applies patches re-anchoring graphics from it. With no measured face it must not run at all (no request). */
export function visionCritiqueMayRun(occupancy: Pick<Occupancy, 'source' | 'unmeasuredSlots'>): boolean {
  return boxCountsAsFace(occupancy);
}

/**
 * The compositor rewrites a graphic whose anchor is unsafe. Legacy: `center`, `top` and `bottom` (full-width and central placements are assumed to hit a talking head). Unmeasured
 * (WP3K): none is unsafe. Where the face is, is unknown, so the Director's own anchor stays, `top`, `bottom` and `center` included. (WP3J had still rewritten top and bottom.)
 */
export function composerGraphicAnchorIsUnsafe(input: {boxIsFace: boolean; anchor: string}): boolean {
  if (!input.boxIsFace) return false;
  return input.anchor === 'center' || input.anchor === 'top' || input.anchor === 'bottom';
}

/** Legacy `overlapArea(slot, speaker) > 0.04` (a pip slot on the speaker). Unmeasured: the box blocks nothing. */
export function pipSlotBlockedByBox(input: {boxIsFace: boolean; overlapWithBox: number}): boolean {
  return input.boxIsFace && input.overlapWithBox > 0.04;
}

/** Legacy `overlapArea(slot, speaker) < 0.04` (a pip slot clear of the speaker). Unmeasured: the box is no evidence, so the slot is not rejected for it. */
export function pipSlotClearOfBox(input: {boxIsFace: boolean; overlapWithBox: number}): boolean {
  return !input.boxIsFace || input.overlapWithBox < 0.04;
}

/** Legacy `speaker.y > 0.3` allowing a top caption. Unmeasured: unknown, so no top caption is allowed (the same result the default box gave, without reading it). */
export function topCaptionAllowed(input: {boxIsFace: boolean; speakerY: number}): boolean {
  return input.boxIsFace && input.speakerY > 0.3;
}

// ---- WP3K: no side and no anchor from the default box -------------------------------------------------------------------------------------------------------------
/**
 * The anchor used when nothing says where to put something and the face is unmeasured: the top safe area the mvp hook already uses, centred, so it names no side. It is a valid
 * anchor of both the motion and the visual vocabularies. (`occupancy.graphicAnchor` / `overlayAnchor` / `preferredSide` are derived from the default box, which is symmetric, so they
 * are always right / top_right and must not be used for an unmeasured face.)
 */
export const UNMEASURED_NEUTRAL_ANCHOR = 'top' as const;

/** The Director's own anchor when it gave one; otherwise the neutral top anchor. Used only for an unmeasured face; a face keeps the legacy choice. */
export function directorAnchorOrNeutral<A extends string>(given: A | '' | null | undefined): A | typeof UNMEASURED_NEUTRAL_ANCHOR {
  return given ? given : UNMEASURED_NEUTRAL_ANCHOR;
}

// ---- WP3L: what `top` means when the face is unmeasured ------------------------------------------------------------------------------------------------------------------
/**
 * The renderer and the validator do not agree on `top`: MotionGraphicTrack draws it in the left column, SemanticEmphasisTrack on the right, VisualOverlayTrack's stack and bubble on
 * the left, and `slotRectForAnchor('top')` / `kineticTextRect` give the left column while `emphasisRect` gives the right. None draws a centred top placement. So for an unmeasured face
 * `top` is given ONE meaning, the top safe band the mvp hook uses (below the 0.06 inset, full width inside the safe frame, naming no side), and is then converted, before the validator
 * and the renderer see it, to the top corner placement every component already draws. The side is not taken from the default box: it goes to a side that no other top-corner
 * element occupies at that time, and otherwise alternates (left first), so neither side is favoured. A measured face and the legacy profile never go through this.
 */
export const UNMEASURED_TOP_BAND: Rect = {x: 0.03, y: UNMEASURED_TOP_INSET, w: 0.94, h: 0.16};

type TimedAnchor = {start: number; end: number; anchor?: string};
/** The overlay layouts whose `anchor` decides where they are drawn (the others are full-frame or half-frame media and ignore it). */
const ANCHORED_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['card', 'pip', 'sticker', 'lockup', 'chip', 'banner', 'stat', 'bubble']);

/**
 * For each `top` element (in time order) the corner it is drawn in. `null` for elements that are not `top`. Pure and deterministic.
 */
export function topBandSides(items: ReadonlyArray<TimedAnchor>): Array<'top_left' | 'top_right' | null> {
  const result: Array<'top_left' | 'top_right' | null> = items.map(() => null);
  const placed: Array<{start: number; end: number; side: 'top_left' | 'top_right'}> = [];
  items.forEach(item => {
    if (item.anchor === 'top_left' || item.anchor === 'top_right') placed.push({start: item.start, end: item.end, side: item.anchor});
  });
  const order = items.map((item, index) => ({item, index})).filter(entry => entry.item.anchor === 'top').sort((a, b) => a.item.start - b.item.start || a.index - b.index);
  let turn = 0;
  for (const {item, index} of order) {
    const busy = (side: 'top_left' | 'top_right') => placed.some(other => other.side === side && other.start < item.end && item.start < other.end);
    const leftBusy = busy('top_left');
    const rightBusy = busy('top_right');
    let side: 'top_left' | 'top_right';
    if (leftBusy !== rightBusy) side = leftBusy ? 'top_right' : 'top_left';
    else {
      side = turn % 2 === 0 ? 'top_left' : 'top_right';
      turn += 1;
    }
    result[index] = side;
    placed.push({start: item.start, end: item.end, side});
  }
  return result;
}

/**
 * Converts every `top` graphic, emphasis and anchored overlay to a top corner (see above). Elements that are not `top` are returned as the same objects. Rebuilt elements keep their
 * provenance and ledger identity (own enumerable properties, including the ledger's symbol key, are copied by the spread). Nothing else about an element changes.
 */
export function resolveTopAnchors<G extends TimedAnchor, E extends TimedAnchor, O extends TimedAnchor & {layout?: string}>(input: {
  motionGraphics: readonly G[];
  semanticEmphasis: readonly E[];
  overlays: readonly O[];
}): {motionGraphics: G[]; semanticEmphasis: E[]; overlays: O[]; converted: number} {
  const eligibleOverlay = (overlay: O) => ANCHORED_OVERLAY_LAYOUTS.has(String(overlay.layout));
  const all: TimedAnchor[] = [
    ...input.motionGraphics,
    ...input.semanticEmphasis,
    ...input.overlays.map(overlay => (eligibleOverlay(overlay) ? overlay : {start: overlay.start, end: overlay.end, anchor: undefined})),
  ];
  const sides = topBandSides(all);
  let converted = 0;
  const g = input.motionGraphics.length;
  const e = input.semanticEmphasis.length;
  const rebuild = <T extends TimedAnchor>(item: T, side: 'top_left' | 'top_right' | null): T => {
    if (!side) return item;
    converted += 1;
    return carryProvenance(item, {...item, anchor: side});
  };
  return {
    motionGraphics: input.motionGraphics.map((item, i) => rebuild(item, sides[i]!)),
    semanticEmphasis: input.semanticEmphasis.map((item, i) => rebuild(item, sides[g + i]!)),
    overlays: input.overlays.map((item, i) => rebuild(item, sides[g + e + i]!)),
    converted,
  };
}

// ---- WP3N: the speaker box handed to the motion stage ------------------------------------------------------------------------------------------------------------------
type Box = {x: number; y: number; w: number; h: number};

/**
 * What the motion stage is told about the speaker. A face (measured, or any occupancy not marked unmeasured, which includes the whole legacy profile) passes the box exactly as
 * before. An unmeasured face passes NO box and says so: the default box is not a speaker, and a prompt or a placement decision built from it would treat it as one.
 */
export function speakerForMotion(occupancy: Pick<Occupancy, 'source' | 'unmeasuredSlots' | 'speaker'>): {speakerBox: Box} | {speakerUnknown: true} {
  return boxCountsAsFace(occupancy) ? {speakerBox: occupancy.speaker} : {speakerUnknown: true};
}

/** The motion Director prompt line about the speaker. The box line is the original text, character for character; unknown gives no coordinates. */
export function motionSpeakerLine(input: {speakerBox?: Box; speakerUnknown?: boolean}): string {
  if (input.speakerUnknown) return 'The speaker position is UNKNOWN (detection failed). No speaker box is given; do not assume where the speaker is.';
  const fmt = (value: number) => value.toFixed(2);
  return input.speakerBox ? `Speaker box (frame fractions): x=${fmt(input.speakerBox.x)} y=${fmt(input.speakerBox.y)} w=${fmt(input.speakerBox.w)} h=${fmt(input.speakerBox.h)}.` : '';
}
