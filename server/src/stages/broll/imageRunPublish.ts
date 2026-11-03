/**
 * WP18B: publish the image runs the labeled-asset planner produced as real `ImageRun` graphics (library module, validated and uploaded by the same worker path as every other library graphic). The upload
 * URLs travel as the graphic's runtime `assets` (a module may not hold a URL literal). The publisher is injectable so tests run without R2; a failure for one run is returned, never thrown, so analyze keeps
 * the slideshow overlay for that cluster.
 */
import {publishGraphicSource, toGeneratedGraphic, type MotionWorkerOptions} from '../../motionWorker/worker.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {imageRunOverlayIntent, type ImageRunPlan} from './labeledAssetPlacement.ts';

export type ImageRunPublisher = typeof publishGraphicSource;
export type PublishedImageRun = {run: ImageRunPlan; graphic: GeneratedGraphic; overlayIntent: string};

export async function publishImageRuns(
  runs: readonly ImageRunPlan[],
  options: Pick<MotionWorkerOptions, 'upload' | 'runtimeCheck' | 'captionBottomFrac' | 'artifactsDir'> & {publisher?: ImageRunPublisher; idPrefix?: string} = {},
): Promise<{published: PublishedImageRun[]; failed: ImageRunPlan[]}> {
  const published: PublishedImageRun[] = [];
  const failed: ImageRunPlan[] = [];
  const publisher = options.publisher ?? publishGraphicSource;
  for (const [index, run] of runs.entries()) {
    const brief = {
      id: `${options.idPrefix ?? 'image_run'}_${index + 1}`,
      goal: 'Show the creator\'s own uploaded images as a quick collage',
      visualDescription: `${run.mode === 'logo_cloud' ? 'A hero logo with the other logos small and blurred behind' : 'The uploaded images one after another with hard cuts'}`,
      placement: 'full_screen' as const,
      durationSeconds: Math.max(0.5, Math.min(60, run.end - run.start)),
      content: {imageRun: run.items, mode: run.mode, ...(run.fit ? {fit: run.fit} : {}), ...(run.backdrop ? {backdrop: run.backdrop} : {}), ...(run.framed ? {framed: true} : {}), ...(run.holdsSec ? {holdsSec: run.holdsSec} : {}), ...(run.framedItems ? {framedItems: run.framedItems} : {}), ...(run.motionSpeed ? {motionSpeed: run.motionSpeed} : {})},
      assets: run.items.map((item, itemIndex) => ({id: `run_${itemIndex}`, type: 'image' as const, url: item.src, ...(item.label ? {description: item.label.slice(0, 300)} : {})})),
    };
    const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: brief.content});
    if (!hit || hit.compositionId !== 'ImageRun') {
      failed.push(run);
      continue;
    }
    try {
      const result = await publisher(brief, libraryGraphicSource(hit), {upload: options.upload, runtimeCheck: options.runtimeCheck, captionBottomFrac: options.captionBottomFrac, artifactsDir: options.artifactsDir});
      published.push({run, graphic: toGeneratedGraphic(result, {start: run.start, end: run.end}), overlayIntent: imageRunOverlayIntent(run)});
    } catch {
      failed.push(run);
    }
  }
  return {published, failed};
}
