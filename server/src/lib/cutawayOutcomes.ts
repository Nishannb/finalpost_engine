/**
 * One explicit outcome for every planned cutaway, derived from the edit ledger (the single source of truth for planner decisions).
 * Pure; no I/O. Observation only: nothing here decides whether an edit survives.
 *
 * Evidence level: these are PIPELINE outcomes. `in_blueprint_*` means the cutaway is in the blueprint handed to the renderer, which is not
 * proof that it is visible in the encoded video; an offline check of the rendered frames (eval/accounting, remotion/out/phase24-audit) is what
 * upgrades it to "rendered as intended / with modified timing". A missing asset can never produce an `in_blueprint_*` outcome.
 *
 * Two facts happen BEFORE the ledger exists and are therefore carried as report sections instead of ledger events (adding ledger
 * entries for them would change the frozen planner goldens): Director items the parser discarded, and parts of a direction that the
 * deterministic fallback substituted.
 */

import type {LedgerEntry, LedgerStage} from './editLedger.ts';

export type CutawayOutcomeCode =
  | 'in_blueprint_as_planned'
  | 'in_blueprint_modified_timing'
  | 'rejected_by_scheduling_rule'
  | 'rejected_by_request_policy'
  | 'asset_not_found'
  | 'asset_unavailable_or_unconfigured'
  | 'rejected_technical_constraint'
  | 'rejected_at_director_parse'
  | 'dropped_unexpectedly'
  | 'unknown_insufficient_evidence';

export type DirectorParseRejection = {
  kind: 'moment' | 'zoom';
  /** Index in the Director's own array. */
  index: number;
  timestamp: number | null;
  label: string;
  /** Machine code, e.g. `zoom_less_than_8s_after_previous_kept_zoom`. */
  code: string;
  detail: string;
};

export type CutawayOutcome = {
  id: string;
  label: string;
  outcome: CutawayOutcomeCode;
  reason: string | null;
  /** Finer cause where the ledger recorded one (e.g. `stock_disabled:user_assets_supplied`). */
  cause: string | null;
  stage: LedgerStage | null;
  plannedStartSec: number;
  finalSpan: {start: number; end: number} | null;
  /** Scheduler adjustments recorded on the ledger (`cutaway_schedule:*`), in order. */
  adjustments: string[];
  evidence: 'pipeline_ledger';
};

export type EditOutcomeReport = {
  version: 1;
  evidence: 'pipeline_ledger_not_rendered_frames';
  scheduling: 'legacy' | 'beat_preserving';
  cutaways: CutawayOutcome[];
  counts: Record<string, number>;
  /** Director items discarded by the parser (before the ledger exists). */
  directorParseRejections: DirectorParseRejection[];
  /** Parts of the direction filled by the deterministic fallback after the Director's own were empty/discarded. */
  fallbackSubstitutions: string[];
  /** Why the whole direction is the deterministic fallback, when it is. */
  directorFallbackReason: string | null;
};

const MODIFIED_START_TOLERANCE_SEC = 0.5;
const SCHEDULE_PREFIX = 'cutaway_schedule:';

const SCHEDULING = [
  /^clip_within_[\d.]+s_of_previous_clip$/, /^cutaway_within_[\d.]+s_of_(previous_cutaway|overlay)$/, /^speech_locked_moment_within_[\d.]+s_of_previous$/,
  /^moment_within_[\d.]+s_of_previous$/, /^cutaway_overlaps_split$/, /^cutaway_yielded_to_split$/, /^overlay_overlaps_cutaway$/, /^dropped_overlap:/,
  /^overlaps_[a-z_]+_/, /^(overlap|self_overlap|broll_overlap|min_gap)$/, /^temporal_[a-z_]+$/, /^cutaway_cap_\d+$/, /^over_cap_\d+$/, /^dropped_low_value:/,
];
const TECHNICAL = [/^hold_window_too_short$/, /^inside_hook_guard$/, /^placement_[\d.]+s_is_[\d.]+s_from_directed_[\d.]+s_limit_[\d.]+s$/, /^shorter_than_/, /^(invalid_window|too_short|invalid_interval|duration_out_of_range|low_res)$/, /^unsupported_layout$/];
const NOT_FOUND = [/^no_asset_match$/, /^no_stock_(photos|video)$/];
const UNAVAILABLE = [/^stock_(disabled_or_unconfigured|lookup_failed)$/, /^asset_(missing|unsuitable)$/];
const POLICY = [/^not_in_edit_allowlist$/];
const matches = (list: RegExp[], reason: string) => list.some(pattern => pattern.test(reason));

