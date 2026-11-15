/**
 * Pull every remote overlay onto disk before Remotion starts.
 *
 * OffthreadVideo lazy-fetches src when a Sequence begins. A Pexels CDN miss
 * around the 60% mark used to abort the whole burn with Remotion's
 * "Failed to fetch / disk space is low" wrapper. Serving files from
 * remotion/public/prefetch keeps Chrome on localhost instead of the internet.
 */

import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {EngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import {withoutBehindEvents} from '../kinetic/matteMap.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
} from '../../lib/tempFiles.ts';
import {normalizeVideoForRemotion} from '../../media/ffmpeg.ts';
import type {TimelineBlueprint, VisualOverlay} from '../../types/blueprint.ts';

const log = stageLogger('prefetch-assets');

/** Match analyze ingest (`MAX_SOURCE_BYTES` in analyzeVideo.ts): a talking-head file can exceed the old 80 MB prefetch cap. */
const MAX_BYTES = 400 * 1024 * 1024;
/** Large source pulls (80–400 MB) routinely exceed 90 s on consumer uplinks; abort was surfacing as a generic download failure. */
const DOWNLOAD_TIMEOUT_MS = 300_000;

const MEDIA_EXTS = new Set([
  '.js',
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
]);

const TEXT_LAYOUTS = new Set<VisualOverlay['layout']>([
  'lockup',
  'stat',
  'banner',
  'chip',
  'bubble',
]);

/** WP54: the video a backend graphic (riso cache mp4) asks Remotion to play full-screen, or ''. Only .mp4 / .mov / .webm / .m4v on graphics that name a backend. */
export function backendVideoUrlOf(graphic: {props?: Record<string, unknown>}): string {
  const props = graphic.props ?? {};
  const url = typeof props.assetUrl === 'string' ? props.assetUrl.trim() : '';
  if (!url || (props.backend !== 'riso' && props.backend !== 'anidoodle' && props.backend !== 'collage_gbro')) return '';
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url) ? url : '';
}

export function collectBlueprintMediaUrls(blueprint: TimelineBlueprint): string[] {
  const urls = new Set<string>();
  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  };
  if (!blueprint.videoUrl.trim().startsWith('staticFile:')) {
    add(blueprint.videoUrl);
  }
  add(blueprint.speakerCutout?.videoUrl);
  add(blueprint.subjectForeground?.videoUrl); // WP55 phase 2: the range-limited person foreground travels like the keyed cutout
  // Phase 5.24: the Subject Stage person cutout and the stage's own cutaways (a cutout that cannot be fetched degrades the stage instead of failing the render: rewriteBlueprintMediaUrls)
  if (blueprint.subjectStage?.matteUrl && !blueprint.subjectStage.matteUrl.trim().startsWith('staticFile:')) add(blueprint.subjectStage.matteUrl);
  for (const cutaway of blueprint.subjectStage?.cutaways ?? []) if (!cutaway.assetUrl.trim().startsWith('staticFile:')) add(cutaway.assetUrl);
  for (const clip of blueprint.brollClips ?? []) {
    add(clip.assetUrl);
  }
  for (const clip of blueprint.depthOverlays ?? []) {
    add(clip.assetUrl);
  }
  for (const clip of blueprint.insetReveals ?? []) {
    if (clip.params.background.type === 'loop' && /^(https?:|file:|\/)/i.test(clip.params.background.value)) {
      add(clip.params.background.value);
    }
  }
  for (const overlay of blueprint.visualOverlays ?? []) {
    add(overlay.assetUrl);
  }
  for (const clip of blueprint.transitions ?? []) {
    add(clip.assetUrl);
  }
  for (const graphic of blueprint.generatedGraphics ?? []) {
    add(graphic.module.url);
    add(backendVideoUrlOf(graphic)); // WP54: a riso / backend graphic's cached mp4 is prefetched like any overlay clip
  }
  return [...urls];
}

