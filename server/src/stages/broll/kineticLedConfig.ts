/**
 * WP57 Kinetic-Led style bible (pure). Flag stays off in env; planners opt in via `kineticLed: true`.
 * Canon: remotion/out/phase36-readiness/KINETIC_LED_STYLE_BIBLE.md
 */
export const KINETIC_LED_CONFIG = {
  enabled: false,
  style: {
    background: '#F7F6F2',
    primaryText: '#171717',
    secondaryText: '#85837E',
    /** One muted signal. Not neon lime, not website blue. */
    accent: '#3D4A5C',
    accentCount: 1,
    avoidHeavyOutlines: true,
    avoidRandomGradients: true,
  },
  density: {
    targetSecondsPerBeat: 3.5,
    minimumSecondsPerBeat: 2,
    maximumSecondsPerBeat: 6,
  },
  captions: {
    enabled: true,
    persistDuringOverlays: true,
  },
  composition: {
    protectFace: true,
    useNegativeSpace: true,
    allowFullFrameTypography: true,
  },
  quality: {
    minimumScore: 22,
    minimumDimensionScore: 3,
    minimumSyncScore: 4,
    minimumCopyRelevanceScore: 4,
  },
} as const;

/** Hard ceiling so a long talking-head does not become a type strobe. */
export const KINETIC_LED_HARD_CAP = 24;

/**
 * Beats for kinetic-led mode. ~duration/3.5, never tighter than 1 per `minimumSecondsPerBeat`, never above the hard cap.
 * Clips under 8s plan nothing (same floor as the sparse planner).
 */
export function kineticLedBeatBudget(durationSec: number): number {
  if (!(durationSec >= 8)) return 0;
  const target = Math.round(durationSec / KINETIC_LED_CONFIG.density.targetSecondsPerBeat);
  const hard = Math.floor(durationSec / KINETIC_LED_CONFIG.density.minimumSecondsPerBeat);
  return Math.min(KINETIC_LED_HARD_CAP, hard, Math.max(1, target));
}

// ------------------------------------------------------------------------------------------------ person matte (RVM) in kinetic-led mode
/** The pad (seconds) the matte ranges get on each side of a planned beat (`outputWindowsToSourceRanges`). Also the matted-footage accounting pad. */
export const MATTE_RANGE_PAD_SEC = 0.3;

/** Share of the kinetic-led beat budget that is FILLED FIRST with matte-occlusion beats when a usable person matte exists (a priority target, not a cap). */
export const KINETIC_MATTE_QUOTA_SHARE = 0.4;
/** Hard cap on seconds of matted footage per edit: CPU inference is ~0.4 s/frame, a GPU / Apple MPS device ~0.12 s/frame (measured on 720x1280). */
export const KINETIC_MATTE_BUDGET_CPU_SEC = 20;
export const KINETIC_MATTE_BUDGET_GPU_SEC = 45;

/** Pass 1 spreads the matte beats: no two are planned closer than this (seconds), so the depth moments are distributed through the edit, not packed at the start. Pass 2 may still add more. */
export const KINETIC_MATTE_MIN_SPACING_SEC = 6;

export function kineticMatteQuota(beatBudget: number): number {
  return beatBudget > 0 ? Math.max(1, Math.round(beatBudget * KINETIC_MATTE_QUOTA_SHARE)) : 0;
}

/**
 * Matted-footage budget for the configured RVM device. Only an EXPLICIT `mps` / `cuda` earns the larger budget: `auto` (which may resolve to the GPU) cannot be known at plan time without running torch, and
 * `cpu` / unset / anything else is the conservative 20 s.
 */
export function matteBudgetSecForDevice(device: string | undefined): number {
  const d = (device ?? '').trim().toLowerCase();
  return d === 'mps' || d === 'cuda' ? KINETIC_MATTE_BUDGET_GPU_SEC : KINETIC_MATTE_BUDGET_CPU_SEC;
}

/**
 * Templates that may draw BEHIND the presenter. Word pop is intentionally excluded: small type behind the body is mostly hidden and unreadable;
 * behind-subject is reserved for oversized environmental-hero words with a sweep reveal.
 */
export const KINETIC_MATTE_TEMPLATE_IDS = ['clip_45_type_environmental_hero'] as const;

/**
 * True when THIS planned beat uses the person matte. The environmental hero does unless demoted to headroom (`hint.occlusion === 'none'`, or no-matte `occlusionFallback`).
 * Pure: matte ranges, foreground spans and the coverage guard all use this one rule.
 */
export function isMatteBeat(beat: {templateId: string; hint?: Record<string, unknown>}): boolean {
  if (beat.templateId !== 'clip_45_type_environmental_hero') return false;
  return beat.hint?.occlusion !== 'none' && beat.hint?.occlusionFallback === undefined;
}

export type KineticMotionFamily =
  | 'match_cut'
  | 'word_reveal'
  | 'line_build'
  | 'scale_emphasis'
  | 'mask_reveal'
  | 'split_phrase'
  | 'tracking_expansion'
  | 'full_frame';

/** Bible motion family for a catalog template id. Unknown ids count as line_build. */
export function kineticMotionFamily(templateId: string): KineticMotionFamily {
  if (/text_match_cut/.test(templateId)) return 'match_cut';
  if (/word_reveal|word_pop|char_stagger|illustrated_emphasis|environmental_hero/.test(templateId)) return 'word_reveal';
  if (/line_mask/.test(templateId)) return 'mask_reveal';
  if (/weight_morph|impact_number/.test(templateId)) return 'scale_emphasis';
  if (/split_color/.test(templateId)) return 'split_phrase';
  if (/stacked_statement/.test(templateId)) return 'tracking_expansion';
  if (/type_word_reveal|type_line_mask|type_char_stagger|type_weight_morph/.test(templateId) && /clip_3[5-8]/.test(templateId)) return 'full_frame';
  if (/staggered|kinetic_cta|logo_reveal|social_proof/.test(templateId)) return 'line_build';
  return 'line_build';
}

/** True when this family would be the 4th consecutive use (bible: never four in a row). */
export function familyRepeatsTooOften(recent: readonly string[], family: string): boolean {
  return recent.length >= 3 && recent.slice(-3).every(item => item === family);
}

export type KineticFaceAnchor = 'headroom' | 'lower_third' | 'left' | 'right' | 'center';

/**
 * Bible §B. `box` is fractions of the frame (subject / face occupancy). Wide = small box → centred type.
 * Centre face with room above → headroom; otherwise lower third. Never implies drawing over the eyes.
 */
export function kineticAnchorForSubject(box: {x: number; y: number; w: number; h: number}): KineticFaceAnchor {
  if (box.w < 0.35 && box.h < 0.45) return 'center';
  if (box.y < 0.12) return 'lower_third';
  const cx = box.x + box.w / 2;
  if (cx < 0.4) return 'right';
  if (cx > 0.6) return 'left';
  if (box.y >= 0.18) return 'headroom';
  return 'lower_third';
}

/** A kinetic impact-number beat already covers this stat window — demote a competing StatHighlight. */
export function shouldDemoteCompetingStat(
  statStart: number,
  kineticBeats: readonly {start: number; end: number; templateId: string}[],
): boolean {
  return kineticBeats.some(
    beat => beat.templateId.includes('impact_number') && statStart < beat.end + 0.4 && statStart > beat.start - 1.5,
  );
}
