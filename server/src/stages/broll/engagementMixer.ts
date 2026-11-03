/**
 * WP9A: MULTI-PRIMITIVE ENGAGEMENT MIXER. The engagement bar (engagementCadence.ts) says every ~SEC_PER_ENGAGE window needs a strong beat and at least one VISUAL beat. This module decides WHICH kind each
 * uncovered window gets, so a polish edit rotates leave-the-face primitives (cutaway, split, media container, frame inset, library explain plate) instead of repeating one kind or falling to text chips.
 * PURE: no env, no logger, no I/O, no model call. No clip, content-type or mood branching: the only inputs are the look, the requested kinds, and what can resolve.
 *
 * Per window, in order:
 *   1. already covered (a Director beat or a predicted library plate starts in it)  -> recorded, not touched
 *   2. a look-allowed, requested, resolvable VISUAL kind (`proposable`), rotated so the same kind is not used twice in a row while another is available, within the look's graphic cap
 *   3. last resort: a card, then a lockup (text on the picture; never satisfies the visual bar on its own)
 * WP9B: only `cutaway` (and `media_container` / `frame_inset`, which are footage) need resolvable media. A `split` is speaker + graphic side: with no creator media it is realized by a library plate placed
 * `split_screen` (top graphic, bottom speaker), so on the explain-plate path (`plateSplit`) it stays proposable (`via: 'plate'`) whenever the look has graphic room (`maxGraphics` > 0), whatever the look's
 * element-kind list says (a plate is a library graphic, capped by `maxGraphics`, not a footage split).
 * A library plate is never proposed for an uncovered window: it can only be PREDICTED (the seed the motion stage will place, `libraryCovers`), so a window it does not cover is reported
 * (`explain_plates:window_text_fallback:<i>`) instead of pretending a plate will appear.
 */
import type {EditLook} from '../directorV2/editLooks.ts';
import type {VisualDirection} from './geminiDirector.ts';
import {engagementWindows} from './engagementCadence.ts';

export type MixerKind = 'cutaway' | 'split' | 'media_container' | 'frame_inset' | 'library_plate' | 'card' | 'lockup';

/** Visual (leave-the-face) kinds, in rotation order. */
export const MIXER_VISUAL_KINDS: readonly MixerKind[] = ['cutaway', 'split', 'media_container', 'frame_inset'];
/** What a caller that can only emit moments (cutaway / split) passes as `proposable`. */
export const MOMENT_PROPOSABLE: readonly MixerKind[] = ['cutaway', 'split'];

const LAST_RESORT: readonly MixerKind[] = ['card', 'lockup'];

export type MixerBeat = {
  windowIndex: number;
  kind: MixerKind;
  /** covered = a beat already starts here (Director item, or a predicted library plate); proposed = the caller should add `kind` in this window. */
  source: 'existing' | 'library' | 'proposed';
  /** Earliest spoken-word start in the window that is clear of `occupied` (the suggested anchor); null when no word qualifies. */
  startSec: number | null;
  /** WP9B: how a `split` is realized. media = a resolvable creator/stock clip beside the speaker; plate = a library plate on the graphic side. Absent for other kinds. */
  via?: 'media' | 'plate';
};

export type MixerInput = {
  durationSec: number;
  look: EditLook;
  words: ReadonlyArray<{start: number}>;
  /** Intervals already on screen (output s). */
  occupied?: ReadonlyArray<{start: number; end: number}>;
  /** The requested toolkit ids; null = every toolkit. */
  requested: ReadonlySet<string> | null;
  /** Accepted for the caller's contract; the choice of leave-the-face kinds does not depend on the matte (cutout / text-behind are never proposed here). */
  matteUsable?: boolean;
  /** false = no media can resolve (creator B-roll only and none supplied): cutaway / split / container / inset are not proposed. Default true. */
  cutawayResolvable?: boolean;
  /** Start times (output s) of beats the direction already holds. */
  existingStrong?: readonly number[];
  /** Start times (output s) of predicted library plates (`libraryCoverStarts`). */
  libraryCovers?: readonly number[];
  /** Visual kinds the caller can actually emit. Default: cutaway + split (moments). */
  proposable?: readonly MixerKind[];
  /** WP9B: the explain-plate path is on (polish, no creator B-roll): a split may be realized by a library plate instead of footage. */
  plateSplit?: boolean;
  /** Designed graphics of the look already in the direction (counted against `look.maxGraphics`). */
  graphicsUsed?: number;
};

export type MixerPlan = {
  beats: MixerBeat[];
  /** Windows with no window-covering visual: they fall to a card / lockup, or stay empty. */
  textFallbackWindows: number[];
  warnings: string[];
};

const EDGE_SEC = 0.4;