export function rewriteBlueprintMediaUrls(
  blueprint: TimelineBlueprint,
  urlMap: Map<string, string>,
): TimelineBlueprint {
  const swap = (value?: string): string => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      return '';
    }
    if (!urlMap.has(trimmed)) {
      return trimmed;
    }
    return urlMap.get(trimmed) ?? '';
  };

  const visualOverlays = (blueprint.visualOverlays ?? [])
    .map(overlay => ({...overlay, assetUrl: swap(overlay.assetUrl)}))
    .filter(overlay => overlayKeepsAfterPrefetch(overlay));

  // WP55 phase 2: a hero whose person foreground did not survive prefetch must NOT render (type drawn over the presenter's face is the one result this feature exists to prevent): drop the foreground
  // AND every host-composited graphic together.
  const foregroundUrl = blueprint.subjectForeground ? swap(blueprint.subjectForeground.videoUrl) : '';
  const foregroundLost = Boolean(blueprint.subjectForeground) && !foregroundUrl;
  const hostComposited = (graphic: {props?: unknown}) => (graphic.props as {content?: {hostComposited?: unknown}} | undefined)?.content?.hostComposited === true;
  const stage = subjectStageAfterPrefetch(blueprint.subjectStage, swap);

  return {
    ...blueprint,
    videoUrl: swap(blueprint.videoUrl),
    ...(blueprint.subjectForeground && !foregroundLost ? {subjectForeground: {...blueprint.subjectForeground, videoUrl: foregroundUrl}} : {}),
    ...(foregroundLost ? {subjectForeground: undefined} : {}),
    // Phase 5: a Kinetic V2 spec whose foreground was lost loses its behind events too (never type over the face); no foreground lost = unchanged
    ...(foregroundLost && blueprint.kinetic ? {kinetic: withoutBehindEvents(blueprint.kinetic).spec} : {}),
    ...(stage ? {subjectStage: stage.subjectStage} : {}),
    speakerCutout: blueprint.speakerCutout
      ? {
          ...blueprint.speakerCutout,
          videoUrl: blueprint.speakerCutout.videoUrl
            ? swap(blueprint.speakerCutout.videoUrl)
            : blueprint.speakerCutout.videoUrl,
        }
      : blueprint.speakerCutout,
    brollClips: (blueprint.brollClips ?? [])
      .map(clip => ({...clip, assetUrl: swap(clip.assetUrl)}))
      .filter(clip => Boolean(clip.assetUrl)),
    depthOverlays: (blueprint.depthOverlays ?? [])
      .map(clip => ({...clip, assetUrl: swap(clip.assetUrl)}))
      .filter(clip => Boolean(clip.assetUrl)),
    insetReveals: (blueprint.insetReveals ?? []).map(clip =>
      clip.params.background.type === 'loop'
        ? {
            ...clip,
            params: {
              ...clip.params,
              background: {
                ...clip.params.background,
                value: swap(clip.params.background.value) || clip.params.background.value,
              },
            },
          }
        : clip,
    ),
    visualOverlays,
    // A generated sweep (GENERATED_TRANSITIONS_ENABLED) has no asset to fetch and must survive; asset-less transitions
    // without `renderGenerated` are not drawn by TransitionTrack and are dropped here as before.
    transitions: (blueprint.transitions ?? [])
      .map(clip => ({...clip, assetUrl: swap(clip.assetUrl)}))
      .filter(clip => Boolean(clip.assetUrl) || clip.renderGenerated === true),
    // Same-origin module copies: no CORS, and a failed download drops the graphic like failed B-roll.
    generatedGraphics: (blueprint.generatedGraphics ?? [])
      .map(graphic => {
        const video = backendVideoUrlOf(graphic);
        // a backend mp4 that failed to prefetch is blanked, so the graphic keeps its native picture
        const props = video ? {...graphic.props, assetUrl: swap(video)} : graphic.props;
        return {...graphic, props, module: {...graphic.module, url: swap(graphic.module.url)}};
      })
      .filter(graphic => Boolean(graphic.module.url))
      .filter(graphic => !(foregroundLost && hostComposited(graphic))),
    stats: {
      ...blueprint.stats,
      ...(stage && stage.warnings.length > 0 ? {warnings: [...(blueprint.stats?.warnings ?? []), ...stage.warnings]} : {}),
      brollClipCount: (blueprint.brollClips ?? []).filter(clip =>
        Boolean(swap(clip.assetUrl)),
      ).length,
      depthOverlayCount: (blueprint.depthOverlays ?? []).filter(clip =>
        Boolean(swap(clip.assetUrl)),
      ).length,
      visualOverlayCount: visualOverlays.length,
      splitCount: visualOverlays.filter(overlay => overlay.layout === 'split').length,
      transitionCount: (blueprint.transitions ?? []).filter(clip =>
        Boolean(swap(clip.assetUrl)) || clip.renderGenerated === true,
      ).length,
    },
  };
}

