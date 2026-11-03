/**
 * WP55 phase 2: where the kinetic-type stage gets its REAL subject data from (pure orchestration, no env access except through the injected extractor).
 *
 * Inputs it consumes (all already produced by analyze): the working source, the keep segments (cuts / trims), the measured occupancy box, the existing keyed speaker cutout. Output: the `subjectMatte` /
 * `subjectBox` the planner takes, plus an optional `foreground` (the alpha video + the OUTPUT-time spans where the host composition must draw the presenter in front of the type).
 *
 * Rules (nothing is invented):
 *  - an existing usable keyed cutout is reused as is (no new extraction);
 *  - otherwise a person matte (RVM, via `extractSubjectMatte` in media/personMatte.ts; MediaPipe is retired) is produced ONLY if a pre-plan says a hero beat would use it, ONLY for the source ranges of those beats (cached, quality-gated);
 *  - any skip / failure keeps the headroom layout and is reported as `kinetic_type:matte:skipped:<reason>`; the pipeline never depends on it;
 *  - the subject box is the measured vision box (occupancy source 'vision') or the matte's own measured box; a fallback occupancy box is NOT passed on.
 */
import type {SubjectMatteInput} from './motionTemplateBind.ts';
import {MATTE_RANGE_PAD_SEC as MATTE_PAD_SEC, isMatteBeat} from './kineticLedConfig.ts';
import {planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import {outputWindowsToSourceRanges, type KeepSegmentLike, type MatteReport, type SubjectMatteResult} from '../../media/personMatte.ts';

export type Box = {x: number; y: number; w: number; h: number};

export type KineticForeground = {
  /** The person-only alpha video (same timebase as the working source). */
  videoUrl: string;
  /** OUTPUT-time spans in which the host draws the presenter above the generated graphics. */
  spans: Array<{start: number; end: number}>;
  source: 'existing_keyed_cutout' | 'segmentation' | 'segmentation_cache';
};

/**
 * Where (OUTPUT time) the matte asset really has pixels. `all` = a full-length keyed cutout; `windows` = the range-limited person matte, which is transparent everywhere else, so a hero beat outside these
 * windows (+ `padSec`, the same pad the source ranges were built with) would be drawn with NO presenter in front of the type.
 */
export type MatteCoverage = {kind: 'all'} | {kind: 'windows'; windows: Array<{start: number; end: number}>; padSec: number};

/** The pad `outputWindowsToSourceRanges` applies to each requested window (defined once in kineticLedConfig so the planner's matted-footage accounting uses the same value). */
export const MATTE_RANGE_PAD_SEC = MATTE_PAD_SEC;

/** True when [start, end] lies inside one padded window of the coverage (touching / overlapping padded windows merge first). */
export function coverageContains(coverage: MatteCoverage, start: number, end: number): boolean {
  if (coverage.kind === 'all') return true;
  const padded = coverage.windows.map(w => ({start: w.start - coverage.padSec, end: w.end + coverage.padSec})).sort((a, b) => a.start - b.start);
  const merged: Array<{start: number; end: number}> = [];
  for (const w of padded) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({...w});
  }
  const eps = 1e-6;
  return merged.some(w => start >= w.start - eps && end <= w.end + eps);
}

/** The published MATTE beats (environmental hero, and the kinetic-led matte word pop; `isMatteBeat`) whose output span the matte does NOT cover. Pure: the caller drops them and reports `kinetic_type:environmental:dropped:not_in_matte_ranges`. */
export function heroBeatsOutsideCoverage<T extends {beat: {templateId: string; start: number; end: number; hint?: Record<string, unknown>}}>(published: readonly T[], coverage: MatteCoverage | undefined): T[] {
  if (!coverage || coverage.kind === 'all') return [];
  return published.filter(item => isMatteBeat(item.beat) && !coverageContains(coverage, item.beat.start, item.beat.end));
}

export type KineticSubjectResult = {
  subjectMatte?: SubjectMatteInput;
  subjectBox?: Box;
  foreground?: KineticForeground;
  /** Present whenever a matte asset exists. See `MatteCoverage`. */
  coverage?: MatteCoverage;
  warnings: string[];
  /** For cost reporting. */
  matte?: {seconds: number; rangeCount: number; cached: boolean; elapsedMs: number; detectedRatio: number};
};

type PlanInput = Parameters<typeof planCraftTemplateBeats>[0];