export function classifyCutawayEntry(entry: LedgerEntry): CutawayOutcome {
  const adjustments = entry.events
    .filter(event => event.reason?.startsWith(SCHEDULE_PREFIX))
    .flatMap(event => event.reason!.slice(SCHEDULE_PREFIX.length).split(','));
  const lost = [...entry.events].reverse().find(event => event.decision === 'rejected' || event.decision === 'dropped');
  const base = {id: entry.id, label: entry.label, plannedStartSec: entry.proposed.start, finalSpan: entry.final, adjustments, evidence: 'pipeline_ledger' as const};
  if (lost) {
    const reason = lost.reason ?? '';
    const outcome: CutawayOutcomeCode =
      matches(POLICY, reason) ? 'rejected_by_request_policy'
      : matches(NOT_FOUND, reason) ? 'asset_not_found'
      : matches(UNAVAILABLE, reason) ? 'asset_unavailable_or_unconfigured'
      : matches(SCHEDULING, reason) ? 'rejected_by_scheduling_rule'
      : matches(TECHNICAL, reason) ? 'rejected_technical_constraint'
      : reason ? 'dropped_unexpectedly' : 'unknown_insufficient_evidence';
    return {...base, outcome, reason: reason || null, cause: lost.cause ?? null, stage: lost.stage, finalSpan: null};
  }
  if (!entry.final) {
    return {...base, outcome: 'unknown_insufficient_evidence', reason: 'no_final_span_and_no_rejection_recorded', cause: null, stage: entry.events.at(-1)?.stage ?? null};
  }
  const renderer = [...entry.events].reverse().find(event => event.stage === 'renderer');
  if (renderer?.visibility === 'noop') {
    return {...base, outcome: 'dropped_unexpectedly', reason: renderer.reason ?? 'renderer_noop', cause: null, stage: 'renderer'};
  }
  const movedStart = Math.abs(entry.final.start - entry.proposed.start) > MODIFIED_START_TOLERANCE_SEC;
  const retimed = adjustments.some(code => /^(delayed_for_spacing|extended_to_asset_end|trimmed_to_asset_duration)/.test(code));
  return {...base, outcome: movedStart || retimed ? 'in_blueprint_modified_timing' : 'in_blueprint_as_planned', reason: null, cause: null, stage: entry.events.at(-1)?.stage ?? null};
}

export function summarizeEditOutcomes(
  entries: LedgerEntry[],
  context: {scheduling: 'legacy' | 'beat_preserving'; parseRejections?: DirectorParseRejection[]; fallbackSubstitutions?: string[]; directorFallbackReason?: string | null},
): EditOutcomeReport {
  const cutaways = entries.filter(entry => entry.type === 'cutaway').map(classifyCutawayEntry);
  const counts: Record<string, number> = {};
  for (const item of cutaways) {
    counts[item.outcome] = (counts[item.outcome] ?? 0) + 1;
  }
  return {
    version: 1,
    evidence: 'pipeline_ledger_not_rendered_frames',
    scheduling: context.scheduling,
    cutaways,
    counts,
    directorParseRejections: context.parseRejections ?? [],
    fallbackSubstitutions: context.fallbackSubstitutions ?? [],
    directorFallbackReason: context.directorFallbackReason ?? null,
  };
}