export async function prefetchBlueprintMedia(
  blueprint: TimelineBlueprint,
  cacheDir: string,
  publicPrefix: string,
): Promise<TimelineBlueprint> {
  await fs.mkdir(cacheDir, {recursive: true});
  const urlMap = new Map<string, string>();
  const urls = collectBlueprintMediaUrls(blueprint);
  log.info({count: urls.length}, 'prefetching media for remotion');

  for (const url of urls) {
    if (url.startsWith('staticFile:')) {
      continue;
    }
    const name = hashedFileName(url);
    const dest = path.join(cacheDir, name);
    try {
      if (isLocalMediaPath(url)) {
        await copyLocalFile(url, dest, {maxBytes: MAX_BYTES});
      } else {
        await downloadToFile(url, dest, {
          maxBytes: MAX_BYTES,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        });
      }
      const publicName = await maybeNormalizePrefetch(
        dest,
        name,
        url === blueprint.videoUrl,
        url === blueprint.speakerCutout?.videoUrl ||
        url === blueprint.subjectForeground?.videoUrl,
      );
      urlMap.set(url, `${publicPrefix}/${publicName}`);
      log.info({name: publicName, bytesHint: url.slice(0, 96)}, 'prefetched');
    } catch (error) {
      urlMap.set(url, '');
      log.warn(
        {url: url.slice(0, 140), error: (error as Error).message},
        'prefetch failed, dropping asset',
      );
    }
  }

  const rewritten = rewriteBlueprintMediaUrls(blueprint, urlMap);
  if (!rewritten.videoUrl) {
    throw new EngineError(
      'render_failed',
      'Could not prefetch the talking-head video for Remotion',
    );
  }
  return rewritten;
}

function overlayKeepsAfterPrefetch(overlay: VisualOverlay): boolean {
  if (overlay.assetUrl) {
    return true;
  }
  if (overlay.mediaKind === 'text' || TEXT_LAYOUTS.has(overlay.layout)) {
    return true;
  }
  return false;
}

async function maybeNormalizePrefetch(
  dest: string,
  name: string,
  keepAudio: boolean,
  preserveAlpha = false,
): Promise<string> {
  if (!isVideoName(name) || preserveAlpha) {
    return name;
  }
  const tmp = `${dest}.src`;
  const outName = `${path.basename(name, path.extname(name))}.mp4`;
  const outPath = path.join(path.dirname(dest), outName);
  await fs.rename(dest, tmp);
  try {
    await normalizeVideoForRemotion({
      inputPath: tmp,
      outputPath: outPath,
      keepAudio,
    });
    await fs.unlink(tmp).catch(() => undefined);
    if (outPath !== dest) {
      await fs.unlink(dest).catch(() => undefined);
    }
    return outName;
  } catch (error) {
    await fs.unlink(outPath).catch(() => undefined);
    await fs.rename(tmp, dest).catch(() => undefined);
    log.warn(
      {name, error: (error as Error).message},
      'remotion normalize skipped; using original file',
    );
    return name;
  }
}

function isVideoName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === '.mp4' || ext === '.mov' || ext === '.webm' || ext === '.m4v';
}

