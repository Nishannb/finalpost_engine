/**
 * WP45 Layer 2: publish the planned motion-template beats as real library graphics (GridMosaicMorph / SlitPanelCarousel / BentoCardWall / StackedCardDeck, full-screen, opaque). Same path as `publishTextualMgPlates`
 * and `publishImageRuns`: the brief resolves through the library registry (no Claude call), the Tiny TSX is validated + compiled + uploaded by the worker's `publishGraphicSource`, and the result is a
 * `GeneratedGraphic`. The publisher is injectable so tests run without R2; a beat that fails is returned in `failed`, never thrown (the captions then stay on for that window: only PUBLISHED beats mute them).
 *
 * WP48: when `words` are provided, each beat is grounded via `bindMotionTemplateContent` before publish. Ungrounded beats (no spoken copy / required stills) go to `failed` — live polish never ships ACME / Bacon Club / PARIS shell defaults.
 * Offline proof renders omit `words` and keep the comps' own demo shells.
 */
import {publishGraphicSource, toGeneratedGraphic, type MotionWorkerOptions} from '../../motionWorker/worker.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {bindMotionTemplateContent, type MotionTemplateBindWord, type SubjectMatteInput} from './motionTemplateBind.ts';
import {motionTemplateBrief, type MotionTemplateBeat} from './motionTemplateCatalog.ts';

export type MotionTemplatePublisher = typeof publishGraphicSource;
export type PublishedMotionTemplate = {beat: MotionTemplateBeat; graphic: GeneratedGraphic};

type BriefAsset = {id: string; type: 'image' | 'video'; url: string};
function briefAssetsFromBound(bound: Record<string, unknown>): BriefAsset[] {
  const assets: BriefAsset[] = [];
  const push = (id: string, url: unknown, type: 'image' | 'video' = 'image') => {
    if (typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim())) assets.push({id, type, url: url.trim()});
  };
  // WP55: the person matte (alpha video) and the creator's post stills travel as assets, never as literals in the TSX
  if (bound.occlusion === 'matte') push('subject', bound.subjectSrc, 'video');
  if (Array.isArray(bound.imageSrcs)) bound.imageSrcs.forEach((url, i) => push(`social${i}`, url));
  push('photo', bound.imageSrc);
  push('logo', bound.logoSrc);
  if (Array.isArray(bound.imageUrls)) bound.imageUrls.forEach((url, i) => push(`panel${i}`, url));
  if (Array.isArray(bound.cards)) {
    bound.cards.forEach((card, i) => {
      if (card && typeof card === 'object' && 'src' in card) push(`card${i}`, (card as {src?: unknown}).src);
    });
  }
  if (Array.isArray(bound.slides)) {
    bound.slides.forEach((slide, i) => {
      if (slide && typeof slide === 'object' && 'photoSrc' in slide) push(`slide${i}`, (slide as {photoSrc?: unknown}).photoSrc);
    });
  }
  return assets;
}

export async function publishMotionTemplateBeats(
  beats: readonly MotionTemplateBeat[],
  options: Pick<MotionWorkerOptions, 'upload' | 'runtimeCheck' | 'captionBottomFrac' | 'artifactsDir'> & {
    publisher?: MotionTemplatePublisher;
    idPrefix?: string;
    accent?: string;
    /** WP49: edit-palette ground / ink so comps do not keep proof-shell whites / earth tones. */
    ground?: string;
    ink?: string;
    /** Spoken words for this edit. When personalize is on, WP48 grounding is required and demo shells are refused. */
    words?: readonly MotionTemplateBindWord[];
    /** Optional https stills already resolved for this edit. */
    imageUrls?: readonly string[];
    /** WP54: logo / provided screenshots / asset-brief prices for the gated templates (see MotionTemplateBindInput). */
    logoSrc?: string;
    screenshotUrls?: readonly string[];
    assetBriefPrices?: readonly number[];
    /** WP55 KINETIC_TYPE_STORYTELLING inputs (see MotionTemplateBindInput). */
    brandName?: string;
    socialImageUrls?: readonly string[];
    subjectMatte?: SubjectMatteInput;
    /**
     * WP48: refuse ACME / Bacon Club demos. Defaults on when `words` are provided; the live stage always passes `true`.
     * Offline proof publishes omit words and leave this false so comps keep their shell defaults.
     */
    personalize?: boolean;
  } = {},
): Promise<{published: PublishedMotionTemplate[]; failed: MotionTemplateBeat[]}> {
  const published: PublishedMotionTemplate[] = [];
  const failed: MotionTemplateBeat[] = [];
  const publisher = options.publisher ?? publishGraphicSource;
  const personalize = options.personalize ?? Boolean(options.words && options.words.length > 0);
  for (const [index, beat] of beats.entries()) {
    let bound: Record<string, unknown> | undefined;
    let assets: BriefAsset[] | undefined;
    if (personalize) {
      const content = bindMotionTemplateContent({
        templateId: beat.templateId,
        words: options.words ?? [],
        beatStart: beat.start,
        beatEnd: beat.end,
        imageUrls: options.imageUrls,
        logoSrc: options.logoSrc,
        screenshotUrls: options.screenshotUrls,
        assetBriefPrices: options.assetBriefPrices,
        brandName: options.brandName,
        socialImageUrls: options.socialImageUrls,
        subjectMatte: options.subjectMatte,
        hint: beat.hint,
        accent: options.accent,
        ground: options.ground,
        ink: options.ink,
      });
      if (!content) {
        failed.push(beat);
        continue;
      }
      bound = content;
      const fromBound = briefAssetsFromBound(content);
      if (fromBound.length > 0) assets = fromBound;
    }
    const brief = motionTemplateBrief(beat, index, {
      accent: options.accent,
      ground: options.ground,
      ink: options.ink,
      idPrefix: options.idPrefix,
      content: bound,
      assets,
    });
    const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: brief.content});
    if (!hit || hit.compositionId !== beat.compositionId) {
      failed.push(beat);
      continue;
    }
    try {
      const result = await publisher(brief, libraryGraphicSource(hit), {upload: options.upload, runtimeCheck: options.runtimeCheck, captionBottomFrac: options.captionBottomFrac, artifactsDir: options.artifactsDir});
      published.push({beat, graphic: toGeneratedGraphic(result, {start: beat.start, end: beat.end})});
    } catch {
      failed.push(beat);
    }
  }
  return {published, failed};
}
