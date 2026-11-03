/**
 * Phase C: the person matte for DIRECTOR-driven elements (text behind the speaker, depth overlays, the cutout layout).
 *
 * analyzeVideo plans these elements while a matte is only EXPECTED (planning availability = the backdrop is keyable OR RVM is configured). The real alpha asset is obtained afterwards, here, once the
 * windows that need it are known (B-roll plan, motion Director, opening) and BEFORE finalizeEdits:
 *
 *   keyable backdrop -> chroma key (fast, full length) + a sanity check on the result; anything wrong with it falls through to RVM when RVM is configured
 *   otherwise        -> RVM over ONLY the merged windows the elements need, trimmed to the matted-footage budget (20 s CPU / 45 s mps|cuda), through the shared cache + the shared RVM slot
 *
 * The outcome says what the asset covers (`coverage`), and `reconcileByCoverage` drops the elements it cannot draw. Nothing is invented: no asset, no behind-subject element.
 * Everything here except `obtainPersonMatte`'s injected deps is pure.
 */
import type {KeepSegmentLike, SubjectMatteResult} from '../media/personMatte.ts';
import {outputWindowsToSourceRanges} from '../media/personMatte.ts';
import {MATTE_RANGE_PAD_SEC} from '../stages/broll/kineticLedConfig.ts';
import {coverageContains, type MatteCoverage} from '../stages/broll/kineticSubject.ts';

export type Window = {start: number; end: number};

/** What needs the person asset. Lower `priority` is kept first when the budget cannot cover everything. */
export type MatteNeedKind = 'opening_behind' | 'behind_text' | 'depth' | 'cutout' | 'subject_stage';
export type MatteNeed = Window & {kind: MatteNeedKind; index: number; priority: number};

const PRIORITY: Record<MatteNeedKind, number> = {opening_behind: 0, behind_text: 1, depth: 2, cutout: 3, subject_stage: 0};

export function collectMatteNeeds(input: {
  openingBehind?: Window | null;
  behindTexts?: readonly Window[];
  depthOverlays?: readonly Window[];
  cutoutOverlays?: readonly Window[];
  /** Subject Stage (style subject_stage): the WHOLE output run needs the person (every stage draws her over / under a plate); one window, kept first. Absent = the kinetic-era needs only, exactly as before. */
  stageRun?: Window | null;
}): MatteNeed[] {
  const needs: MatteNeed[] = [];
  if (input.stageRun) needs.push({kind: 'subject_stage', index: 0, priority: PRIORITY.subject_stage, start: input.stageRun.start, end: input.stageRun.end});
  if (input.openingBehind) needs.push({kind: 'opening_behind', index: 0, priority: PRIORITY.opening_behind, start: input.openingBehind.start, end: input.openingBehind.end});
  const add = (kind: MatteNeedKind, windows: readonly Window[] | undefined) => (windows ?? []).forEach((w, index) => needs.push({kind, index, priority: PRIORITY[kind], start: w.start, end: w.end}));
  add('behind_text', input.behindTexts);
  add('depth', input.depthOverlays);
  add('cutout', input.cutoutOverlays);
  return needs.filter(n => n.end > n.start);
}

/** Union of the windows after padding each side; windows whose padded spans touch or overlap merge (so nearby windows become ONE range). */
export function paddedUnion(windows: readonly Window[], padSec = MATTE_RANGE_PAD_SEC): Window[] {
  const sorted = windows.map(w => ({start: Math.max(0, w.start - padSec), end: w.end + padSec})).sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({...w});
  }
  return merged;
}

/** Matted footage (seconds) a set of windows costs: the length of their padded union. */
export function matteCostSec(windows: readonly Window[], padSec = MATTE_RANGE_PAD_SEC): number {
  return paddedUnion(windows, padSec).reduce((sum, w) => sum + (w.end - w.start), 0);
}

/**
 * Keep the needs the budget can pay for, most important first (then earliest). A need whose windows merge into ones already kept costs only the extra footage. Returns the kept needs, the dropped ones and
 * the (unpadded) windows to matte. Pure and deterministic.
 */
export function trimToBudget(needs: readonly MatteNeed[], budgetSec: number, padSec = MATTE_RANGE_PAD_SEC): {kept: MatteNeed[]; dropped: MatteNeed[]; windows: Window[]; costSec: number} {
  const kept: MatteNeed[] = [];
  const dropped: MatteNeed[] = [];
  const order = [...needs].sort((a, b) => a.priority - b.priority || a.start - b.start);
  for (const need of order) {
    if (matteCostSec([...kept, need], padSec) <= budgetSec + 1e-9) kept.push(need);
    else dropped.push(need);
  }
  return {kept, dropped, windows: kept.map(n => ({start: n.start, end: n.end})), costSec: matteCostSec(kept, padSec)};
}

