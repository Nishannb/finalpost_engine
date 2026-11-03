/**
 * WP8W: ENGAGEMENT CADENCE CONTRACT. A polish edit should alternate the face with a designed beat about every `SEC_PER_ENGAGE` seconds, not stack text on the face. PURE: no env, no logger, no I/O.
 *
 * The clip is cut into consecutive windows of `SEC_PER_ENGAGE` (8 s: a little tighter than the 9 s `SEC_PER_BEAT` of the polish fill, so one beat per window leaves no long stretch of plain face;
 * a trailing window shorter than `MIN_TAIL_WINDOW_SEC` is merged away, it is not judged). A window is COVERED only when a STRONG beat starts inside it:
 *   strong  cutaway / composite / media container (pip) / card, chip, banner, stat, sticker / lockup / bubble / split / frame inset / depth overlay / inset reveal
 *   weak    zoom punch-in, emphasis pop, kinetic text on the face, the hook title, captions (karaoke alone never covers a window)
 * `coveredBy` lets a caller add start times that live outside the direction (e.g. generated library graphics).
 */
import type {VisualDirection} from './geminiDirector.ts';
import {kindForMomentLayout} from './lookDirection.ts';

export const SEC_PER_ENGAGE = 8;
export const MIN_TAIL_WINDOW_SEC = 5;

/** Moment-layout kinds that count as a designed beat (matte-dependent `cutout` is not here: it needs a matte this contract never assumes). */
const STRONG_MOMENT_KINDS: ReadonlySet<string> = new Set(['cutaway', 'media_container', 'card', 'lockup', 'bubble', 'split']);

export type EngagementWindow = {index: number; start: number; end: number};

export function engagementWindows(outputDurationSec: number): EngagementWindow[] {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < SEC_PER_ENGAGE) return [];
  const full = Math.floor(outputDurationSec / SEC_PER_ENGAGE);
  const tail = outputDurationSec - full * SEC_PER_ENGAGE;
  const count = full + (tail >= MIN_TAIL_WINDOW_SEC ? 1 : 0);
  return Array.from({length: count}, (_, index) => ({index, start: index * SEC_PER_ENGAGE, end: Math.min(outputDurationSec, (index + 1) * SEC_PER_ENGAGE)}));
}

/** Start times of the strong beats of a direction (output time). */
export function strongBeatTimes(direction: VisualDirection): number[] {
  return [
    ...direction.moments.filter(moment => STRONG_MOMENT_KINDS.has(kindForMomentLayout(moment.layout))).map(moment => moment.timestamp),
    ...direction.mediaContainers.map(item => item.start),
    ...direction.frameInsets.map(item => item.start),
    ...direction.depthOverlays.map(item => item.start),
    ...(direction.insetReveals ?? []).map(item => item.start),
  ];
}

/** Windows no strong beat starts in. */
export function uncoveredEngagementWindows(direction: VisualDirection, outputDurationSec: number, coveredBy: readonly number[] = []): EngagementWindow[] {
  const times = [...strongBeatTimes(direction), ...coveredBy];
  return engagementWindows(outputDurationSec).filter(window => !times.some(time => time >= window.start && time < window.end));
}

/** True when the edit has no strong beat other than lockups: captions + zooms + face text only ("overlays on the talking head"). */
export function isFaceOverlayOnlyEdit(direction: VisualDirection): boolean {
  const nonLockup = direction.moments.filter(moment => STRONG_MOMENT_KINDS.has(kindForMomentLayout(moment.layout)) && kindForMomentLayout(moment.layout) !== 'lockup').length;
  return nonLockup + direction.mediaContainers.length + direction.frameInsets.length + direction.depthOverlays.length + (direction.insetReveals?.length ?? 0) === 0;
}

/**
 * WP8X: VISUAL beats vs text chips. A text chip / lockup covers a window (WP8W) but is still text on the picture. The product bar needs at least one VISUAL beat: a cutaway, a split, a media
 * container, a frame inset, a depth overlay, or a library graphic that leaves the face (full screen) or floats topic pills. `isTextChipCadenceOnly` is true when there is none.
 */
