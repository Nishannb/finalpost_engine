/**
 * WP9D: Claude-custom explain plates for the windows the library could not cover. Orchestration only, testable with a mock generator: it finds the engagement windows still without a leave-the-face cover
 * (library seeds, Director graphics, footage / layout edits), builds transcript-grounded briefs for at most MAX_CLAUDE_PLATES of them, assembles them through the same guards a Director brief goes
 * through, and hands them to the existing builder library-first (WP9F: a structured brief that fits a library composition is published without a model call; only a miss reaches the generator). It never calls a model itself: the generator
 * (already budget-bounded by the caller) is whatever `buildOptions.generator` is.
 *
 * Claude not allowed (library-only polish): briefs the library resolves are still published (free, `explain_plates:library_hit:<id>`); only the unresolved ones, and the gaps beyond the bound, are reported, not
 * hidden: `explain_plates:claude_gap_skipped:<n>`.
 */
import {EDIT_LOOKS} from '../directorV2/editLooks.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from '../broll/engagementCadence.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps, MAX_CLAUDE_PLATES, type ExplainPlateGap} from '../broll/explainPlateGaps.ts';
import {buildGeneratedGraphics, occupiedByExistingEdits, type GeneratedGraphicsOutcome} from './buildGeneratedGraphics.ts';
import {assembleDirectedGraphics, type DirectedGraphic, type MotionDirectorInput} from './motionDirector.ts';
import {resolveLibraryGraphic} from './libraryRegistry.ts';

type Edit = Parameters<typeof occupiedByExistingEdits>[0] & {brollClips?: Array<{start: number}>};

/** Start times of everything that already takes the frame from the face. */
export function coverStartsOf(director: {graphics: readonly DirectedGraphic[]}, edit: Edit): number[] {
  const graphics = director.graphics
    .filter(graphic => {
      const placement = graphic.brief.placement;
      if (placement === 'full_screen' || placement === 'split_screen') return true;
      const hit = resolveLibraryGraphic({goal: graphic.brief.goal, visualDescription: graphic.brief.visualDescription, placement, content: graphic.brief.content, textTreatment: graphic.brief.textTreatment, polish: true});
      return hit !== null && LEAVE_THE_FACE_COMPOSITIONS.has(hit.compositionId);
    })
    .map(graphic => graphic.start);
  const layouts = new Set(['cutaway', 'split', 'composite']);
  return [
    ...graphics,
    ...(edit.brollClips ?? []).map(clip => clip.start),
    ...(edit.visualOverlays ?? []).filter(overlay => layouts.has(overlay.layout)).map(overlay => overlay.start),
    ...(edit.mediaContainers ?? []).map(item => item.start),
    ...(edit.frameInsets ?? []).map(item => item.start),
    ...(edit.depthOverlays ?? []).map(item => item.start),
    ...(edit.insetReveals ?? []).map(item => item.start),
  ];
}

export type ClaudePlatesInput = {
  director: {graphics: readonly DirectedGraphic[]};
  edit: Edit;
  words: MotionDirectorInput['words'];
  outputDurationSec: number;
  captionBand: MotionDirectorInput['captionBand'];
  contentProfile?: MotionDirectorInput['contentProfile'];
  lookId?: string | null;
  claudeAllowed?: boolean;
  /** Worker options for the builder (generator, upload, theme, artifactsDir, ...); the generator is the caller's budget-bounded one. */
  buildOptions: Parameters<typeof buildGeneratedGraphics>[1];
  /** Library first (default true): a structured plate brief that resolves to a library composition is published from the library with no generator call; only a miss reaches the generator. */
  preferLibrary?: boolean;
  /** Test seam: the brief builder (default `buildClaudePlateBriefs`). */
  makeBriefs?: typeof buildClaudePlateBriefs;
  /** Test seam: the builder. Default: the real `buildGeneratedGraphics`. */
  build?: typeof buildGeneratedGraphics;
};

export type ClaudePlatesResult = {
  gaps: ExplainPlateGap[];
  directed: DirectedGraphic[];
  outcome: GeneratedGraphicsOutcome | null;
  warnings: string[];
};