/**
 * Split elements into those the asset can draw and those it cannot. `coverage` null = there is NO asset: everything is dropped unless `dropWhenNoMatte` is false (the cutout layout keeps its occupancy-crop
 * fallback). `{kind:'all'}` (a full-length chroma key) keeps everything. A range-limited asset keeps only elements inside its padded windows (outside them the person would be invisible).
 */
export function reconcileByCoverage<T extends Window>(items: readonly T[], coverage: MatteCoverage | null, options: {dropWhenNoMatte: boolean}): {kept: T[]; dropped: T[]} {
  if (!coverage) return options.dropWhenNoMatte ? {kept: [], dropped: [...items]} : {kept: [...items], dropped: []};
  if (coverage.kind === 'all') return {kept: [...items], dropped: []};
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) (coverageContains(coverage, item.start, item.end) ? kept : dropped).push(item);
  return {kept, dropped};
}

/**
 * Apply `coverage` to every kind of Director element at once. Behind-subject text, the opening's behind-subject text and depth overlays need the person drawn in front, so they go when there is no asset or they
 * fall outside it. The cutout layout keeps its occupancy-crop fallback when there is NO asset (`speaker_cutout_crop`), but is dropped when a range-limited asset does not cover it. Pure; the caller applies the result.
 */
export function reconcileDirectorElements<B extends Window, D extends Window, C extends Window>(input: {behind: readonly B[]; opening?: Window | null; depth: readonly D[]; cutouts: readonly C[]; coverage: MatteCoverage | null}) {
  const {coverage} = input;
  const why = coverage ? 'outside_person_matte' : 'no_person_matte';
  const behind = reconcileByCoverage(input.behind, coverage, {dropWhenNoMatte: true});
  const opening = input.opening ? reconcileByCoverage([input.opening], coverage, {dropWhenNoMatte: true}) : {kept: [] as Window[], dropped: [] as Window[]};
  const depth = reconcileByCoverage(input.depth, coverage, {dropWhenNoMatte: true});
  const cutouts = reconcileByCoverage(input.cutouts, coverage, {dropWhenNoMatte: false});
  const warnings: string[] = [];
  if (behind.dropped.length > 0) warnings.push(`person_matte:dropped:behind_text:${behind.dropped.length}:${why}`);
  if (opening.dropped.length > 0) warnings.push(`person_matte:dropped:opening_behind:${why}`);
  if (depth.dropped.length > 0) warnings.push(`person_matte:dropped:depth:${depth.dropped.length}:${why}`);
  if (cutouts.dropped.length > 0) warnings.push(`person_matte:dropped:cutout:${cutouts.dropped.length}:${why}`);
  if (!coverage && cutouts.kept.length > 0) warnings.push('speaker_cutout_crop');
  return {
    why,
    behind,
    openingDropped: opening.dropped.length > 0,
    depth,
    cutouts,
    warnings,
    /** Text-behind / depth was planned but there is no asset at all (the `text_behind_skipped:no_matte` warning on the mvp-like profiles). */
    textBehindSkipped: !coverage && (behind.dropped.length > 0 || depth.dropped.length > 0 || opening.dropped.length > 0),
  };
}

/** Cheap sanity gate for a chroma-keyed WebM: it must exist with a plausible size and its alpha must be neither (almost) empty nor (almost) opaque. `meanAlpha` is 0..1, or null when it could not be measured. */
export const CHROMA_MIN_BYTES = 2048;
export const CHROMA_MIN_MEAN_ALPHA = 0.02;
export const CHROMA_MAX_MEAN_ALPHA = 0.97;
export function chromaSanity(input: {bytes: number; meanAlpha: number | null}): {ok: boolean; reason: string} {
  if (!(input.bytes >= CHROMA_MIN_BYTES)) return {ok: false, reason: 'tiny_file'};
  if (input.meanAlpha !== null) {
    if (input.meanAlpha < CHROMA_MIN_MEAN_ALPHA) return {ok: false, reason: 'empty_alpha'};
    if (input.meanAlpha > CHROMA_MAX_MEAN_ALPHA) return {ok: false, reason: 'opaque_alpha'};
  }
  return {ok: true, reason: 'ok'};
}

export type PersonMatteDeps = {
  /** True when an RVM interpreter resolves (`subjectMatteConfigured()`). */
  rvmConfigured: boolean;
  /** Writes the full-length chroma-keyed WebM to `outputPath`; throws on failure. */
  extractChroma: (outputPath: string) => Promise<void>;
  /** Mean alpha 0..1 of the keyed file, or null when it cannot be measured (then only the size check applies). */
  probeAlpha: (path: string) => Promise<number | null>;
  fileBytes: (path: string) => Promise<number>;
  upload: (path: string, extension: string) => Promise<{publicUrl: string}>;
  /** RVM over SOURCE-second ranges (media/personMatte.ts `extractSubjectMatte`: cached, quality-gated, shared slot). */
  extractRvm: (args: {inputPath: string; outputPath: string; ranges: ReadonlyArray<readonly [number, number]>; onSkip?: (reason: string) => void}) => Promise<SubjectMatteResult | null>;
};

