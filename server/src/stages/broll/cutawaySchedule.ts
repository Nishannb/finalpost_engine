/**
 * Beat-preserving cutaway scheduling (CUTAWAY_SCHEDULING=beat_preserving). Pure: no I/O, no env, deterministic.
 *
 * Input: the cutaway clips the planner resolved (each already positioned on its own speech window), in output seconds.
 * Output: for each clip its final window and the ordered adjustments, or a drop with the rule that caused it.
 *
 * Why spacing exists (and what this keeps). Two cutaways closer than the gap leave the speaker on screen for less than a beat
 * between them, the engine places its transitions on clip boundaries, and each clip fades for 0.25 s at both ends (BRollTrack).
 * The pipeline enforces it twice, both by DROPPING the later clip: the planner (1.5 s, `dropOverlappingClips`) and the editorial gate
 * (`cutawayMinGapSec`: 4.5 s, or 3.2 s for list-like talks). After silence trimming, distinct beats are adjacent in output time, so those
 * rules discard whole beats. This scheduler keeps the gate's gap but obtains it by moving starts and shortening earlier clips, and it
 * drops a beat only when the existing constraints cannot hold it, with the rule named. The gate's note "never shift a cutaway later, it
 * desyncs the spoken word from the picture" is honoured by a limit (maxDelayPastDirectedSec) on how far a start may move past the time
 * the Director asked for. Nothing here relaxes a constraint.
 *
 * Algorithm (clips in time order; L = minClipSec; gap = minGapSec):
 *   Phase 1 (which beats fit). Walk the clips, placing each at its earliest start (its window start, or the previous kept clip's
 *     earliest start + L + gap, whichever is later) with every earlier kept clip at its MINIMUM length. A clip is kept if that earliest
 *     start is <= min(directedStart + maxDelayPastDirectedSec, windowEnd - L) and leaves L before the output ends; otherwise it is
 *     dropped with the legacy reason code `clip_within_<gap>s_of_previous_clip` and a cause naming the failing condition.
 *   Phase 2 (windows). Walk the kept clips: start = max(window start, previous end + gap). The end is the window end, capped to the asset's
 *     length (a clip never plays past its asset's last frame; the renderer would LOOP it), possibly extended to the asset's last frame when
 *     the shortfall is at most fitExtensionMaxSec, and never later than the latest end that still lets every later kept beat keep L and the
 *     gap (earlier clips shrink toward L only as much as the later beats need).
 *   Assets shorter than L are not capped (kept legacy loop) and this is recorded.
 * The directed (planned) time is returned unchanged next to the final window.
 */

export type ScheduleClip = {
  id: string;
  /** Resolved window on the output timeline, before scheduling. */
  start: number;
  end: number;
  /** Time the Director asked for, on the output timeline. */
  directedStart: number;
  /** Known length of the asset in seconds; undefined when unknown (stock clips). */
  assetDurationSec?: number;
};

export type ScheduleOptions = {
  minGapSec: number;
  minClipSec: number;
  /** Largest distance between the directed time and the final start, however the start moved (existing planner limit). */
  maxRetimeSec: number;
  /** Largest delay of a start past the directed time (keeps the picture inside the beat the Director pointed at). */
  maxDelayPastDirectedSec: number;
  outputDurationSec: number;
  tailGuardSec: number;
  fitExtensionMaxSec: number;
};

export type Adjustment =
  | {code: 'trimmed_to_asset_duration'; fromEnd: number; toEnd: number; assetDurationSec: number}
  | {code: 'asset_shorter_than_min_clip_looped'; assetDurationSec: number}
  | {code: 'delayed_for_spacing'; fromStart: number; toStart: number; gapSec: number; afterClipId: string}
  | {code: 'shortened_for_next_beat'; fromEnd: number; toEnd: number; nextClipId: string}
  | {code: 'extended_to_asset_end'; fromEnd: number; toEnd: number; assetDurationSec: number}
  | {code: 'truncated_to_beat'; shownSec: number; assetDurationSec: number; limit: 'next_clip' | 'output_end' | 'extension_cap'};

export type DropCause = 'no_room_after_delay' | 'delay_exceeds_directed_limit' | 'delay_exceeds_retime_limit' | 'starts_inside_tail_guard';

export type ScheduleDecision = {
  id: string;
  directedStart: number;
  /** The window the planner resolved, before this scheduler touched it. */
  resolved: {start: number; end: number};
  /** Final window; null when dropped. */
  final: {start: number; end: number} | null;
  adjustments: Adjustment[];
  drop?: {reason: string; cause: DropCause; detail: string; previousClipId: string};
};

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const EPS = 1e-6;

