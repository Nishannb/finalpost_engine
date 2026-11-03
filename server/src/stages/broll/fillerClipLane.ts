/**
 * WP20: the FILLER CLIP LANE. PURE (no env, no I/O, no model, no web). Metromedia keeps every second alive with short illustrated clips (office B-roll, a product insert, a screen recording) and, now and then, one
 * centred word, instead of a long stretch of face. The sources are the creator's OWN video only: uploaded `broll_clip` slots first, other supplied user videos second. Nothing is searched or scraped.
 *
 * For each engagement window (WP8W, `SEC_PER_ENGAGE` seconds) that no strong beat starts in, one 1-3 s CUTAWAY is placed (a hard cut, no soft entrance); where a cutaway cannot sit, a small PiP takes the beat with the
 * `still_push_in` entrance. The total is capped at floor(duration / 10). The optional centre word is ONE verbatim spoken content word of the window as a kinetic-text motion graphic (a cutaway draws no text itself); it
 * never cites a phrase longer than a word, so captions are muted for the length of a blink at most (WP11B).
 */
import type {MotionGraphic, VisualOverlay} from '../../types/blueprint.ts';
import {engagementWindows} from './engagementCadence.ts';
import type {ResolvedLabeledAsset, TimeRange} from './labeledAssetPlacement.ts';

export const FILLER_MIN_SEC = 1;
export const FILLER_MAX_SEC = 3;
export const FILLER_DEFAULT_SEC = 2;
/** A filler starts this far into its window (so it never lands on the clip's first beat). */
export const FILLER_WINDOW_OFFSET_SEC = 1.2;
const SHIFT_STEP_SEC = 0.75;

/** Fillers a clip of `durationSec` may carry: one per 10 s. */
export const fillerCap = (durationSec: number): number => (Number.isFinite(durationSec) && durationSec >= 10 ? Math.floor(durationSec / 10) : 0);

export type FillerWord = {text: string; start: number; end: number};
export type FillerSource = ResolvedLabeledAsset & {userAssetId?: string; label?: string};

export type FillerPlan = {
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  /** Start times of the placed fillers (they are strong beats for the engagement cadence). */
  coverStarts: number[];
};

const STOP = new Set('about after again also because been before being could does doing from have here into just like make more most much only other over really right said same should some than that their them then there these they thing this very want were what when where which while with would your you and but for are the was our not can its get got had has him her his how let may one out she too use who why'.split(' '));

const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && a.end > b.start;
const free = (range: TimeRange, blocked: readonly TimeRange[]) => !blocked.some(other => overlaps(range, other));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The one centred word: the longest verbatim content word (>= 5 letters, not a stop word) that is spoken inside the range. Empty when none. */
export function fillerCenterWord(words: readonly FillerWord[], range: TimeRange): string {
  const inside = words.filter(word => word.start >= range.start && word.end <= range.end + 0.2);
  let best = '';
  for (const word of inside) {
    const clean = word.text.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (clean.length >= 5 && !STOP.has(clean.toLowerCase()) && clean.length > best.length) best = clean;
  }
  return best;
}

function overlayFor(source: FillerSource, range: TimeRange, layout: 'cutaway' | 'pip'): VisualOverlay {
  return {
    start: range.start,
    end: range.end,
    layout,
    mediaKind: 'video',
    anchor: layout === 'pip' ? 'top_right' : 'top',
    keyword: source.label ?? 'filler clip',
    overlayText: '',
    assetUrl: source.url,
    provider: 'user',
    providerId: 0,
    ...(source.userAssetId ? {userBrollId: source.userAssetId} : {}),
    width: 1080,
    height: 1920,
    credit: '',
    creditUrl: '',
    accentColor: '#FFFFFF',
    textStyle: 'chip',
    treatment: layout === 'pip' ? 'float' : 'card',
    cornerRadius: layout === 'pip' ? 24 : 0,
    glow: false,
    visualWeight: layout === 'pip' ? 'accent' : 'hero',
    // a cutaway is a hard cut (no soft entrance); the small PiP pushes in
    ...(layout === 'pip' ? {recipeId: 'still_push_in'} : {}),
    intent: 'filler_clip',
    createdByPass: 'wp20_filler_lane',
  };
}

export function planFillerClipLane(input: {
  /** Uploaded `broll_clip` videos first, then the creator's other videos. Stills are ignored. */
  sources: readonly FillerSource[];
  outputDurationSec: number;
  /** Start times of strong beats that already exist (clips, cutaways, containers, cards, full-screen graphics, labeled placements). */
  coveredStarts: readonly number[];
  /** Full-screen beats: no filler may overlap them. */
  blockedRanges: readonly TimeRange[];
  /** Everything else on screen as an overlay; a cutaway avoids it, a PiP only avoids `pipBlockedRanges`. */
  overlayRanges?: readonly TimeRange[];
  pipBlockedRanges?: readonly TimeRange[];
  words?: readonly FillerWord[];
  /** false = never add a centre word. */
  centerWord?: boolean;
}): FillerPlan {
  const plan: FillerPlan = {overlays: [], motionGraphics: [], coverStarts: []};
  const sources = input.sources.filter(source => source.mediaKind === 'video');
  const cap = fillerCap(input.outputDurationSec);
  if (sources.length === 0 || cap === 0) return plan;
  const cutawayBlocked = [...input.blockedRanges, ...(input.overlayRanges ?? [])];
  const pipBlocked = [...input.blockedRanges, ...(input.pipBlockedRanges ?? [])];
  const taken: TimeRange[] = [];
  let next = 0;
  for (const window of engagementWindows(input.outputDurationSec)) {
    if (plan.overlays.length >= cap) break;
    if ([...input.coveredStarts, ...plan.coverStarts].some(time => time >= window.start && time < window.end)) continue;
    const source = sources[next % sources.length]!;
    const length = Math.min(FILLER_MAX_SEC, Math.max(FILLER_MIN_SEC, FILLER_DEFAULT_SEC));
    let placed: {range: TimeRange; layout: 'cutaway' | 'pip'} | null = null;
    for (const layout of ['cutaway', 'pip'] as const) {
      const blocked = [...(layout === 'cutaway' ? cutawayBlocked : pipBlocked), ...taken];
      for (let start = window.start + FILLER_WINDOW_OFFSET_SEC; start + length <= window.end + 0.001 && start + length <= input.outputDurationSec; start += SHIFT_STEP_SEC) {
        const range = {start: round(start), end: round(start + length)};
        if (free(range, blocked)) {
          placed = {range, layout};
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) continue;
    next += 1;
    taken.push(placed.range);
    plan.overlays.push(overlayFor(source, placed.range, placed.layout));
    plan.coverStarts.push(placed.range.start);
    const word = input.centerWord === false ? '' : fillerCenterWord(input.words ?? [], placed.range);
    if (word) {
      plan.motionGraphics.push({start: placed.range.start, end: placed.range.end, text: word, role: 'primary', shape: 'none', accentColor: '#F4E8C1', textColor: '#FFFFFF', anchor: 'center', entrance: 'scale_pop', exit: 'fade', fontScale: 1.4});
    }
  }
  return plan;
}

export const fillerWarnings = (plan: Pick<FillerPlan, 'overlays'>): string[] => (plan.overlays.length > 0 ? [`polish_pace:fillers:${plan.overlays.length}`] : []);