export async function runClaudeExplainPlates(input: ClaudePlatesInput): Promise<ClaudePlatesResult> {
  const warnings: string[] = [];
  const gaps = detectExplainPlateGaps({durationSec: input.outputDurationSec, words: input.words, coverStarts: coverStartsOf(input.director, input.edit)});
  const none: ClaudePlatesResult = {gaps, directed: [], outcome: null, warnings};
  if (gaps.length === 0) return none;
  // Respect the look: the plates share `maxGraphics` with the graphics already placed; minimal_captions (0) never gets one. An unknown look id falls back to the plate bound.
  const look = EDIT_LOOKS.find(entry => entry.id === input.lookId);
  const room = Math.max(0, Math.min(MAX_CLAUDE_PLATES, look ? look.maxGraphics - input.director.graphics.length : MAX_CLAUDE_PLATES));
  if (look && look.maxGraphics === 0) return none;
  const briefs = (input.makeBriefs ?? buildClaudePlateBriefs)(gaps, input.words, room);
  if (briefs.length === 0) {
    if (gaps.length > 0) warnings.push(`explain_plates:claude_gap_skipped:${gaps.length}`);
    return none;
  }
  const occupied = [...occupiedByExistingEdits(input.edit), ...input.director.graphics.map(graphic => ({start: graphic.start, end: graphic.end, what: 'motion graphic'}))];
  const assembled = assembleDirectedGraphics({graphics: briefs, notes: 'explain plates for uncovered windows'}, {words: input.words, outputDurationSec: input.outputDurationSec, occupied, maxGraphics: briefs.length, captionBand: input.captionBand, contentProfile: input.contentProfile});
  warnings.push(...assembled.refusals.map(refusal => `explain_plates:claude_plate_failed:${refusal.id}`));
  // WP9G: the library is free, so it is always tried. With Claude disallowed only the briefs the library resolves are published; the rest are reported, never hidden.
  const libraryOnly = input.claudeAllowed === false;
  const fits = (graphic: DirectedGraphic) => resolveLibraryGraphic({goal: graphic.brief.goal, visualDescription: graphic.brief.visualDescription, placement: graphic.brief.placement, content: graphic.brief.content, textTreatment: graphic.brief.textTreatment, polish: true}) !== null;
  const toBuild = libraryOnly ? assembled.graphics.filter(fits) : assembled.graphics;
  const skipped = gaps.length - briefs.length + (assembled.graphics.length - toBuild.length);
  if (skipped > 0) warnings.push(`explain_plates:claude_gap_skipped:${skipped}`);
  if (toBuild.length === 0) return {gaps, directed: [], outcome: null, warnings};
  const outcome = await (input.build ?? buildGeneratedGraphics)(toBuild, {...input.buildOptions, preferLibrary: libraryOnly || input.preferLibrary !== false, claudeAllowed: !libraryOnly});
  for (const item of outcome.provenance) warnings.push(item.source === 'library' ? `explain_plates:library_hit:${item.id}` : `explain_plates:claude_plate:${item.id}`);
  for (const failure of outcome.failures) warnings.push(`explain_plates:claude_plate_failed:${failure.id}`);
  return {gaps, directed: toBuild, outcome, warnings};
}

/** Folds the plate outcome into the stage's worker outcome (either may be null). */
export function mergeOutcomes(a: GeneratedGraphicsOutcome | null, b: GeneratedGraphicsOutcome | null): GeneratedGraphicsOutcome | null {
  if (!a || !b) return a ?? b;
  return {
    generatedGraphics: [...a.generatedGraphics, ...b.generatedGraphics].sort((x, y) => x.start - y.start),
    results: [...a.results, ...b.results],
    failures: [...a.failures, ...b.failures],
    ledger: [...a.ledger, ...b.ledger],
    claudeCostUsd: Number((a.claudeCostUsd + b.claudeCostUsd).toFixed(6)),
    provenance: [...a.provenance, ...b.provenance],
  };
}