export function scheduleCutaways(clips: ScheduleClip[], options: ScheduleOptions): ScheduleDecision[] {
  const L = options.minClipSec;
  const gap = options.minGapSec;
  /** Placement uses a hair more than the gap so a start never lands a rounding error inside the gap the gate checks (`start < end + gap`). */
  const g = gap + 0.002;
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.directedStart - b.directedStart || a.id.localeCompare(b.id));
  const decisions = new Map<string, ScheduleDecision>();
  const kept: Array<{clip: ScheduleClip; earliest: number; latest: number}> = [];

  // Phase 1: which beats fit at all (earlier beats at minimum length)
  for (const clip of sorted) {
    const decision: ScheduleDecision = {id: clip.id, directedStart: clip.directedStart, resolved: {start: r3(clip.start), end: r3(clip.end)}, final: null, adjustments: []};
    decisions.set(clip.id, decision);
    const previous = kept.at(-1);
    const earliest = previous ? Math.max(clip.start, previous.earliest + L + g) : clip.start;
    const latestByDirected = clip.directedStart + options.maxDelayPastDirectedSec;
    const latestByWindow = clip.end - L;
    const latest = Math.min(latestByDirected, latestByWindow);
    const reason = `clip_within_${gap}s_of_previous_clip`;
    const fail = (cause: DropCause, detail: string) => {
      decision.drop = {reason, cause, detail, previousClipId: previous?.clip.id ?? ''};
    };
    if (previous && earliest - clip.directedStart > options.maxRetimeSec + EPS) {
      fail('delay_exceeds_retime_limit', `earliest start ${r3(earliest)}s is ${r3(earliest - clip.directedStart)}s from the directed ${r3(clip.directedStart)}s (limit ${options.maxRetimeSec}s)`);
    } else if (earliest + L > options.outputDurationSec - options.tailGuardSec + EPS) {
      fail('starts_inside_tail_guard', `earliest start ${r3(earliest)}s leaves less than ${L}s before the ${r3(options.outputDurationSec)}s output ends`);
    } else if (earliest > latestByDirected + EPS) {
      fail('delay_exceeds_directed_limit', `keeping ${gap}s after the previous kept beat puts the start at ${r3(earliest)}s, more than ${options.maxDelayPastDirectedSec}s after the directed ${r3(clip.directedStart)}s`);
    } else if (earliest > latest + EPS) {
      fail('no_room_after_delay', `keeping ${gap}s after the previous kept beat puts the start at ${r3(earliest)}s, leaving ${r3(Math.max(0, clip.end - earliest))}s of its ${r3(clip.end)}s window (minimum ${L}s)`);
    }
    if (decision.drop) {
      continue;
    }
    kept.push({clip, earliest, latest});
  }

  // latest start each kept clip may have while every later kept clip still fits
  const chainLatest: number[] = new Array(kept.length);
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    chainLatest[i] = i === kept.length - 1 ? kept[i]!.latest : Math.min(kept[i]!.latest, chainLatest[i + 1]! - g - L);
  }

  // Phase 2: windows
  let previousEnd: number | null = null;
  let previousId = '';
  for (let i = 0; i < kept.length; i += 1) {
    const {clip} = kept[i]!;
    const decision = decisions.get(clip.id)!;
    const start = previousEnd === null ? clip.start : Math.max(clip.start, previousEnd + g);
    const asset = clip.assetDurationSec;
    const capped = asset !== undefined && asset >= L;
    if (start > clip.start + EPS) {
      decision.adjustments.push({code: 'delayed_for_spacing', fromStart: r3(clip.start), toStart: r3(start), gapSec: gap, afterClipId: previousId});
    }
    // end: the window end, capped to the asset; then no later than the beat after this one allows; then (if room and a small shortfall) the asset's last frame
    let end = clip.end;
    if (capped && end - start > asset! + EPS) {
      decision.adjustments.push({code: 'trimmed_to_asset_duration', fromEnd: r3(end), toEnd: r3(start + asset!), assetDurationSec: r3(asset!)});
      end = start + asset!;
    } else if (asset !== undefined && !capped && end - start > asset + EPS) {
      decision.adjustments.push({code: 'asset_shorter_than_min_clip_looped', assetDurationSec: r3(asset)});
    }
    const next = kept[i + 1];
    const bound = next ? Math.max(start + L, chainLatest[i + 1]! - g) : options.outputDurationSec - options.tailGuardSec;
    let shortenedFor: string | null = null;
    if (next && end > bound + EPS) {
      decision.adjustments.push({code: 'shortened_for_next_beat', fromEnd: r3(end), toEnd: r3(bound), nextClipId: next.clip.id});
      end = bound;
      shortenedFor = next.clip.id;
    }
    if (capped) {
      const shortfall = start + asset! - end;
      // the extension may only use space no later beat needs: it never pushes the next clip later than that clip would start anyway
      const extensionLimit = next ? Math.min(bound, next.clip.start - g) : bound;
      if (!shortenedFor && shortfall > 0.05 && shortfall <= options.fitExtensionMaxSec + EPS && start + asset! <= extensionLimit + EPS) {
        decision.adjustments.push({code: 'extended_to_asset_end', fromEnd: r3(end), toEnd: r3(start + asset!), assetDurationSec: r3(asset!)});
        end = start + asset!;
      }
    }
    end = Math.min(end, options.outputDurationSec);
    if (capped) {
      const shown = end - start;
      const shortfall = asset! - shown;
      if (shortfall > 0.05) {
        const limit: 'next_clip' | 'output_end' | 'extension_cap' = shortenedFor ? 'next_clip' : shortfall > options.fitExtensionMaxSec + EPS ? 'extension_cap' : next ? 'next_clip' : 'output_end';
        decision.adjustments.push({code: 'truncated_to_beat', shownSec: r3(shown), assetDurationSec: r3(asset!), limit});
      }
    }
    decision.final = {start: r3(start), end: r3(end)};
    previousEnd = end;
    previousId = clip.id;
  }
  return sorted.map(clip => decisions.get(clip.id)!);
}
