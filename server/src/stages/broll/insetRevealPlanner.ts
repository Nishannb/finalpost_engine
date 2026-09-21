/**
 * Resolve Director inset_reveal decisions to blueprint clips.
 * Separate from B-roll and depth_overlay: never writes those arrays.
 */

import {stageLogger} from '../../lib/logger.ts';
import {
  defaultInsetRevealParams,
  validateInsetReveals,
  type InsetRevealClip,
} from '../../lib/insetReveal.ts';
import {clamp, round, type Timeline} from '../filters/timeline.ts';
import type {DirectedInsetReveal} from './geminiDirector.ts';
import type {BRollClip, DepthOverlayClip, VisualOverlay} from '../../types/blueprint.ts';

const log = stageLogger('inset-reveal-planner');

export function resolveInsetReveals(input: {
  directed: DirectedInsetReveal[] | undefined;
  timeline: Timeline;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  depthOverlays: DepthOverlayClip[];
  frameInsets?: Array<{start: number; end: number}>;
  mediaContainers?: Array<{start: number; end: number}>;
  words?: Array<{start: number; end: number}>;
  sentences?: Array<{start: number; end: number}>;
  themeColors?: string[];
  alreadyOutput?: boolean;
}): {clips: InsetRevealClip[]; warnings: string[]} {
  const warnings: string[] = [];
  const directed = input.directed ?? [];
  if (directed.length === 0) {
    return {clips: [], warnings};
  }

  const resolved = directed.map((item, index) => {
    const start = input.alreadyOutput
      ? clamp(item.start, 0, input.timeline.outputDurationSec)
      : input.timeline.mapSourceToOutputClamped(item.start);
    const end = input.alreadyOutput
      ? clamp(item.end, start, input.timeline.outputDurationSec)
      : input.timeline.mapSourceToOutputClamped(item.end);
    return {
      id: `inset_${index}`,
      start,
      end,
      variant: item.variant,
      reason: item.reason,
      params: defaultInsetRevealParams({
        variant: item.variant,
        insetScale: item.insetScale,
        background: item.background,
        graphic: item.graphic
          ? {
              templateId:
                item.graphic.templateId === 'stat_callout' ? 'stat_callout' : 'keyword_title',
              text: item.graphic.text,
              data: item.graphic.data,
              enterOffset: -0.12,
              exitOffset: 0.12,
            }
          : undefined,
        captionsEnabled: item.captions,
        easing: item.easing === 'spring' ? 'spring' : 'easeInOutCubic',
        shadow: item.shadow,
        themeColor: input.themeColors?.[0],
      }),
    };
  });

  const blockedRanges = [
    ...input.clips.map(clip => ({start: clip.start, end: clip.end})),
    ...input.overlays
      .filter(
        overlay =>
          overlay.layout === 'split' ||
          overlay.layout === 'cutout' ||
          overlay.layout === 'cutaway' ||
          overlay.layout === 'composite',
      )
      .map(overlay => ({start: overlay.start, end: overlay.end})),
    ...input.depthOverlays.map(clip => ({start: clip.start, end: clip.end})),
    ...(input.frameInsets ?? []).map(clip => ({start: clip.start, end: clip.end})),
    ...(input.mediaContainers ?? []).map(clip => ({start: clip.start, end: clip.end})),
  ];

  const gated = validateInsetReveals({
    clips: resolved,
    outputDurationSec: input.timeline.outputDurationSec,
    blockedRanges,
    words: input.words,
    sentences: input.sentences,
    themeColors: input.themeColors,
  });
  warnings.push(...gated.drops);
  const clips: InsetRevealClip[] = gated.clips.map(clip => ({
    type: 'inset_reveal',
    start: round(clip.start),
    end: round(clip.end),
    params: clip.params,
    reason: clip.reason,
  }));
  if (clips.length > 0) {
    log.info(
      {
        count: clips.length,
        reasons: clips.map(clip => ({
          start: clip.start,
          end: clip.end,
          variant: clip.params.variant,
          reason: clip.reason,
        })),
      },
      'inset reveals placed',
    );
  }
  return {clips, warnings};
}
