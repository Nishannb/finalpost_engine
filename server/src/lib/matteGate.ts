/**
 * WP8C: the SERVER-SIDE matte gate: may the plan put anything behind the speaker (text-behind, depth overlay, subject cutout)? PURE: no env, no logger, no I/O. The caller passes what analyzeVideo
 * already knows. It decides `usable` and a `reason`; it never creates or guesses a matte (no mask evidence, no matte).
 *
 * Relation to the compositor: `remotion/src/motion/masks.ts` `decideTextBehindSubject` and `components/TextBehindSubjectTrack.tsx` decide at RENDER time and stay fail-closed (no alpha video or an
 * unusable keyed cutout -> the track draws nothing). This gate is the PLANNING source of truth, so the plan does not ask for an effect the compositor will refuse. It is stricter or equal to
 * the compositor, never looser: `usable` here never overrides the compositor.
 *
 * Two phases, one function:
 *   planning (no `extract`): the matte CAN be made. Needs a measured speaker (not the silent default box) and a keyable cutout (`cutout.available`, from the still-frame check).
 *   final (`extract` given):  the matte WAS made. If an extraction was attempted it must have produced a video; if none was needed the planning answer stands.
 * Reasons, first match wins: unmeasured (the occupancy is flagged unmeasured), fallback_box (the speaker box is the default guess), no_mask (no keyable cutout), low_confidence (a confidence is given
 * and is below `MIN_MATTE_CONFIDENCE`), extract_failed (final phase: attempted, no video), ok.
 */
export type MatteReason = 'ok' | 'unmeasured' | 'fallback_box' | 'no_mask' | 'low_confidence' | 'extract_failed';

export type MatteGate = {usable: boolean; reason: MatteReason};

export type MatteGateInput = {
  occupancy: {source: 'vision' | 'fallback'; unmeasured?: boolean};
  cutout: {available: boolean};
  /** Optional 0..1 confidence of the keyed matte, when something measured one. Absent = not judged. */
  confidence?: number;
  /** Final phase only: whether an extraction was attempted and the video it produced (if any). */
  extract?: {attempted: boolean; videoUrl?: string};
};

export const MIN_MATTE_CONFIDENCE = 0.5;

export function decideMatteGate(input: MatteGateInput): MatteGate {
  if (input.occupancy.unmeasured) return {usable: false, reason: 'unmeasured'};
  if (input.occupancy.source !== 'vision') return {usable: false, reason: 'fallback_box'};
  if (!input.cutout.available) return {usable: false, reason: 'no_mask'};
  if (typeof input.confidence === 'number' && !(input.confidence >= MIN_MATTE_CONFIDENCE)) return {usable: false, reason: 'low_confidence'};
  if (input.extract?.attempted && !input.extract.videoUrl?.trim()) return {usable: false, reason: 'extract_failed'};
  return {usable: true, reason: 'ok'};
}

/** `matte_gate:ok` or `matte_gate:unusable:<reason>`. */
export function matteGateWarning(gate: MatteGate): string {
  return gate.usable ? 'matte_gate:ok' : `matte_gate:unusable:${gate.reason}`;
}

/** Warning when behind-subject elements (text-behind / depth) were planned but the final gate says there is no usable matte. */
export const TEXT_BEHIND_SKIPPED_WARNING = 'text_behind_skipped:no_matte';
