/**
 * Glue between analyzeVideo and the pure pieces: the brief for placement (with the REAL cut counts and the known hook/CTA times) and the placement itself.
 * No I/O. Used only when MUSIC_PERSONALIZE is on.
 */

import {buildIntensityCurve} from './intensity.ts';
import {buildMusicBrief, type MusicBrief, type MusicFamily} from './musicBrief.ts';
import {placeMusic, type Placement} from './placement.ts';
import type {BedPlacementMeta} from './placementMeta.ts';

/** When the hook payoff lands: the end of the hook window, kept between 1.5 s and 6 s. 2.5 s when the window is unknown. */
export function hookAtFrom(hookStartSec: number | undefined, hookDurationSec: number | undefined, fallback = 2.5): number {
  if (!hookDurationSec || hookDurationSec <= 0) return fallback;
  return Math.min(6, Math.max(1.5, (hookStartSec ?? 0) + hookDurationSec));
}

export type PlacementPlanInput = {
  videoId: string;
  words: ReadonlyArray<{start: number; end: number}>;
  durationSec: number;
  visualMood?: string;
  contentType?: string;
  fallbackFamily?: MusicFamily;
  cutTimesSec: ReadonlyArray<number>;
  zoomTimesSec: ReadonlyArray<number>;
  plateTimesSec: ReadonlyArray<number>;
  popTimesSec: ReadonlyArray<number>;
  hookStartSec?: number;
  hookDurationSec?: number;
  ctaAtSec?: number | null;
  bed: BedPlacementMeta | undefined;
};

export function planPlacement(input: PlacementPlanInput): {brief: MusicBrief; placement: Placement; intensity: number[]} {
  const brief = buildMusicBrief({
    videoId: input.videoId,
    captionWords: input.words,
    durationSec: input.durationSec,
    visualMood: input.visualMood,
    contentType: input.contentType,
    fallbackFamily: input.fallbackFamily,
    cutTimesSec: [...input.cutTimesSec, ...input.zoomTimesSec],
    hookAtSec: hookAtFrom(input.hookStartSec, input.hookDurationSec),
    ctaAtSec: input.ctaAtSec ?? null,
  });
  const intensity = buildIntensityCurve({
    durationSec: input.durationSec,
    words: input.words,
    cutTimesSec: input.cutTimesSec,
    zoomTimesSec: input.zoomTimesSec,
    plateTimesSec: input.plateTimesSec,
    popTimesSec: input.popTimesSec,
  });
  const placement = placeMusic({bed: input.bed, durationSec: input.durationSec, hookAtSec: brief.hookAtSec, intensity, bpm: brief.bpm});
  return {brief, placement, intensity};
}