export function planEngagementBeats(input: MixerInput): MixerPlan {
  const {look} = input;
  const requested = (kind: string): boolean => look.allowedElementKinds.includes(kind as never) && (!input.requested || input.requested.has(kind));
  const resolvable = input.cutawayResolvable !== false;
  const proposable = new Set<MixerKind>(input.proposable ?? MOMENT_PROPOSABLE);
  const footage = (kind: MixerKind) => kind === 'cutaway' || kind === 'media_container' || kind === 'frame_inset';
  const plateSplit = Boolean(input.plateSplit) && look.maxGraphics > 0 && (!input.requested || ['cutaway', 'card', 'kinetic_text', 'bubble', 'counter'].some(kind => input.requested!.has(kind)));
  const mediaSplit = resolvable && requested('split');
  const visual = MIXER_VISUAL_KINDS.filter(kind => proposable.has(kind) && (kind === 'split' ? mediaSplit || plateSplit : footage(kind) ? resolvable && requested(kind) : requested(kind)));
  const platesCounted = new Set<number>();
  const textKinds = LAST_RESORT.filter(kind => requested(kind));
  const graphicKinds = new Set<string>(look.graphicKinds);
  let graphicsUsed = input.graphicsUsed ?? 0;
  const beats: MixerBeat[] = [];
  const textFallbackWindows: number[] = [];
  const warnings: string[] = [];
  let previous: MixerKind | null = null;
  let cursor = 0;

  for (const window of engagementWindows(input.durationSec)) {
    const inWindow = (time: number) => time >= window.start && time < window.end;
    const startSec = input.words.map(word => word.start).find(start => inWindow(start) && start >= EDGE_SEC && !(input.occupied ?? []).some(item => start >= item.start && start < item.end)) ?? null;
    const library = (input.libraryCovers ?? []).find(inWindow);
    if ((input.existingStrong ?? []).some(inWindow)) {
      beats.push({windowIndex: window.index, kind: 'cutaway', source: 'existing', startSec: (input.existingStrong ?? []).find(inWindow) ?? startSec});
      continue;
    }
    if (library !== undefined) {
      beats.push({windowIndex: window.index, kind: 'library_plate', source: 'library', startSec: library});
      previous = 'library_plate';
      continue;
    }
    // Rotate: the first visual kind at/after the cursor that is not the previous kind (unless it is the only one) and fits the look's graphic cap.
    // A plate split is a library graphic: it shares the look's cap with the predicted plates and the graphics already placed.
    const planned = input.libraryCovers?.length ?? 0;
    const fits = (kind: MixerKind) =>
      kind === 'split' && !mediaSplit ? graphicsUsed + planned + platesCounted.size < look.maxGraphics : !graphicKinds.has(kind) || graphicsUsed < look.maxGraphics;
    const open = visual.filter(fits);
    let pick: MixerKind | undefined;
    for (let step = 0; step < open.length; step += 1) {
      const candidate = open[(cursor + step) % open.length]!;
      if (candidate === previous && open.length > 1) continue;
      pick = candidate;
      cursor = (open.indexOf(candidate) + 1) % open.length;
      break;
    }
    if (pick) {
      const via = pick === 'split' ? (mediaSplit ? 'media' : 'plate') : undefined;
      if (via === 'plate') platesCounted.add(window.index);
      else if (graphicKinds.has(pick)) graphicsUsed += 1;
      beats.push({windowIndex: window.index, kind: pick, source: 'proposed', startSec, ...(via ? {via} : {})});
      previous = pick;
      continue;
    }
    textFallbackWindows.push(window.index);
    warnings.push(`explain_plates:window_text_fallback:${window.index}`);
    const text = textKinds[0];
    if (text) {
      beats.push({windowIndex: window.index, kind: text, source: 'proposed', startSec});
      previous = text;
    }
  }
  return {beats, textFallbackWindows, warnings};
}

/** The mixer's visual beats (leave-the-face): everything but a card / lockup. */
export const isVisualMixerKind = (kind: MixerKind): boolean => kind !== 'card' && kind !== 'lockup';

/**
 * WP9B: the intervals the motion stage will treat as occupied, as far as the visual plan knows them before the media resolves: the hook title and the timed designed graphics. The planner's seed
 * prediction uses this so it and `addLibrarySeeds` (which gets `occupiedByExistingEdits` of the final blueprint) see the same hook and graphics. Footage moments are not here: their windows are only known
 * after resolution, and the fill that adds them runs after the prediction.
 */
export function occupiedFromDirection(direction: VisualDirection, hookDurationSec: number, options: {withoutHook?: boolean} = {}): Array<{start: number; end: number}> {
  const out: Array<{start: number; end: number}> = [];
  if (direction.hookTitle?.trim() && !options.withoutHook) {
    const start = direction.hookStartSec ?? 0;
    out.push({start, end: start + Math.max(1.2, hookDurationSec || 3)});
  }
  for (const group of [direction.motionGraphics, direction.mediaContainers, direction.frameInsets, direction.depthOverlays, direction.insetReveals ?? [], direction.semanticEmphasis] as Array<Array<{start: number; end: number}>>) {
    for (const item of group) if (item.end > item.start) out.push({start: item.start, end: item.end});
  }
  return out.sort((a, b) => a.start - b.start);
}

/** WP10A: the hook title's window alone (the open plate may take it on the explain-plate path; every other plate stays out). Mirrors the hook entry of `occupiedFromDirection`. */
export function hookWindowFromDirection(direction: VisualDirection, hookDurationSec: number): {start: number; end: number; what: string} | undefined {
  if (!direction.hookTitle?.trim()) return undefined;
  const start = direction.hookStartSec ?? 0;
  return {start, end: start + Math.max(1.2, hookDurationSec || 3), what: 'planned'};
}
