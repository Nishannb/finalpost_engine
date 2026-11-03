/**
 * WP45 Layer-2 stage (polish only, POLISH_MOTION_TEMPLATES=1; the caller gates on the flag, this module has no env access). Skill (L1) -> Primitives (L2): the ACTIVE polish skill (faceless / explainer / newsroom_mg / default,
 * from resolvePolishSkill) picks its allowlist, `planMotionTemplateBeats` plans sparse beats from that allowlist only, each beat is published as a full-screen library graphic, and the caption mute ranges of the
 * PUBLISHED beats are returned. It is NOT a skill lane: it never replaces or removes another graphic, never changes a skill's captions / tracks, and carries no SFX (the templates are silent).
 * Beats are never planned over a span the caller marks blocked (full-frame graphics, a mounted explainer's layout media, hook title, clips ...).
 *
 * WP48: always passes spoken words (+ optional still URLs) into publish so live beats are grounded or skipped — never ACME / Bacon Club demos.
 */
import type {MuteRange} from '../../lib/captionMute.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {mapPolishSkillToMotionTemplateSkill, planMotionTemplateBeats, type MotionTemplateSkill, type MotionTemplateWord, type PolishLaneSkill} from './motionTemplateCatalog.ts';
import {publishMotionTemplateBeats, type MotionTemplatePublisher, type PublishedMotionTemplate} from './motionTemplatePublish.ts';

export type MotionTemplateStageResult = {
  graphics: GeneratedGraphic[];
  published: PublishedMotionTemplate[];
  /** Mute ranges (seconds) for the published, frame-owning beats only. */
  muteRanges: MuteRange[];
  /** The allowlist key the plan used (for logs / tests). */
  skill: MotionTemplateSkill;
  warnings: string[];
};

export async function runMotionTemplateStage(input: {
  /** The active lane from resolvePolishSkill. */
  polishSkill: PolishLaneSkill;
  /** Explicit override of the allowlist key (e.g. 'textual_mg' for a Skill C ground); default = the lane skill. */
  skillOverride?: MotionTemplateSkill;
  words: readonly MotionTemplateWord[];
  durationSec: number;
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  /** The edit palette's single accent (#RRGGBB), when the edit has one. */
  accent?: string;
  /** WP49: edit-palette ground / ink (toolkit demo colours must not win). */
  ground?: string;
  ink?: string;
  /** https stills already on this edit (editorial / faceless / stock) for photo templates. */
  imageUrls?: readonly string[];
  publish?: Parameters<typeof publishMotionTemplateBeats>[1] & {publisher?: MotionTemplatePublisher};
}): Promise<MotionTemplateStageResult> {
  const skill = input.skillOverride ?? mapPolishSkillToMotionTemplateSkill(input.polishSkill);
  const plan = planMotionTemplateBeats({skill, durationSec: input.durationSec, words: input.words, blockedRanges: input.blockedRanges});
  const warnings = [...plan.warnings, `polish_motion_templates:skill:${skill}`];
  if (plan.beats.length === 0) return {graphics: [], published: [], muteRanges: [], skill, warnings};
  const accent = input.accent ?? input.publish?.accent;
  const ground = input.ground ?? input.publish?.ground;
  const ink = input.ink ?? input.publish?.ink;
  if (accent) warnings.push(`polish_motion_templates:palette_accent:${accent}`);
  else warnings.push('polish_motion_templates:palette_accent:missing');
  const {published, failed} = await publishMotionTemplateBeats(plan.beats, {
    ...input.publish,
    accent,
    ground,
    ink,
    words: input.words,
    imageUrls: input.imageUrls ?? input.publish?.imageUrls,
    personalize: true,
  });
  if (published.length > 0) warnings.push(`polish_motion_templates:published:${published.length}`);
  if (failed.length > 0) warnings.push(`polish_motion_templates:publish_failed:${failed.length}`);
  if (failed.length > 0 && published.length === 0) warnings.push('polish_motion_templates:ungrounded');
  return {
    graphics: published.map(item => item.graphic),
    published,
    muteRanges: published.filter(item => item.beat.muteCaptions).map(item => ({startSec: item.beat.start, endSec: item.beat.end})),
    skill,
    warnings,
  };
}
