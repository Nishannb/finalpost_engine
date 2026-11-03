/**
 * WP49 / WP56: when the picture sits still (same full-frame talking-head / open span) for too long, schedule
 * `frameInsets` so the whole 9:16 retracts then restores — interactive motion without needing a toolkit beat.
 * WP56: one inset per open span, hold ~5.5s, wide gap — never spam retract every ~1–3s.
 * Pure planner. Analyze merges these into `broll.frameInsets` on the polish path.
 */
import type {FrameInset} from '../../types/blueprint.ts';

export const STILLNESS_TRIGGER_SEC = 3.2;
/** WP56: hold the inset frame 5–6s, then restore (was 1.35s — caused spam). */
export const STILLNESS_INSET_HOLD_SEC = 5.5;
/** WP56: leave a long breath before another stillness inset elsewhere. */
export const STILLNESS_MIN_GAP_SEC = 12;
export const STILLNESS_INSET_SCALE = 0.86;
export const STILLNESS_TRANSITION_SEC = 0.55;
/** WP56: at most two stillness insets per minute of runtime. */
export const STILLNESS_MAX_PER_60S = 2;

export type StillnessRange = {start: number; end: number};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Merge overlapping / touching blocked ranges and sort. */
export function mergeRanges(ranges: readonly StillnessRange[]): StillnessRange[] {
  const sorted = [...ranges].filter(r => r.end > r.start + 1e-9).sort((a, b) => a.start - b.start);
  const out: StillnessRange[] = [];
  for (const range of sorted) {
    const prev = out[out.length - 1];
    if (!prev || range.start > prev.end + 1e-6) out.push({start: range.start, end: range.end});
    else prev.end = Math.max(prev.end, range.end);
  }
  return out;
}

/** Open (unblocked) spans inside [0, durationSec]. */
export function openSpans(durationSec: number, blocked: readonly StillnessRange[]): StillnessRange[] {
  const duration = Math.max(0, durationSec);
  if (duration < 1e-6) return [];
  const merged = mergeRanges(blocked.map(r => ({start: Math.max(0, r.start), end: Math.min(duration, r.end)})));
  const open: StillnessRange[] = [];
  let cursor = 0;
  for (const block of merged) {
    if (block.start > cursor + 1e-6) open.push({start: cursor, end: block.start});
    cursor = Math.max(cursor, block.end);
  }
  if (duration > cursor + 1e-6) open.push({start: cursor, end: duration});
  return open;
}

/**
 * Place frame insets inside long open spans. First inset lands after STILLNESS_TRIGGER_SEC of stillness.
 * WP56: at most ONE inset per open span (retract → hold → restore); further spans respect STILLNESS_MIN_GAP_SEC.
 */
export function planStillnessFrameInsets(input: {
  durationSec: number;
  /** Spans that already own the frame (opaque graphics, cutaways, motion templates, existing insets, …). */
  blockedRanges?: readonly StillnessRange[];
  existingInsets?: readonly StillnessRange[];
  /** Margin colour (prefer Color Director / paper ground; ink_black when palette is ink). */
  marginColor?: string;
  scale?: number;
  holdSec?: number;
  triggerSec?: number;
  minGapSec?: number;
  maxInsets?: number;
}): {insets: FrameInset[]; warnings: string[]} {
  const durationSec = Math.max(0, input.durationSec);
  const trigger = input.triggerSec ?? STILLNESS_TRIGGER_SEC;
  const hold = input.holdSec ?? STILLNESS_INSET_HOLD_SEC;
  const minGap = input.minGapSec ?? STILLNESS_MIN_GAP_SEC;
  const scale = input.scale ?? STILLNESS_INSET_SCALE;
  const marginColor = input.marginColor && /^#[0-9a-fA-F]{6}$/.test(input.marginColor) ? input.marginColor : '#FAFAF7';
  const maxInsets = Math.min(
    input.maxInsets ?? Math.max(1, Math.ceil((durationSec / 60) * STILLNESS_MAX_PER_60S)),
    STILLNESS_MAX_PER_60S + (durationSec > 90 ? 1 : 0),
  );
  const warnings: string[] = [];
  if (durationSec < trigger + hold) {
    warnings.push('polish_stillness_insets:skipped:short');
    return {insets: [], warnings};
  }

  const blocked = mergeRanges([...(input.blockedRanges ?? []), ...(input.existingInsets ?? [])]);
  const opens = openSpans(durationSec, blocked);
  const insets: FrameInset[] = [];
  let lastEnd = -Infinity;

  for (const span of opens) {
    if (insets.length >= maxInsets) break;
    if (span.end - span.start < trigger + hold - 1e-6) continue;
    // WP56: one inset per open span — place after trigger, hold, restore; do not loop.
    const start = round3(Math.max(span.start + trigger, lastEnd + minGap));
    const end = round3(Math.min(span.end, start + hold));
    if (end - start < hold * 0.85) continue;
    if (start < span.start - 1e-6 || start + hold * 0.85 > span.end + 1e-6) continue;
    const collision = [...blocked, ...insets].some(r => r.start < end && r.end > start);
    if (collision) continue;
    insets.push({
      start,
      end,
      scale,
      marginColor,
      cornerRadius: 18,
      transitionSec: STILLNESS_TRANSITION_SEC,
    });
    lastEnd = end;
  }

  warnings.push(`polish_stillness_insets:planned:${insets.length}`);
  return {insets, warnings};
}
