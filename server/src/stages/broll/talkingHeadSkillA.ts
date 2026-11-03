/**
 * WP38: SKILL A TOOLS ON CLASSIC TALKING-HEAD POLISH. PURE (no env, no I/O, no network).
 *
 * "Classic" = polish with NEITHER `POLISH_FACELESS_DOC` (Skill A, 100 % faceless) NOR `POLISH_EXPLAINER_SKILL` (Skill B) on. The face stays the primary picture; the Skill A TOOLS are borrowed:
 *   1. WP33 VO cut grammar      cut anchors / chapter cards (already planned for every polish edit by `POLISH_VO_CUT_GRAMMAR`, default on)
 *   2. WP34 accumulate captions (already applied to every polish edit by `POLISH_ACCUMULATE_CAPTIONS`, default on) -> WP38 only moves the line to the FACE-SAFE band (y 55-60 %, not the faceless 42-50 %)
 *   3. WP35 impact FX           (already planned for every polish edit by `POLISH_IMPACT_FX`, default on) -> unchanged, reported here
 *   4. WP30 / WP37 editorial stills in the gaps, with TIGHTER caps so the face stays on screen >= 72 % of the runtime (<= 1 open run + <= 2 short mid runs, 3-4 stills each, <= 25 % of the runtime)
 * `POLISH_TH_SKILL_A_TOOLS` (default on) switches ONLY items 2 (position) and 4 (caps) and the summary warnings; items 1 and 3 keep their own flags. Off = the pre-WP38 behaviour exactly (y 46 %, WP30 caps).
 *
 * NOT a faceless lane: nothing here plans a still per cut, hides the speaker, or touches the Skill A / Skill B planners. `resolveTalkingHeadSkillA` is false whenever either skill flag is on.
 */
import type {CaptionDirection} from '../../types/blueprint.ts';

/** Face-safe accumulate line centre (fraction of the frame height): chest / lower third, below a centred face. Renderer band [0.55, 0.60]. */
export const TH_CAPTION_FACE_SAFE_Y_FRAC = 0.58;
export const TH_CAPTION_FACE_SAFE_Y_BAND = {min: 0.55, max: 0.6} as const;

/** The face is the primary picture: stills may cover at most this fraction of the runtime (and at most `TH_STILLS_MAX_SEC`), and stills + everything else already covering the face (chapter cards, cutaways, full graphics)
 *  at most `TH_NON_FACE_MAX_FRAC` of it, so the face is on screen >= 72 % of the runtime... */
export const TH_STILLS_MAX_FRAC = 0.25;
export const TH_NON_FACE_MAX_FRAC = 0.28;
export const TH_STILLS_MAX_SEC = 14;
/** ... in the first `TH_OPEN_SEC` seconds one run at most, then up to two short claim-beat runs. */
export const TH_OPEN_SEC = 12;
export const TH_MAX_OPEN_RUNS = 1;
export const TH_MAX_MID_RUNS = 2;
export const TH_MAX_OPEN_ITEMS = 4;
export const TH_MAX_MID_ITEMS = 3;
/** Each run is short (3 stills x 1.8 s): an insert, never a take-over. */
export const TH_MAX_RUN_SEC = 5.4;

export type TalkingHeadSkillAFlags = {polish: boolean; skillAToolsEnabled: boolean; faceless: boolean; explainer: boolean};

/** True only for classic polish (no faceless, no explainer) with the WP38 switch on. Skill A / B opt-ins always win: they keep their own behaviour. */
export const resolveTalkingHeadSkillA = (flags: TalkingHeadSkillAFlags): boolean => flags.polish && flags.skillAToolsEnabled && !flags.faceless && !flags.explainer;

/** The WP34 accumulate direction moved to the face-safe band. Only an accumulate direction is touched (CaptionKit presets / style guides / named templates never got one). Idempotent. */
export function talkingHeadCaption(caption: CaptionDirection): {caption: CaptionDirection; warnings: string[]} {
  if (caption.mode !== 'word_by_word_accumulate') return {caption, warnings: []};
  return {caption: {...caption, faceSafeYFrac: TH_CAPTION_FACE_SAFE_Y_FRAC}, warnings: [`polish_th_skill_a:caption_y:${Math.round(TH_CAPTION_FACE_SAFE_Y_FRAC * 100)}`]};
}

/** The tighter `planEditorialStillMontage` options for a talking-head run of `durationSec`; `coveredSec` = seconds the face is already hidden by other full-frame beats (blocked ranges), which come out of the same budget. */
export function talkingHeadStillOptions(durationSec: number, coveredSec = 0): {openSec: number; maxOpenRuns: number; maxMidRuns: number; maxOpenItems: number; maxMidItems: number; maxRunSec: number; maxTotalSec: number} {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const covered = Number.isFinite(coveredSec) ? Math.max(0, coveredSec) : 0;
  return {
    openSec: Math.min(TH_OPEN_SEC, duration),
    maxOpenRuns: TH_MAX_OPEN_RUNS,
    maxMidRuns: TH_MAX_MID_RUNS,
    maxOpenItems: TH_MAX_OPEN_ITEMS,
    maxMidItems: TH_MAX_MID_ITEMS,
    maxRunSec: TH_MAX_RUN_SEC,
    maxTotalSec: Math.floor(1000 * Math.max(0, Math.min(TH_STILLS_MAX_SEC, duration * TH_STILLS_MAX_FRAC, duration * TH_NON_FACE_MAX_FRAC - covered))) / 1000, // rounded DOWN: a cap never rounds up past its fraction
  };
}

export type TalkingHeadSkillASummary = {
  cutPlanned: boolean;
  cuts: number;
  chapterCards: number;
  accumulate: boolean;
  fx: {flashes: number; satPops: number; punchIns: number; bwSpans: number} | null;
  stills: number;
  stillSec: number;
  durationSec: number;
};

/** Honest one-line-per-tool report: what actually fired on this edit (a tool that did not fire says so). Never claims a tool that is off. */
export function talkingHeadSkillAWarnings(summary: TalkingHeadSkillASummary): string[] {
  const out: string[] = [];
  out.push(summary.cutPlanned ? `polish_th_skill_a:cuts:${summary.cuts}` : 'polish_th_skill_a:no_cut_plan');
  if (summary.cutPlanned && summary.chapterCards > 0) out.push(`polish_th_skill_a:chapter_cards:${summary.chapterCards}`);
  out.push(summary.accumulate ? 'polish_th_skill_a:accumulate:on' : 'polish_th_skill_a:accumulate:off');
  const fx = summary.fx;
  const fxTotal = fx ? fx.flashes + fx.satPops + fx.punchIns + fx.bwSpans : 0;
  out.push(fx && fxTotal > 0 ? `polish_th_skill_a:fx:${fx.flashes}f/${fx.satPops}s/${fx.punchIns}p/${fx.bwSpans}bw` : 'polish_th_skill_a:fx:none');
  out.push(`polish_th_skill_a:stills:${summary.stills}`);
  if (summary.durationSec > 0) out.push(`polish_th_skill_a:stills_pct:${Math.round(Math.min(1, summary.stillSec / summary.durationSec) * 100)}`);
  return out;
}
