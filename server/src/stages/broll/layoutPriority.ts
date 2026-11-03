/**
 * Explicit priority rules for edits that take over the whole picture (or the whole talking-head frame)
 * and therefore cannot share a moment: cutaways, splits, cutouts, composites, frame insets,
 * media containers and inset reveals.
 *
 * Before this module, which of two overlapping edits survived depended on planner order (cutaways were
 * placed first and inset reveals were blocked by them). The rules below replace that:
 *
 *   rank 4  footage the creator supplied (user-provided cutaway / split)
 *   rank 3  layouts that need a matched asset and speaker geometry: split, cutout, composite
 *   rank 2  full-frame treatments the Director chose: stock cutaway, frame inset, media container, inset reveal
 *
 * Equal rank is NOT resolved in favour of any type. The edit the Director asked for EARLIER in the video
 * wins; if both were asked for at the same moment the longer one wins, then the type name (deterministic).
 * An edit is only dropped when it overlaps an edit that outranks it or wins the tie; non-overlapping
 * edits are always kept together. There are no per-type quotas here.
 */

export type LayoutKind = 'cutaway' | 'split' | 'cutout' | 'composite' | 'frame_inset' | 'media_container' | 'inset_reveal';

export const LAYOUT_RANK = {
  user_supplied: 4,
  matched_layout: 3,
  full_frame_treatment: 2,
} as const;

export function layoutRank(kind: LayoutKind, userSupplied: boolean): number {
  if (userSupplied && (kind === 'cutaway' || kind === 'split')) {
    return LAYOUT_RANK.user_supplied;
  }
  return kind === 'split' || kind === 'cutout' || kind === 'composite' ? LAYOUT_RANK.matched_layout : LAYOUT_RANK.full_frame_treatment;
}

export type LayoutCandidate<T> = {
  item: T;
  kind: LayoutKind;
  userSupplied?: boolean;
  /** Output-time span the edit occupies in the plan. */
  start: number;
  end: number;
  /** Where the Director asked for it (output seconds); used only to break ties. */
  directedStart: number;
};

export type LayoutLoss<T> = {
  item: T;
  kind: LayoutKind;
  winner: T;
  winnerKind: LayoutKind;
  /** `lost_to_<kind>:<rank a> < <rank b>` or `...:equal_rank_earlier_directed_start` etc. */
  reason: string;
};

export function resolveLayoutPriority<T>(candidates: Array<LayoutCandidate<T>>): LayoutLoss<T>[] {
  const ranked = candidates
    .map(candidate => ({...candidate, rank: layoutRank(candidate.kind, Boolean(candidate.userSupplied))}))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        a.directedStart - b.directedStart ||
        b.end - b.start - (a.end - a.start) ||
        a.kind.localeCompare(b.kind),
    );
  const kept: typeof ranked = [];
  const losses: LayoutLoss<T>[] = [];
  for (const candidate of ranked) {
    const winner = kept.find(other => candidate.start < other.end - 1e-6 && candidate.end > other.start + 1e-6);
    if (!winner) {
      kept.push(candidate);
      continue;
    }
    const why =
      winner.rank > candidate.rank
        ? `rank_${candidate.rank}_below_rank_${winner.rank}`
        : winner.directedStart < candidate.directedStart
          ? 'equal_rank_directed_earlier'
          : 'equal_rank_directed_same_time_longer_or_first';
    losses.push({item: candidate.item, kind: candidate.kind, winner: winner.item, winnerKind: winner.kind, reason: `overlaps_${winner.kind}_${why}`});
  }
  return losses;
}
