/**
 * WP54 stage (polish only; the caller gates on POLISH_MOTION_TEMPLATES — one flag, this module has no env access): plans the native craft beats (clip_35..44) from the transcript, publishes each through the same grounded path as
 * the WP45 templates (bind -> library registry -> publishGraphicSource) and returns the caption mute ranges of the PUBLISHED frame-owning beats only. Overlay beats (mesh ground) never mute. Silent. A failure places nothing.
 */
import type {MuteRange} from '../../lib/captionMute.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {mapPolishSkillToMotionTemplateSkill, type MotionTemplateSkill, type MotionTemplateWord, type PolishLaneSkill} from './motionTemplateCatalog.ts';
import {publishMotionTemplateBeats, type MotionTemplatePublisher, type PublishedMotionTemplate} from './motionTemplatePublish.ts';
import type {SubjectMatteInput} from './motionTemplateBind.ts';
import {planCraftTemplateBeats} from './planCraftTemplateBeats.ts';

export const CRAFT_TEMPLATE_GRAPHIC_ID_PREFIX = 'craft_template_';

export type CraftTemplateStageResult = {
  graphics: GeneratedGraphic[];
  published: PublishedMotionTemplate[];
  plannedRanges: Array<{start: number; end: number}>;
  muteRanges: MuteRange[];
  skill: MotionTemplateSkill;
  warnings: string[];
};

export async function runCraftTemplateStage(input: {
  polishSkill: PolishLaneSkill;
  skillOverride?: MotionTemplateSkill;
  words: readonly MotionTemplateWord[];
  durationSec: number;
  contentType?: string | null;
  screenshotUrls?: readonly string[];
  imageUrls?: readonly string[];
  logoSrc?: string;
  assetBriefPrices?: readonly number[];
  existingFullscreenCount?: number;
  /** WP55 KINETIC_TYPE_STORYTELLING inputs: creator brand name, creator-provided post stills, and the person matte (one cached segmentation pass per source video). */
  brandName?: string;
  socialImageUrls?: readonly string[];
  subjectMatte?: SubjectMatteInput;
  subjectBox?: {x: number; y: number; w: number; h: number};
  /** WP55 phase 2: the live Director's kinetic-type choices (see planCraftTemplateBeats). */
  directed?: Parameters<typeof planCraftTemplateBeats>[0]['directed'];
  /** WP57 Kinetic-Led spine. Default off. */
  kineticLed?: boolean;
  /** Phase D: matted-footage cap (seconds) for kinetic-led planning with a usable matte (see planCraftTemplateBeats). */
  matteBudgetSec?: number;
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  accent?: string;
  ground?: string;
  ink?: string;
  publish?: Parameters<typeof publishMotionTemplateBeats>[1] & {publisher?: MotionTemplatePublisher};
}): Promise<CraftTemplateStageResult> {
  const skill = input.skillOverride ?? mapPolishSkillToMotionTemplateSkill(input.polishSkill);
  const plan = planCraftTemplateBeats({
    skill,
    durationSec: input.durationSec,
    words: input.words,
    contentType: input.contentType,
    screenshotUrls: input.screenshotUrls,
    imageUrls: input.imageUrls,
    logoSrc: input.logoSrc,
    assetBriefPrices: input.assetBriefPrices,
    existingFullscreenCount: input.existingFullscreenCount,
    brandName: input.brandName,
    socialImageUrls: input.socialImageUrls,
    subjectMatte: input.subjectMatte,
    subjectBox: input.subjectBox,
    directed: input.directed,
    kineticLed: input.kineticLed,
    matteBudgetSec: input.matteBudgetSec,
    blockedRanges: input.blockedRanges,
  });
  const warnings = [...plan.warnings];
  if (plan.beats.length === 0) return {graphics: [], published: [], plannedRanges: [], muteRanges: [], skill, warnings};
  const {published, failed} = await publishMotionTemplateBeats(plan.beats, {
    ...input.publish,
    idPrefix: CRAFT_TEMPLATE_GRAPHIC_ID_PREFIX,
    accent: input.accent ?? input.publish?.accent,
    ground: input.ground ?? input.publish?.ground,
    ink: input.ink ?? input.publish?.ink,
    words: input.words,
    imageUrls: input.imageUrls,
    screenshotUrls: input.screenshotUrls,
    logoSrc: input.logoSrc,
    assetBriefPrices: input.assetBriefPrices,
    brandName: input.brandName,
    socialImageUrls: input.socialImageUrls,
    subjectMatte: input.subjectMatte,
    personalize: true,
  });
  if (published.length > 0) warnings.push(`craft_templates:published:${published.length}`);
  if (failed.length > 0) warnings.push(`craft_templates:publish_failed:${failed.length}`);
  return {
    graphics: published.map(item => item.graphic),
    published,
    plannedRanges: published.map(item => ({start: item.beat.start, end: item.beat.end})),
    muteRanges: published.filter(item => item.beat.muteCaptions).map(item => ({startSec: item.beat.start, endSec: item.beat.end})),
    skill,
    warnings,
  };
}
