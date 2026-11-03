/**
 * WP43 Skill C stage (polish only, POLISH_TEXTUAL_MG=1; the caller gates on the flag, this module has no env access). Plans sparse textual MG plates from the spoken words, publishes them as `TextualMgPlate`
 * library graphics and returns the graphics to append plus the caption mute ranges of the PUBLISHED plates. It never replaces or removes another graphic and never touches Skill A / Skill B caption modes:
 * the only caption effect is `captionMuteRanges` (the captions hide while a plate owns the words). Plates are never planned over a full-frame graphic, a hook title or a mounted explainer's cutaway media
 * (the caller passes those spans as `blockedRanges`).
 */
import type {MuteRange} from '../../lib/captionMute.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {publishTextualMgPlates, type PublishedTextualMg, type TextualMgPublisher} from './textualMgPublish.ts';
import {planTextualMgPlates, type TextualMgWord} from './textualMgPlanner.ts';

export type TextualMgStageResult = {
  graphics: GeneratedGraphic[];
  published: PublishedTextualMg[];
  /** Mute ranges (seconds) for the published plates only. */
  muteRanges: MuteRange[];
  warnings: string[];
};

export async function runTextualMgStage(input: {
  words: readonly TextualMgWord[];
  durationSec: number;
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  publish?: Parameters<typeof publishTextualMgPlates>[1] & {publisher?: TextualMgPublisher};
}): Promise<TextualMgStageResult> {
  const plan = planTextualMgPlates({durationSec: input.durationSec, words: input.words, blockedRanges: input.blockedRanges});
  const warnings = [...plan.warnings];
  if (plan.plates.length === 0) return {graphics: [], published: [], muteRanges: [], warnings};
  const {published, failed} = await publishTextualMgPlates(plan.plates, input.publish);
  if (published.length > 0) warnings.push(`polish_textual_mg:published:${published.length}`);
  if (failed.length > 0) warnings.push(`polish_textual_mg:publish_failed:${failed.length}`);
  return {
    graphics: published.map(item => item.graphic),
    published,
    muteRanges: published.filter(item => item.plate.muteCaptions).map(item => ({startSec: item.plate.start, endSec: item.plate.end})),
    warnings,
  };
}