function hashedFileName(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${hash}${extensionFor(url)}`;
}

function extensionFor(url: string): string {
  let pathname = url.split('?')[0] ?? url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Local paths and malformed URLs fall through to path.extname.
  }
  const ext = path.extname(pathname).toLowerCase();
  if (ext === '.jpeg') {
    return '.jpg';
  }
  if (MEDIA_EXTS.has(ext)) {
    return ext;
  }
  return '.bin';
}

/**
 * Phase 5.24: the Subject Stage after prefetch. A person cutout that could not be fetched does NOT fail the render: the stage is marked `matteMissing` (its matte URL blanked, so no video
 * element is ever mounted for it) and the renderer degrades to the original footage + matte-independent elements, with the diagnostic `subject_stage:render_degraded:matte_missing`.
 * Cutaways that could not be fetched are dropped (`subject_stage:render_degraded:cutaway_missing:<n>`). Undefined for a blueprint without a stage (unchanged).
 */
export function subjectStageAfterPrefetch(
  stage: TimelineBlueprint['subjectStage'],
  swap: (value?: string) => string,
): {subjectStage: NonNullable<TimelineBlueprint['subjectStage']>; warnings: string[]} | undefined {
  if (!stage) return undefined;
  const warnings: string[] = [];
  const wasSet = Boolean(stage.matteUrl?.trim());
  const matteUrl = wasSet ? swap(stage.matteUrl) : '';
  const matteMissing = wasSet && !matteUrl;
  if (matteMissing) {
    warnings.push('subject_stage:render_degraded:matte_missing');
    // Phase 5.25: name every treatment the degraded render suppresses (it needs the cutout) or keeps (it renders without it), so nothing claims a composition that did not render
    warnings.push(...degradedTreatmentDiagnostics(stage));
    log.warn({matte: stage.matteUrl.slice(0, 140)}, 'subject stage cutout missing: rendering the original footage with matte-independent elements only');
  }
  const cutaways = (stage.cutaways ?? []).map(c => ({...c, assetUrl: swap(c.assetUrl)})).filter(c => Boolean(c.assetUrl));
  const lost = (stage.cutaways ?? []).length - cutaways.length;
  if (lost > 0) warnings.push(`subject_stage:render_degraded:cutaway_missing:${lost}`);
  return {
    subjectStage: {...stage, matteUrl, ...(matteMissing ? {matteMissing: true} : {}), ...(stage.cutaways ? {cutaways} : {})},
    warnings,
  };
}

/**
 * Phase 5.25: one diagnostic per span of a degraded (cutout-missing) stage:
 *   subject_stage:render_degraded:suppressed:<i>:<stage>:<treatment>:<why>   the treatment needs the person cutout (behind the person, room replacement / grade, the person layer)
 *   subject_stage:render_degraded:kept:<i>:<stage>:<treatment>:matte_independent   it renders without the cutout (a front card / tab in free space, an opaque S5 takeover)
 * Restrained spans draw nothing either way and are not listed. Cutaways are full-frame footage replacements and are kept (`kept:cutaways:<n>`).
 */
export function degradedTreatmentDiagnostics(stage: NonNullable<TimelineBlueprint['subjectStage']>): string[] {
  const out: string[] = [];
  stage.spans.forEach((span, i) => {
    const d = span.design;
    if (d?.kind === 'restrained') return;
    const treatment = d ? (d.kind === 'set' ? `set_${d.mode}` : `source_card_${d.layer}`) : `legacy_${span.stage.toLowerCase()}`;
    const why = d ? (d.kind === 'set' && d.mode === 'set' ? 'room_replaced_and_headline_behind_person' : d.kind === 'source_card' && d.layer === 'behind' ? 'card_tucked_behind_person' : 'needs_person_cutout') : span.stage === 'S5' ? '' : 'legacy_behind_layer_needs_person_cutout';
    const kept = d ? !d.dependsOnMatte : span.stage === 'S5';
    out.push(kept ? `subject_stage:render_degraded:kept:${i}:${span.stage}:${treatment}:matte_independent` : `subject_stage:render_degraded:suppressed:${i}:${span.stage}:${treatment}:${why}`);
    if (kept && d?.kind === 'set') out.push(`subject_stage:render_degraded:suppressed:${i}:${span.stage}:room_grade:needs_person_cutout`);
  });
  if ((stage.cutaways ?? []).length > 0) out.push(`subject_stage:render_degraded:kept:cutaways:${stage.cutaways!.length}`);
  return out;
}
