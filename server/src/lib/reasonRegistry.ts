/**
 * Registry of every reason string an edit can be dropped, rejected or refused with, each mapped to a category.
 *
 * Two users:
 *   1. the offline evaluation harness (invariant M2: a non-surviving edit must carry a REGISTERED reason), and
 *   2. the repair-loop contract (`editDiagnostics.ts`), which needs to know what kind of problem a reason is.
 *
 * Reasons are matched by pattern because several embed numbers (`clip_within_1.5s_of_previous_clip`). A new reason in
 * production code that is not listed here fails the harness, which is the point: reasons must stay precise and known.
 */

export type ReasonCategory =
  | 'malformed_output'
  | 'unsupported_kind'
  | 'missing_text_or_asset'
  | 'missing_prerequisite'
  | 'invalid_parameter'
  | 'timeline_conflict'
  | 'editorial_policy'
  | 'engine_limit';

type Rule = {pattern: RegExp; category: ReasonCategory};

const rule = (pattern: RegExp, category: ReasonCategory): Rule => ({pattern, category});

export const REASON_RULES: readonly Rule[] = [
  // -- policy / request ---------------------------------------------------------------------------------------
  rule(/^not_in_edit_allowlist$/, 'editorial_policy'),
  rule(/^dropped_low_value:/, 'editorial_policy'),
  rule(/^phrase_card_capped_at_\d+$/, 'engine_limit'),
  rule(/^(cutaway|transition|zoom)_cap_\d+$/, 'engine_limit'),
  rule(/^zoom_cap_\d+$/, 'engine_limit'),
  rule(/^over_cap_\d+$/, 'engine_limit'),
  rule(/^max_count$/, 'engine_limit'),
  rule(/^share_cap$/, 'engine_limit'),
  // -- timeline / conflicts -----------------------------------------------------------------------------------
  rule(/^clip_within_[\d.]+s_of_previous_clip$/, 'timeline_conflict'),
  rule(/^overlay_within_[\d.]+s_of_previous_overlay$/, 'timeline_conflict'),
  rule(/^cutaway_within_[\d.]+s_of_previous_cutaway$/, 'timeline_conflict'),
  rule(/^cutaway_within_[\d.]+s_of_overlay$/, 'timeline_conflict'),
  rule(/^cutaway_overlaps_split$/, 'timeline_conflict'),
  rule(/^cutaway_yielded_to_split$/, 'timeline_conflict'),
  rule(/^yielded_to_split$/, 'timeline_conflict'),
  rule(/^overlay_overlaps_cutaway$/, 'timeline_conflict'),
  rule(/^dropped_overlap:/, 'timeline_conflict'),
  rule(/^moment_within_[\d.]+s_of_previous$/, 'timeline_conflict'),
  rule(/^speech_locked_moment_within_[\d.]+s_of_previous$/, 'timeline_conflict'),
  rule(/^zoom_within_\d+s_of_previous_zoom$/, 'timeline_conflict'),
  rule(/^zoom_blocked_by_cutaway_or_overlay$/, 'timeline_conflict'),
  rule(/^transition_not_near_a_visual$/, 'timeline_conflict'),
  rule(/^transition_cut_removed_by_layout_priority$/, 'timeline_conflict'),
  rule(/^superseded_by_director_transition$/, 'timeline_conflict'),
  rule(/^duplicate_director_transition$/, 'timeline_conflict'),
  rule(/^overlaps_[a-z_]+_(rank_\d+_below_rank_\d+|equal_rank_directed_(earlier|same_time_longer_or_first))$/, 'timeline_conflict'),
  rule(/^(overlap|self_overlap|broll_overlap|min_gap)$/, 'timeline_conflict'),
  rule(/^temporal_[a-z_]+$/, 'timeline_conflict'),
  rule(/^spatial_[a-z_]+$/, 'timeline_conflict'),
  rule(/^overlap_conflict$/, 'timeline_conflict'),
  // -- invalid / out-of-range parameters ----------------------------------------------------------------------
  rule(/^shorter_than_[\d.]+s_or_inside_(hook_guard|first_[\d.]+s)$/, 'invalid_parameter'),
  rule(/^(invalid_window|too_short|invalid_interval|temporal_invalid_interval)$/, 'invalid_parameter'),
  rule(/^zoom_before_[\d.]+s$/, 'invalid_parameter'),
  rule(/^zoom_has_no_duration_after_timeline_mapping$/, 'invalid_parameter'),
  rule(/^transition_(invalid_interval|outside_video)$/, 'invalid_parameter'),
  rule(/^transition_duration_[\d.]+s_outside_[\d.]+_[\d.]+s$/, 'invalid_parameter'),
  rule(/^hold_window_too_short$/, 'invalid_parameter'),
  rule(/^inside_hook_guard$/, 'invalid_parameter'),
  rule(/^placement_[\d.]+s_is_[\d.]+s_from_directed_[\d.]+s_limit_[\d.]+s$/, 'invalid_parameter'),
  rule(/^duration_out_of_range$/, 'invalid_parameter'),
  rule(/^params_invalid$/, 'invalid_parameter'),
  rule(/^low_res$/, 'invalid_parameter'),
  rule(/^split_dropped_empty$/, 'missing_text_or_asset'),
  // -- missing text or assets ---------------------------------------------------------------------------------
  rule(/^no_asset_match$/, 'missing_text_or_asset'),
  rule(/^no_stock_(photos|video)$/, 'missing_text_or_asset'),
  rule(/^stock_(disabled_or_unconfigured|lookup_failed)$/, 'missing_text_or_asset'),
  rule(/^asset_(missing|unsuitable)$/, 'missing_text_or_asset'),
  rule(/^text_missing$/, 'missing_text_or_asset'),
  // -- missing prerequisites (mask / visual evidence / flag) -------------------------------------------------
  rule(/^(no_mask|needs_speaker_mask|no_safe_region)$/, 'missing_prerequisite'),
  rule(/^no_keyed_speaker_video$/, 'missing_prerequisite'),
  rule(/^focus_without_visual_evidence$/, 'missing_prerequisite'),
  rule(/^transition_has_no_asset_so_TransitionTrack_skips_it$/, 'missing_prerequisite'),
  // -- unsupported ---------------------------------------------------------------------------------------------
  rule(/^unsupported_layout$/, 'unsupported_kind'),
  rule(/^unknown_kind$/, 'unsupported_kind'),
  // -- engine bookkeeping -------------------------------------------------------------------------------------
  rule(/^not_in_planner_output$/, 'engine_limit'),
  rule(/^accepted_but_not_handed_to_renderer$/, 'engine_limit'),
  rule(/^planner_warning:/, 'engine_limit'),
  rule(/^director_v2_failed$/, 'malformed_output'),
  rule(/^(coverage_exceeded|render_failed)$/, 'engine_limit'),
];

