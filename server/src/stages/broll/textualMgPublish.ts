/**
 * WP43 Skill C: publish the planned textual MG plates as real `TextualMgPlate` library graphics (overlay placement, transparent ground: type over the video). Same path as `publishImageRuns`: the brief
 * resolves through the library registry (no Claude call), the generated Tiny TSX is validated + compiled + uploaded by the worker's `publishGraphicSource`, and the result is a `GeneratedGraphic`.
 * The publisher is injectable so tests run without R2; a plate that fails is returned in `failed`, never thrown (the captions then stay on for that window: only PUBLISHED plates mute them).
 */
import {publishGraphicSource, toGeneratedGraphic, type MotionWorkerOptions} from '../../motionWorker/worker.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {TextualMgPlatePlan} from './textualMgPlanner.ts';

export type TextualMgPublisher = typeof publishGraphicSource;
export type PublishedTextualMg = {plate: TextualMgPlatePlan; graphic: GeneratedGraphic};

/** Graphic id prefix: lets later stages (SFX, scoring) tell a Skill C plate from any other graphic. */
export const TEXTUAL_MG_GRAPHIC_ID_PREFIX = 'textual_mg_';

/** The library brief for one plate (exported for tests). */
export function textualMgBrief(plate: TextualMgPlatePlan, index: number, idPrefix = TEXTUAL_MG_GRAPHIC_ID_PREFIX) {
  return {
    id: `${idPrefix}${index + 1}`,
    goal: 'Emphasise the spoken line as designed type over the picture',
    visualDescription: `Jitter-class text plate (${plate.family}, ${plate.recipeId}): transparent ground, type over the footage, clean exit`,
    placement: 'overlay' as const,
    durationSeconds: Math.max(0.5, Math.min(60, plate.end - plate.start)),
    content: {
      textualMg: plate.text,
      textualMgFamily: plate.family,
      recipeId: plate.recipeId,
      ...(plate.counter ? {counter: plate.counter} : {}),
    },
  };
}

export async function publishTextualMgPlates(
  plates: readonly TextualMgPlatePlan[],
  options: Pick<MotionWorkerOptions, 'upload' | 'runtimeCheck' | 'captionBottomFrac' | 'artifactsDir'> & {publisher?: TextualMgPublisher; idPrefix?: string} = {},
): Promise<{published: PublishedTextualMg[]; failed: TextualMgPlatePlan[]}> {
  const published: PublishedTextualMg[] = [];
  const failed: TextualMgPlatePlan[] = [];
  const publisher = options.publisher ?? publishGraphicSource;
  for (const [index, plate] of plates.entries()) {
    const brief = textualMgBrief(plate, index, options.idPrefix);
    const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: brief.content});
    if (!hit || hit.compositionId !== 'TextualMgPlate') {
      failed.push(plate);
      continue;
    }
    try {
      const result = await publisher(brief, libraryGraphicSource(hit), {upload: options.upload, runtimeCheck: options.runtimeCheck, captionBottomFrac: options.captionBottomFrac, artifactsDir: options.artifactsDir});
      published.push({plate, graphic: toGeneratedGraphic(result, {start: plate.start, end: plate.end})});
    } catch {
      failed.push(plate);
    }
  }
  return {published, failed};
}