const VISUAL_MOMENT_KINDS: ReadonlySet<string> = new Set(['cutaway', 'media_container', 'split']);

export function visualBeatTimes(direction: VisualDirection, coveredBy: readonly number[] = []): number[] {
  return [
    ...direction.moments.filter(moment => VISUAL_MOMENT_KINDS.has(kindForMomentLayout(moment.layout))).map(moment => moment.timestamp),
    ...direction.mediaContainers.map(item => item.start),
    ...direction.frameInsets.map(item => item.start),
    ...direction.depthOverlays.map(item => item.start),
    ...(direction.insetReveals ?? []).map(item => item.start),
    ...coveredBy,
  ];
}

export function isTextChipCadenceOnly(direction: VisualDirection, coveredBy: readonly number[] = []): boolean {
  return visualBeatTimes(direction, coveredBy).length === 0;
}

/** The engaging bar: every window covered AND at least one visual beat (not chips alone). */
export function meetsEngagementBar(direction: VisualDirection, outputDurationSec: number, coveredBy: readonly number[] = []): boolean {
  return uncoveredEngagementWindows(direction, outputDurationSec, coveredBy).length === 0 && !isTextChipCadenceOnly(direction, coveredBy);
}

/**
 * WP9A: compositions that are a designed plate leaving (or replacing) the face whatever their placement: an explain plate is a map / stamp / diagram / card / headline the speaker's line is about.
 * A brand lockup bar is NOT here (text on the face). Ids only; no clip, content-type or mood branching.
 */
export const LEAVE_THE_FACE_COMPOSITIONS: ReadonlySet<string> = new Set([
  'OpenPlate',
  'FlashCard',
  'ImageRun',
  'WikiCallout',
  'NewspaperCallout',
  'TopicPills',
  'VsClaim',
  'QuoteCallout',
  'FullscreenStatement',
  'BigKineticHeadline',
  'StatHighlight',
  'ProcessSteps',
  'BeforeAfter',
  'ChartExplainer',
  'StampTitle',
  'TweetCard',
]);

/** Placements that take (part of) the frame from the face. */
const LEAVE_THE_FACE_PLACEMENTS: ReadonlySet<string> = new Set(['full_screen', 'split_screen']);

/**
 * Start times of the library graphics that leave the face: seeds placed full screen or split screen, and seeds of a known leave-the-face composition (topic pills, big kinetic headline, quote, vs, ...)
 * even when placed as an overlay (the seed result of `seedLibraryGraphics`, or anything shaped like it). Times are output seconds (the seed's anchor word).
 */
export function libraryCoverStarts(
  seed: {raw: {graphics: ReadonlyArray<{id: string; anchorWordIndex: number; placement: string}>}; compositions: Record<string, string>},
  words: ReadonlyArray<{start: number}>,
): number[] {
  return seed.raw.graphics
    .filter(graphic => LEAVE_THE_FACE_PLACEMENTS.has(graphic.placement) || LEAVE_THE_FACE_COMPOSITIONS.has(seed.compositions[graphic.id] ?? ''))
    .map(graphic => words[graphic.anchorWordIndex]?.start)
    .filter((start): start is number => typeof start === 'number');
}

/**
 * WP20: start times of placed overlays that are strong visual beats (a cutaway, PiP, card, sticker, split, composite, lockup, bubble, stat), e.g. the filler clip lane's cutaways and the labeled-asset pips. A chip / banner is text and
 * does not cover a window. Feed the result to `coveredBy` of the cadence checks.
 */
const STRONG_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['cutaway', 'pip', 'card', 'sticker', 'split', 'composite', 'lockup', 'bubble', 'stat']);
export const overlayCoverStarts = (overlays: ReadonlyArray<{start: number; layout: string}>): number[] => overlays.filter(overlay => STRONG_OVERLAY_LAYOUTS.has(overlay.layout)).map(overlay => overlay.start);