/** Reasons that are notes on an accepted edit (not refusals). Registered separately so they are not flagged either. */
export const NOTE_RULES: readonly RegExp[] = [
  /^engine_derived/,
  /^engine_fill:/,
  /^engine_fallback_direction$/,
  /^layout_compositor_moved_anchor$/,
  /^zoom_scale_[\d.]+(_unsupported_default_[\d.]+_used)?$/,
  /^zoom_focus_([\d.]+_[\d.]+|out_of_range_ignored_default_origin_used)$/,
  /^zoom_focus_dropped:(focus_without_visual_evidence|focus_outside_observed_subject|focus_subject_moves)$/,
  /^style_.*_not_recognised_default_keyword_used$/,
  /^temporal_out_of_bounds$/,
];

export function classifyReason(reason: string | undefined): {registered: boolean; category: ReasonCategory | null; isNote: boolean} {
  if (!reason) {
    return {registered: false, category: null, isNote: false};
  }
  // A reason may carry several notes joined with ';' (zoom scale + focus).
  const parts = reason.split(';');
  if (parts.every(part => NOTE_RULES.some(pattern => pattern.test(part)))) {
    return {registered: true, category: null, isNote: true};
  }
  const hit = REASON_RULES.find(candidate => candidate.pattern.test(reason));
  return hit ? {registered: true, category: hit.category, isNote: false} : {registered: false, category: null, isNote: false};
}
