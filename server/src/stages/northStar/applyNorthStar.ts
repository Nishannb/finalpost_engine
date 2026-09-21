/**
 * North-star compositor pass: thesis tokens, plate-aware contrast, SFX hits.
 * Never runs unless the caller opted in with --north-star / NORTH_STAR.
 */

import {sampleFramePalette, type FramePalette} from '../../media/ffmpeg.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  AudioDesign,
  CaptionDirection,
  CaptionWord,
  MotionGraphic,
  NorthStarDesign,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
  WordToken,
} from '../../types/blueprint.ts';
import type {
  EditThesis,
  PerceptionPack,
  StoryAnalysis,
} from '../directorV2/types.ts';
import type {Occupancy} from '../layout/occupancy.ts';
import {enforceCompositionLaws} from './compositionLaws.ts';
import {buildNorthStarDesign, promoteMotionDesign} from './designSystem.ts';
import {applyPlateContrast} from './plateContrast.ts';
import {critiqueNorthStarProxy} from './proxyCritic.ts';
import {applyThesisTokens, tokensFromThesis} from './thesisTokens.ts';
import {resolveSoundHits} from './soundHits.ts';

const log = stageLogger('north-star');

export type NorthStarPlan = {
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  audioDesign?: AudioDesign;
  hookTitle: string;
  hookAnchor: VisualAnchor;
  design: NorthStarDesign;
  estimatedCostUsd: number;
  warnings: string[];
};

export async function applyNorthStarPass(input: {
  thesis?: string;
  thesisParts?: EditThesis;
  pack?: PerceptionPack;
  story?: StoryAnalysis;
  fallbackOccupancy: Occupancy;
  hookTitle: string;
  hookDurationSec: number;
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  speakerPalette?: FramePalette;
  audio?: AudioDesign;
  words?: Array<CaptionWord | WordToken>;
  workspace?: {file: (name: string) => string};
}): Promise<NorthStarPlan> {
  const warnings: string[] = ['north_star'];
  const tokens = tokensFromThesis(input.thesis ?? '', input.thesisParts);
  const design = buildNorthStarDesign({
    story: input.story,
    thesis: input.thesisParts,
    tokens,
  });
  const painted = applyThesisTokens({
    tokens,
    caption: input.caption,
    overlays: input.overlays,
    motionGraphics: input.motionGraphics,
    semanticEmphasis: input.semanticEmphasis,
  });
  const promoted = promoteMotionDesign({
    pack: input.pack,
    story: input.story,
    design,
    existing: painted.motionGraphics,
    emphasis: painted.semanticEmphasis,
  });

  const plateByUrl = await sampleOverlayPlates(
    painted.overlays,
    input.workspace,
  );
  if (plateByUrl.size > 0) {
    warnings.push(`north_star_plates:${plateByUrl.size}`);
  }

  const contrasted = applyPlateContrast({
    caption: painted.caption,
    overlays: painted.overlays,
    motionGraphics: promoted.motionGraphics,
    semanticEmphasis: promoted.semanticEmphasis,
    speakerPalette: input.speakerPalette,
    plateByUrl,
  });

  const laws = enforceCompositionLaws({
    hookTitle: input.hookTitle,
    hookAnchor:
      input.pack?.occupancySlices[0]?.occupancy.overlayAnchor ??
      input.fallbackOccupancy.overlayAnchor,
    hookDurationSec: input.hookDurationSec,
    occupancySlices: input.pack?.occupancySlices ?? [],
    fallbackOccupancy: input.fallbackOccupancy,
    overlays: contrasted.overlays,
    motionGraphics: contrasted.motionGraphics,
    semanticEmphasis: contrasted.semanticEmphasis,
  });
  warnings.push(
    ...laws.suggestions.map(value => `north_star_law_suggestion:${value}`),
  );

  const critique = await critiqueNorthStarProxy({
    pack: input.pack,
    overlays: laws.overlays,
    motionGraphics: laws.motionGraphics,
    semanticEmphasis: laws.semanticEmphasis,
  });
  if (critique.notes) {
    warnings.push(`north_star_critic:${critique.notes.slice(0, 160)}`);
  }
  const finalLaws = enforceCompositionLaws({
    hookTitle: laws.hookTitle,
    hookAnchor: laws.hookAnchor,
    hookDurationSec: input.hookDurationSec,
    occupancySlices: input.pack?.occupancySlices ?? [],
    fallbackOccupancy: input.fallbackOccupancy,
    overlays: laws.overlays,
    motionGraphics: laws.motionGraphics,
    semanticEmphasis: laws.semanticEmphasis,
  });
  warnings.push(
    ...finalLaws.suggestions.map(value => `north_star_law_suggestion:${value}`),
  );

  const hits = resolveSoundHits({
    audio: input.audio,
    words: input.words,
    overlays: finalLaws.overlays,
    motionGraphics: finalLaws.motionGraphics,
    semanticEmphasis: finalLaws.semanticEmphasis,
  });
  const audioDesign: AudioDesign = {
    musicMood: input.audio?.musicMood,
    ducking: input.audio?.ducking ?? true,
    sfx: input.audio?.sfx ?? [],
    hits,
  };

  log.info(
    {
      plates: plateByUrl.size,
      hits: hits.length,
      primary: tokens.primary,
      lawDrops: laws.drops.length,
      critic: critique.notes,
    },
    'north-star pass',
  );

  return {
    caption: contrasted.caption,
    overlays: finalLaws.overlays,
    motionGraphics: finalLaws.motionGraphics,
    semanticEmphasis: finalLaws.semanticEmphasis,
    audioDesign,
    hookTitle: finalLaws.hookTitle,
    hookAnchor: finalLaws.hookAnchor,
    design,
    estimatedCostUsd: critique.estimatedCostUsd,
    warnings,
  };
}

async function sampleOverlayPlates(
  overlays: VisualOverlay[],
  workspace?: {file: (name: string) => string},
): Promise<Map<string, FramePalette>> {
  const out = new Map<string, FramePalette>();
  if (!workspace) {
    return out;
  }
  const urls = [
    ...new Set(
      overlays
        .filter(overlay => overlay.assetUrl && overlay.layout !== 'lockup')
        .map(overlay => overlay.assetUrl),
    ),
  ].slice(0, 6);
  await Promise.all(
    urls.map(async (url, index) => {
      try {
        const palette = await sampleFramePalette(
          url,
          workspace.file(`north-star-plate-${index}.rgb`),
          4,
        );
        out.set(url, palette);
      } catch (error) {
        log.warn({url, error}, 'plate sample skipped');
      }
    }),
  );
  return out;
}