export type PersonMatteOutcome = {
  source: 'chroma' | 'rvm' | 'none';
  videoUrl?: string;
  /** What the asset covers (output time); null = no asset. */
  coverage: MatteCoverage | null;
  /** RVM only: needs the budget kept / dropped, and the matted footage planned. */
  keptNeeds: MatteNeed[];
  droppedNeeds: MatteNeed[];
  matteSec: number;
  /** Whether an extraction was tried at all (feeds the final matte gate). */
  attempted: boolean;
  warnings: string[];
};

/**
 * Obtain the asset for `needs`. No needs and no `force` = nothing is extracted (no cost). Never throws: every failure is a warning and `source: 'none'`.
 *  - keyable (or `force` while RVM is not configured, the old behaviour): chroma; on success + sanity pass it is the asset (full coverage). A failed or insane key falls through to RVM when it is configured.
 *  - RVM: the merged windows of the needs the budget keeps; ranges go to `extractRvm`; coverage = those windows.
 */
export async function obtainPersonMatte(input: {
  needs: readonly MatteNeed[];
  keyable: boolean;
  force: boolean;
  keepSegments: readonly KeepSegmentLike[];
  activeSourcePath: string;
  chromaPath: string;
  rvmPath: string;
  budgetSec: number;
  deps: PersonMatteDeps;
}): Promise<PersonMatteOutcome> {
  const warnings: string[] = [];
  const none = (extra: Partial<PersonMatteOutcome> = {}): PersonMatteOutcome => ({source: 'none', coverage: null, keptNeeds: [], droppedNeeds: [], matteSec: 0, attempted: false, warnings, ...extra});
  if (input.needs.length === 0 && !input.force) return none();
  const {deps} = input;
  let attempted = false;

  // 1) chroma: the fast path, only for a keyable backdrop (or the old forced test mode without RVM)
  if (input.keyable || (input.force && !deps.rvmConfigured)) {
    attempted = true;
    try {
      await deps.extractChroma(input.chromaPath);
      const sanity = chromaSanity({bytes: await deps.fileBytes(input.chromaPath), meanAlpha: await deps.probeAlpha(input.chromaPath)});
      if (sanity.ok) {
        const uploaded = await deps.upload(input.chromaPath, '.webm');
        warnings.push('speaker_cutout_keyed');
        return {source: 'chroma', videoUrl: uploaded.publicUrl, coverage: {kind: 'all'}, keptNeeds: [...input.needs], droppedNeeds: [], matteSec: 0, attempted, warnings};
      }
      warnings.push(`speaker_cutout_keyed_rejected:${sanity.reason}`);
    } catch {
      warnings.push('speaker_cutout_extract_failed');
    }
  }

  // 2) RVM for the windows the planned elements need
  if (!deps.rvmConfigured) return none({attempted});
  if (input.needs.length === 0) return none({attempted});
  attempted = true;
  const trimmed = trimToBudget(input.needs, input.budgetSec);
  if (trimmed.dropped.length > 0) warnings.push(`person_matte:budget_dropped:${trimmed.dropped.length}`);
  const ranges = outputWindowsToSourceRanges(input.keepSegments, trimmed.windows);
  if (ranges.length === 0) {
    warnings.push('person_matte:skipped:no_source_ranges');
    return none({attempted, droppedNeeds: [...input.needs]});
  }
  let skipReason: string | undefined;
  let result: SubjectMatteResult | null = null;
  try {
    result = await deps.extractRvm({inputPath: input.activeSourcePath, outputPath: input.rvmPath, ranges, onSkip: reason => (skipReason = reason)});
  } catch {
    skipReason = 'error';
  }
  if (!result) {
    warnings.push(`person_matte:skipped:${skipReason ?? 'unknown'}`);
    return none({attempted, droppedNeeds: [...input.needs]});
  }
  let uploaded: {publicUrl: string};
  try {
    uploaded = await deps.upload(result.path, '.webm');
  } catch {
    warnings.push('person_matte:skipped:upload_failed');
    return none({attempted, droppedNeeds: [...input.needs]});
  }
  warnings.push(`person_matte:rvm:${result.cached ? 'cache' : 'run'}:${Math.round(result.report.seconds)}s:${ranges.length}_ranges`);
  return {
    source: 'rvm',
    videoUrl: uploaded.publicUrl,
    coverage: {kind: 'windows', windows: trimmed.windows, padSec: MATTE_RANGE_PAD_SEC},
    keptNeeds: trimmed.kept,
    droppedNeeds: trimmed.dropped,
    matteSec: trimmed.costSec,
    attempted,
    warnings,
  };
}