export async function resolveKineticSubject(input: {
  /** Everything the craft planner needs EXCEPT the subject data (this function supplies it). */
  planInput: Omit<PlanInput, 'subjectMatte' | 'subjectBox'>;
  keepSegments: readonly KeepSegmentLike[];
  activeSourcePath: string;
  /** Where the (non-cached) extraction result is written locally. */
  matteOutputPath: string;
  occupancy: {speaker: Box; source: 'vision' | 'fallback'};
  cutout: {available?: boolean; videoUrl?: string; speaker?: Box};
  /**
   * Phase C: what `cutout.videoUrl` covers (output time). Omitted = a full-length asset (chroma key / provided cutout). A range-limited RVM asset made for the Director's elements is reused ONLY if it covers every
   * hero span; otherwise the kinetic stage makes its own range-limited matte (cached, same shared slot).
   */
  cutoutCoverage?: MatteCoverage;
  upload: (localPath: string, extension: string) => Promise<{publicUrl: string}>;
  extract: (args: {inputPath: string; outputPath: string; ranges: ReadonlyArray<readonly [number, number]>; onSkip?: (reason: string) => void}) => Promise<SubjectMatteResult | null>;
  /** True when a matte backend is available at all (cheap check before any planning). */
  segmentationConfigured: boolean;
}): Promise<KineticSubjectResult> {
  const warnings: string[] = [];
  const measuredBox = input.occupancy.source === 'vision' ? input.occupancy.speaker : undefined;
  const base = {subjectBox: measuredBox, warnings};
  const heroSpans = (matte: SubjectMatteInput | undefined) =>
    planCraftTemplateBeats({...input.planInput, subjectMatte: matte, subjectBox: measuredBox})
      .beats.filter(beat => isMatteBeat(beat))
      .map(beat => ({start: beat.start, end: beat.end}));

  // 1) an existing usable keyed cutout (chroma-key on a plain backdrop) is already the matte
  const keyed = Boolean(input.cutout.available && input.cutout.videoUrl?.trim());
  const reuseCoverage: MatteCoverage = input.cutoutCoverage ?? {kind: 'all'};
  if (keyed) {
    const box = input.cutout.speaker ?? measuredBox;
    const matte: SubjectMatteInput = {hostComposited: true, ...(box ? {box} : {})};
    const spans = heroSpans(matte);
    const uncovered = spans.filter(span => !coverageContains(reuseCoverage, span.start, span.end));
    // reuse unless the existing asset is range-limited AND misses a hero span AND a matte can still be made for it
    if (uncovered.length === 0 || !input.segmentationConfigured) {
      return {...base, subjectBox: box, subjectMatte: matte, ...(spans.length > 0 ? {foreground: {videoUrl: input.cutout.videoUrl!.trim(), spans, source: 'existing_keyed_cutout' as const}} : {}), coverage: reuseCoverage, warnings};
    }
    warnings.push(`kinetic_type:matte:director_asset_misses:${uncovered.length}_spans`);
  }
  if (!input.segmentationConfigured) return base;

  // 2) optimistic pre-plan: only pay for a matte when a hero beat would actually use it
  const optimistic: SubjectMatteInput = {hostComposited: true, ...(measuredBox ? {box: measuredBox} : {})};
  const wanted = heroSpans(optimistic);
  if (wanted.length === 0) return base;
  const ranges = outputWindowsToSourceRanges(input.keepSegments, wanted);
  if (ranges.length === 0) {
    warnings.push('kinetic_type:matte:skipped:no_source_ranges');
    return base;
  }
  let skipReason: string | undefined;
  const result = await input.extract({inputPath: input.activeSourcePath, outputPath: input.matteOutputPath, ranges, onSkip: reason => (skipReason = reason)});
  if (!result) {
    warnings.push(`kinetic_type:matte:skipped:${skipReason ?? 'unknown'}`);
    return base;
  }
  let uploaded: {publicUrl: string};
  try {
    uploaded = await input.upload(result.path, '.webm');
  } catch {
    warnings.push('kinetic_type:matte:skipped:upload_failed');
    return base;
  }
  const report: MatteReport = result.report;
  const box = report.box ?? measuredBox;
  const matte: SubjectMatteInput = {hostComposited: true, ...(box ? {box} : {})};
  // the real plan (with the matte's measured box) decides the final spans: the same deterministic planner, so the extracted ranges cover them
  const spans = heroSpans(matte);
  warnings.push(`kinetic_type:matte:${result.cached ? 'segmentation_cache' : 'segmentation'}:${Math.round(report.seconds)}s:${ranges.length}_ranges:rvm`);
  return {
    subjectMatte: matte,
    subjectBox: box,
    coverage: {kind: 'windows' as const, windows: wanted, padSec: MATTE_RANGE_PAD_SEC},
    ...(spans.length > 0 ? {foreground: {videoUrl: uploaded.publicUrl, spans, source: result.cached ? ('segmentation_cache' as const) : ('segmentation' as const)}} : {}),
    matte: {seconds: report.seconds, rangeCount: ranges.length, cached: result.cached, elapsedMs: result.elapsedMs, detectedRatio: report.detected_ratio},
    warnings,
  };
}
