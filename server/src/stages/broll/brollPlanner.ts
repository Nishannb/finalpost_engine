/**
 * Stage C — director + stock lookup into output-time clips and overlays.
 *
 * Fails soft: a Gemini outage or empty stock set degrades to keyword fallback
 * plus text graphics, never to a failed analysis. The talking-head burn still
 * ships with a hook title even when stock footage is missing.
 * Video assets come from Pexels and/or Pixabay (whichever keys are configured).
 */

import {env} from '../../config/env.ts';
import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import {reauditFinalTimeline} from '../../lib/assembler/index.ts';
import {isEngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  type BRollClip,
  type CaptionDirection,
  type DepthOverlayClip,
  type FrameInset,
  type HookStyle,
  type InsetRevealClip,
  type MediaContainerMoment,
  type MotionGraphic,
  type OverlaySlide,
  type OverlayTextStyle,
  type SemanticEmphasis,
  type TransitionClip,
  type VisualOverlay,
  type WordToken,
} from '../../types/blueprint.ts';
import type {FramePalette} from '../../media/ffmpeg.ts';
import {clamp, round, type Timeline} from '../filters/timeline.ts';
import type {Occupancy} from '../layout/occupancy.ts';
import type {SpeakerCutout} from '../layout/speakerCutout.ts';
import type {CaptionStyleGuide} from '../../types/captionStyleGuide.ts';
import {
  defaultCaptionDirection,
  directorConfigured,
  fallbackVisualDirection,
  planVisualDirection,
  type DirectedMoment,
  type DirectedZoom,
  type VisualDirection,
} from './geminiDirector.ts';
import {runDirectorV2} from '../directorV2/runDirectorV2.ts';
import type {DirectorRunReport} from '../../types/blueprint.ts';
import type {StockAsset} from './stockTypes.ts';
import {stockAssetKeyOf, stockConfigured, findBRollAsset, findPhotoAsset, listBRollAssets} from './stockSearch.ts';
import {applyEditorialGate} from './editorialGate.ts';
import {resolveDepthOverlays} from './depthOverlayPlanner.ts';
import {resolveInsetReveals} from './insetRevealPlanner.ts';
import {
  filterVisualDirection,
  isLayoutAllowed,
  lockCaptionTemplate,
  visualToolkitsRequested,
} from '../../lib/editToolkits.ts';
import {ensureRequestedEditStyles} from './ensureRequestedEdits.ts';
import {applyNorthStarPass} from '../northStar/applyNorthStar.ts';
import {pickRankedAsset} from '../northStar/assetRerank.ts';
import {chooseSemanticallyRelevantAsset} from '../northStar/semanticAssetGate.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {alignTimestampToSpeech, firstPhraseWindow, speechHoldWindow, speechPhraseWindow} from './speechAlign.ts';
import {ensureHugeNumberCounters} from './fastCounter.ts';
import {
  SPLIT_MIN_STILL_SEC,
  splitStillSec,
  splitTotalSec,
} from '../../lib/motionTiming.ts';
import {
  matchRegionToSpeech,
  scoreUserBrollMatch,
  type UserBrollAsset,
} from './userBrollDescribe.ts';
import {
  applySubjectToQuery,
  inferStockSubject,
  keyPhrasesFromTranscript,
  stockFriendlyQueries,
  themeQueriesFromTranscript,
} from './visualQuery.ts';

const log = stageLogger('stage-c-broll');

const MIN_GAP_SEC = 1.5;
const HOOK_GUARD_SEC = 3.5;

const TRANSITION_QUERIES = [
  'light leak overlay',
  'film burn',
  'ink splash',
  'smoke overlay',
  'fire overlay',
  'paper wipe',
  'glitch overlay',
];

export type VisualPlan = {
  hookTitle: string;
  hookSubtitle: string;
  hookStyle: HookStyle;
  hookDurationSec: number;
  hookStartSec?: number;
  caption: CaptionDirection;
  suggestedLutIds: string[];
  preferredLutId: string;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  depthOverlays: DepthOverlayClip[];
  insetReveals: InsetRevealClip[];
  transitions: TransitionClip[];
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  frameInsets: FrameInset[];
  semanticEmphasis: SemanticEmphasis[];
  zooms: DirectedZoom[];
  warnings: string[];
  estimatedCostUsd: number;
  editThesis?: string;
  editThesisParts?: import('../directorV2/types.ts').EditThesis;
  directorReport?: DirectorRunReport;
  cta?: import('../../types/blueprint.ts').BlueprintCta;
  audioDesign?: import('../../types/blueprint.ts').AudioDesign;
  northStarDesign?: import('../../types/blueprint.ts').NorthStarDesign;
  northStarHookAnchor?: import('../../types/blueprint.ts').VisualAnchor;
  assembler?: import('../../lib/assembler/types.ts').AssemblerReport;
};

/** Captions-only mobile path: no director, B-roll, hook, or zooms. */
export function captionsOnlyVisualPlan(caption: CaptionDirection): VisualPlan {
  return {
    hookTitle: '',
    hookSubtitle: '',
    hookStyle: 'minimal',
    hookDurationSec: 0,
    hookStartSec: 0,
    caption,
    suggestedLutIds: [],
    preferredLutId: '',
    clips: [],
    overlays: [],
    depthOverlays: [],
    insetReveals: [],
    transitions: [],
    motionGraphics: [],
    mediaContainers: [],
    frameInsets: [],
    semanticEmphasis: [],
    zooms: [],
    warnings: ['pipeline:captions_only'],
    estimatedCostUsd: 0,
  };
}

export async function planBRoll(input: {
  transcript: string;
  sourceDurationSec: number;
  timeline: Timeline;
  palette?: FramePalette;
  words?: WordToken[];
  captionWords?: import('../../types/blueprint.ts').CaptionWord[];
  userBrollAssets?: UserBrollAsset[];
  occupancy?: Occupancy;
  speakerCutout?: SpeakerCutout;
  captionStyleGuide?: CaptionStyleGuide | null;
  forceSpeakerCutout?: boolean;
  directorV2?: boolean;
  northStar?: boolean;
  sourcePath?: string;
  workspace?: {file: (name: string) => string};
  requestedEdits?: string[] | null;
  captionTemplate?: import('../../types/blueprint.ts').CaptionTemplateId | null;
  noRepair?: boolean;
}): Promise<VisualPlan> {
  const warnings: string[] = [];
  const userBrollAssets = input.userBrollAssets ?? [];
  const hookDurationSec = Math.min(
    Math.max(2.6, env.HOOK_DURATION_SEC),
    Math.max(2.6, input.timeline.outputDurationSec * 0.28),
  );

  if (!env.BROLL_ENABLED) {
    const fallback = fallbackVisualDirection({
      transcript: input.transcript,
      sourceDurationSec: input.sourceDurationSec,
      momentCount: 1,
    });
    return {
      hookTitle: fallback.hookTitle,
      hookSubtitle: '',
      hookStyle: fallback.hookStyle,
      hookDurationSec,
      caption: fallback.caption,
      suggestedLutIds: fallback.suggestedLutIds,
      preferredLutId: fallback.preferredLutId,
      clips: [],
      overlays: [],
      depthOverlays: [],
      insetReveals: [],
      transitions: [],
      motionGraphics: fallback.motionGraphics,
      mediaContainers: fallback.mediaContainers,
      frameInsets: fallback.frameInsets ?? [],
      semanticEmphasis: fallback.semanticEmphasis,
      zooms: [],
      warnings: ['broll_disabled'],
      estimatedCostUsd: 0,
    };
  }

  let estimatedCostUsd = 0;
  const northStar = Boolean(input.northStar);
  let direction: VisualDirection = fallbackVisualDirection({
    transcript: input.transcript,
    sourceDurationSec: input.sourceDurationSec,
    momentCount: env.BROLL_MOMENT_COUNT,
  });
  let editThesis = '';
  let editThesisParts: import('../directorV2/types.ts').EditThesis | undefined;
  let northStarPack: import('../directorV2/types.ts').PerceptionPack | undefined;
  let northStarStory: import('../directorV2/types.ts').StoryAnalysis | undefined;
  let directorReport: DirectorRunReport | undefined;
  let cta: import('../../types/blueprint.ts').BlueprintCta | undefined;
  let audioDesign: import('../../types/blueprint.ts').AudioDesign | undefined;
  let assembler: import('../../lib/assembler/types.ts').AssemblerReport | undefined;

  try {
    if ((input.directorV2 || northStar) && input.sourcePath && input.workspace) {
      const v2 = await runDirectorV2({
        captionWords: input.captionWords ?? [],
        sourceWords: input.words ?? [],
        transcript: input.transcript,
        timeline: input.timeline,
        sourcePath: input.sourcePath,
        stillDir: input.workspace.file,
        occupancy: input.occupancy,
        userAssets: userBrollAssets.map(asset => ({
          id: asset.id,
          description: asset.description,
          durationSec: asset.durationSec,
          kind: asset.kind,
          width: asset.width,
          height: asset.height,
        })),
        captionStyleGuide: input.captionStyleGuide,
        forceSpeakerCutout: input.forceSpeakerCutout,
        speakerCutoutAvailable: Boolean(input.speakerCutout?.videoUrl),
        speakerCutoutNote: input.speakerCutout?.videoUrl
          ? 'available. Alpha video exists for the speaker mask.'
          : 'not available. Do not emit cutout or depth_overlay.',
        requestedEdits: input.requestedEdits ?? null,
        noRepair: input.noRepair,
      });
      direction = v2.direction;
      editThesis = v2.plan?.editThesis ?? '';
      editThesisParts = v2.plan?.editThesisParts;
      northStarPack = v2.pack;
      northStarStory = v2.story;
      directorReport = v2.report;
      cta = v2.plan?.cta;
      audioDesign = v2.plan?.sound;
      assembler = v2.report.assembler;
      estimatedCostUsd += direction.estimatedCostUsd;
      warnings.push(`director_v2:${v2.report.source}`);
      if (assembler) {
        warnings.push(
          ...assembler.refusals.map(
            item => `refusal:${item.code}:${item.elementId}:${item.message}`,
          ),
          ...assembler.log.map(item => `${item.code}:${item.detail}`),
          ...assembler.sanity,
        );
      }
    } else {
      direction = await planVisualDirection({
        transcript: input.transcript,
        sourceDurationSec: input.sourceDurationSec,
        momentCount: env.BROLL_MOMENT_COUNT,
        occupancy: input.occupancy,
        speakerCutout: input.speakerCutout,
        captionStyleGuide: input.captionStyleGuide,
        words: input.captionWords ?? input.words,
        requestedEdits: input.requestedEdits ?? null,
        captionTemplate: input.captionTemplate ?? null,
        userBrollAssets: userBrollAssets.map(asset => ({
          id: asset.id,
          description: asset.description,
          durationSec: asset.durationSec,
          kind: asset.kind,
          regions: asset.regions,
        })),
      });
      estimatedCostUsd += direction.estimatedCostUsd;
      if (direction.source === 'fallback') {
        warnings.push('director_fallback');
      }
    }
  } catch (error) {
    const code = isEngineError(error) ? error.code : 'broll_failed';
    log.warn({error}, 'visual director failed; using keyword fallback');
    warnings.push(`director_${code}`);
  }

  const allowedEdits = input.requestedEdits?.length
    ? new Set(input.requestedEdits)
    : null;
  if (!input.directorV2 && !northStar) {
    direction = filterVisualDirection(direction, allowedEdits);
  }
  const filled = ensureRequestedEditStyles({
    direction,
    allowed: allowedEdits,
    words: input.captionWords ?? input.words ?? [],
    durationSec: input.timeline.outputDurationSec,
    userBrollId: userBrollAssets[0]?.id ?? null,
  });
  direction = filled.direction;
  warnings.push(...filled.warnings);
  dumpDirectorTrace('02-after-allowlist-and-fills', {
    requestedEdits: input.requestedEdits ?? null,
    filledWarnings: filled.warnings,
    hookTitle: direction.hookTitle,
    hookStyle: direction.hookStyle,
    caption: direction.caption,
    zooms: direction.zooms,
    moments: direction.moments,
    depthOverlays: direction.depthOverlays,
    insetReveals: direction.insetReveals,
    motionGraphics: direction.motionGraphics,
    mediaContainers: direction.mediaContainers,
    semanticEmphasis: direction.semanticEmphasis,
  });
  if (input.captionTemplate) {
    const before = direction.caption.template;
    direction = {
      ...direction,
      caption: lockCaptionTemplate(direction.caption, input.captionTemplate),
    };
    if (before !== direction.caption.template) {
      warnings.push(
        `override:flag_over_director captions ${before ?? 'director'} -> ${input.captionTemplate}`,
      );
    }
  }

  const usedVideoKeys = new Set<string>();
  const usedPhotoKeys = new Set<string>();
  const usedUserIds = new Set<string>();
  const userBrollById = new Map(userBrollAssets.map(asset => [asset.id, asset]));
  const allowStock =
    northStar ||
    (userBrollAssets.length === 0 &&
      (allowedEdits == null ||
        allowedEdits.has('cutaway') ||
        allowedEdits.has('depth_overlay')));
  const clips: BRollClip[] = [];
  const overlays: VisualOverlay[] = [];
  const subject = inferStockSubject(input.transcript);
  const visualQueries = stockFriendlyQueries(
    direction.visualQueries[0] ?? '',
    subject,
    direction.visualQueries.length > 0
      ? direction.visualQueries.slice(1)
      : themeQueriesFromTranscript(input.transcript),
  );

  const words = input.words ?? [];
  const speechAligned = direction.moments.map(moment => ({
    ...moment,
  }));
  void words;

  let splitCount = 0;
  for (const moment of spacedMoments(speechAligned, input.sourceDurationSec)) {
    try {
      const placed = await resolveMoment(
        {
          ...moment,
          searchKeyword: applySubjectToQuery(moment.searchKeyword, subject),
        },
        {
          timeline: input.timeline,
          usedVideoKeys,
          usedPhotoKeys,
          usedUserIds,
          userBrollById,
          visualQueries,
          subject,
          splitCount,
          words: input.words ?? [],
          northStar,
          allowStock,
          workspace: input.workspace,
          onNorthStarCost: cost => {
            estimatedCostUsd += cost;
          },
        },
      );
      if (!placed) {
        warnings.push(`no_match:${moment.searchKeyword}`);
        continue;
      }
      if (placed.clip) {
        clips.push(placed.clip);
      }
      if (placed.overlay) {
        const overlay =
          placed.overlay.layout === 'split'
            ? padSplitOverlay(
                placed.overlay,
                input.timeline.outputDurationSec,
                placed.overlay.assetDurationSec,
              )
            : placed.overlay;
        overlays.push(overlay);
        if (overlay.layout === 'split') {
          splitCount += 1;
        }
      }
    } catch (error) {
      log.warn({error, keyword: moment.searchKeyword}, 'asset lookup failed');
      warnings.push(`stock_failed:${moment.searchKeyword}`);
    }
  }

  // Leftover user assets are director-owned. Engine does not auto-place them.

  const keptOverlays = dropOverlappingOverlays(overlays, clips);
  const splitWindows = keptOverlays.filter(overlay => overlay.layout === 'split');
  const keptClips = dropOverlappingClips(clips).filter(
    clip =>
      !splitWindows.some(split => clip.start < split.end && clip.end > split.start),
  );
  if (keptClips.length < clips.length || keptOverlays.length < overlays.length) {
    warnings.push('overlapping_clips_dropped');
  }

  const timedFromDirector = Boolean(input.directorV2 || northStar);
  const transitions = planTransitions({
    clips: keptClips,
    overlays: keptOverlays,
  });

  const gated = applyEditorialGate({
    clips: keptClips,
    overlays: keptOverlays,
    transitions,
    zooms: direction.zooms,
    outputDurationSec: input.timeline.outputDurationSec,
    listMode: listBeatsFromTranscript(input.transcript).length >= 2,
    relax: northStar,
  });
  warnings.push(...gated.warnings);

  if (!stockConfigured()) {
    warnings.push('broll_not_configured');
  }
  if (!directorConfigured()) {
    warnings.push('director_not_configured');
  }

  const overlaysOut = gated.overlays;
  if (input.forceSpeakerCutout) {
    warnings.push('override:flag_over_director --cutout is not filled (unknown_kind).');
  }

  const depthResolved =
    !allowedEdits || allowedEdits.has('depth_overlay')
      ? await resolveDepthOverlays({
          directed: direction.depthOverlays,
          timeline: input.timeline,
          userBrollById,
          usedUserIds,
          usedPhotoKeys,
          clips: gated.clips,
          overlays: overlaysOut,
          occupancy: input.occupancy,
          occupancySlices: northStarPack?.occupancySlices,
          maskAvailable: Boolean(input.speakerCutout?.videoUrl),
          allowStock,
          alreadyOutput: timedFromDirector,
        })
      : {clips: [] as DepthOverlayClip[], warnings: [] as string[]};
  warnings.push(...depthResolved.warnings);

  const caption = lockCaptionTemplate(
    direction.caption ?? defaultCaptionDirection(input.transcript),
    input.captionTemplate,
  );
  const themeColors = [caption.highlightColor, caption.boxColor, caption.textColor].filter(
    (value): value is string => Boolean(value && /^#([0-9a-f]{6})$/i.test(value)),
  );

  const insetResolved =
    !allowedEdits || allowedEdits.has('inset_reveal')
      ? resolveInsetReveals({
          directed: direction.insetReveals,
          timeline: input.timeline,
          clips: gated.clips,
          overlays: overlaysOut,
          depthOverlays: depthResolved.clips,
          frameInsets: direction.frameInsets,
          mediaContainers: direction.mediaContainers,
          words: input.captionWords ?? input.words,
          sentences: northStarPack?.sentences,
          themeColors,
          alreadyOutput: timedFromDirector,
        })
      : {clips: [] as InsetRevealClip[], warnings: [] as string[]};
  warnings.push(...insetResolved.warnings);

  const hookTitle = direction.hookTitle?.trim() || '';
  const hookStartSec = round(
    Math.max(0, direction.hookStartSec ?? 0),
  );
  const hookHoldSec = round(
    Math.max(
      0,
      (direction.hookEndSec ?? hookStartSec) - hookStartSec || hookDurationSec,
    ),
  );

  const plan: VisualPlan = {
    hookTitle,
    hookSubtitle: '',
    hookStyle: direction.hookStyle,
    hookDurationSec: hookHoldSec,
    hookStartSec,
    caption,
    suggestedLutIds: direction.suggestedLutIds ?? [],
    preferredLutId: direction.preferredLutId ?? '',
    clips: gated.clips.sort((a, b) => a.start - b.start),
    overlays: overlaysOut,
    depthOverlays: depthResolved.clips,
    insetReveals: insetResolved.clips,
    transitions: gated.transitions,
    motionGraphics: remapMotionGraphics(
      direction.motionGraphics ?? [],
      input.timeline,
      timedFromDirector,
    ),
    mediaContainers: remapMediaContainers(
      direction.mediaContainers ?? [],
      input.timeline,
      timedFromDirector,
    ),
    frameInsets: remapFrameInsets(
      direction.frameInsets ?? [],
      input.timeline,
      timedFromDirector,
    ),
    semanticEmphasis: remapSemanticEmphasis(
      direction.semanticEmphasis ?? [],
      input.timeline,
      timedFromDirector,
    ),
    zooms: gated.zooms,
    warnings,
    estimatedCostUsd,
    editThesis,
    editThesisParts,
    directorReport,
    cta,
    audioDesign,
    assembler,
  };

  dumpDirectorTrace('03-engine-visual-plan', {
    hookTitle: plan.hookTitle,
    hookStyle: plan.hookStyle,
    hookStartSec: plan.hookStartSec,
    hookDurationSec: plan.hookDurationSec,
    caption: plan.caption,
    zooms: plan.zooms,
    clips: plan.clips,
    overlays: plan.overlays.map(overlay => ({
      start: overlay.start,
      end: overlay.end,
      layout: overlay.layout,
      text: overlay.overlayText,
      assetUrl: overlay.assetUrl,
    })),
    depthOverlays: plan.depthOverlays,
    insetReveals: plan.insetReveals,
    transitions: plan.transitions,
    motionGraphics: plan.motionGraphics,
    mediaContainers: plan.mediaContainers,
    semanticEmphasis: plan.semanticEmphasis,
    warnings: plan.warnings,
  });

  if (!northStar) {
    return attachFinalAudit(plan);
  }

  const north = await applyNorthStarPass({
    thesis: editThesis,
    thesisParts: editThesisParts,
    pack: northStarPack,
    story: northStarStory,
    fallbackOccupancy:
      input.occupancy ??
      northStarPack?.occupancySlices[0]?.occupancy ?? {
        speaker: {x: 0.18, y: 0.16, w: 0.64, h: 0.62},
        preferredSide: 'right',
        graphicAnchor: 'top_right',
        overlayAnchor: 'top_right',
        source: 'fallback',
      },
    hookTitle: plan.hookTitle,
    hookDurationSec: plan.hookDurationSec,
    caption: plan.caption,
    overlays: plan.overlays,
    motionGraphics: plan.motionGraphics,
    semanticEmphasis: plan.semanticEmphasis,
    speakerPalette: input.palette,
    audio: audioDesign,
    words: input.captionWords ?? input.words,
    workspace: input.workspace,
  });
  warnings.push(...north.warnings);
  estimatedCostUsd += north.estimatedCostUsd;
  return attachFinalAudit({
    ...plan,
    hookTitle: north.hookTitle,
    caption: north.caption,
    overlays: north.overlays,
    motionGraphics: north.motionGraphics,
    semanticEmphasis: north.semanticEmphasis,
    audioDesign: north.audioDesign,
    northStarDesign: north.design,
    northStarHookAnchor: north.hookAnchor,
    estimatedCostUsd,
    warnings,
  });
}

function attachFinalAudit(plan: VisualPlan): VisualPlan {
  if (!plan.assembler) {
    return plan;
  }
  return {
    ...plan,
    assembler: {
      ...plan.assembler,
      diff: reauditFinalTimeline({
        draftPlan: plan.assembler.draftPlan,
        scheduled: plan.assembler.scheduled,
        refusals: plan.assembler.refusals,
        log: plan.assembler.log,
        render: {
          hookTitle: plan.hookTitle,
          hookStartSec: plan.hookStartSec,
          hookDurationSec: plan.hookDurationSec,
          zooms: plan.zooms,
          clips: plan.clips,
          depthOverlays: plan.depthOverlays,
          insetReveals: plan.insetReveals,
          motionGraphics: plan.motionGraphics,
        },
      }),
    },
  };
}

async function resolveMoment(
  moment: DirectedMoment,
  ctx: {
    timeline: Timeline;
    usedVideoKeys: Set<string>;
    usedPhotoKeys: Set<string>;
    usedUserIds: Set<string>;
    userBrollById: Map<string, UserBrollAsset>;
    visualQueries: string[];
    subject: ReturnType<typeof inferStockSubject>;
    splitCount: number;
    words: WordToken[];
    northStar?: boolean;
    allowStock?: boolean;
    workspace?: {file: (name: string) => string};
    onNorthStarCost?: (cost: number) => void;
  },
): Promise<{clip?: BRollClip; overlay?: VisualOverlay} | null> {
  const textLayout =
    moment.layout === 'lockup' ||
    moment.layout === 'chip' ||
    moment.layout === 'banner' ||
    moment.layout === 'stat' ||
    moment.layout === 'bubble' ||
    moment.media === 'text';
  const phrase = (moment.overlayText || moment.searchKeyword || '').trim();
  const hold = textLayout
    ? speechPhraseWindow({
        words: ctx.words,
        atSec: moment.timestamp,
        phrase,
        fallbackSec: durationFor(moment.layout),
        lingerSec: 0.55,
        motionPadSec: 1.3,
      })
    : speechHoldWindow({
        words: ctx.words,
        atSec: moment.timestamp,
        phrase: `${moment.searchKeyword} ${moment.overlayText}`.trim(),
        fallbackSec: durationFor(moment.layout),
        maxSec: moment.layout === 'split' ? 12 : 8,
      });
  let start = ctx.timeline.mapSourceToOutputClamped(hold.start);
  const minHold =
    moment.treatment === 'slideshow'
      ? 3.6
      : moment.layout === 'split'
        ? 3.8
        : textLayout
          ? 2.4
          : 1.6;
  let end = clamp(
    ctx.timeline.mapSourceToOutputClamped(hold.end),
    start + minHold,
    ctx.timeline.outputDurationSec,
  );
  if (end - start < 0.9) {
    return null;
  }
  const guard = textLayout ? 0.7 : HOOK_GUARD_SEC;
  if (start < guard && ctx.timeline.outputDurationSec > guard + 2) {
    if (moment.layout !== 'cutaway') {
      return null;
    }
    start = guard;
    end = clamp(Math.max(end, start + minHold), start + minHold, ctx.timeline.outputDurationSec);
  }

  if (
    moment.layout === 'lockup' ||
    moment.layout === 'chip' ||
    moment.layout === 'banner' ||
    moment.layout === 'stat' ||
    moment.media === 'text'
  ) {
    return {
      overlay: textOverlay(moment, start, end),
    };
  }

  if (moment.layout === 'cutaway' || moment.layout === 'split') {
    const userAsset = pickUserBrollForMoment(moment, ctx);
    if (userAsset) {
      if (moment.layout === 'split') {
        if (isStillUserAsset(userAsset)) {
          const photos = collectUserPhotos(ctx, userAsset);
          if (photos.length >= 2) {
            for (const photo of photos) {
              ctx.usedUserIds.add(photo.id);
            }
            return {
              overlay: withSlides(
                toUserOverlay(
                  moment,
                  photos[0]!,
                  start,
                  end,
                  'split',
                  pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
                ),
                slidesFromUser(photos),
              ),
            };
          }
        }
        ctx.usedUserIds.add(userAsset.id);
        return {
          overlay: toUserOverlay(
            moment,
            userAsset,
            start,
            end,
            'split',
            pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
          ),
        };
      }
      ctx.usedUserIds.add(userAsset.id);
      return {
        clip: toUserClip(moment, userAsset, start, end),
      };
    }

    if (!ctx.allowStock || !stockConfigured()) {
      return null;
    }

    const queries = momentQueries(
      moment.searchKeyword,
      ctx.subject,
      [...(moment.queries ?? []), ...ctx.visualQueries.slice(0, 4)],
    );
    if (moment.layout === 'split' && moment.treatment === 'slideshow') {
      const photos = await collectPhotos(queries, ctx.usedPhotoKeys, 4);
      if (photos.length >= 2) {
        for (const photo of photos) {
          ctx.usedPhotoKeys.add(stockAssetKeyOf(photo));
        }
        return {
          overlay: withSlides(
            toOverlay(
              moment,
              photos[0]!,
              start,
              end,
              'image',
              'split',
              pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
            ),
            slidesFromStock(photos),
          ),
        };
      }
    }
    const video = await firstVideo(queries, {
      minDurationSec: Math.min(end - start, 2.2),
      excludeKeys: ctx.usedVideoKeys,
      northStar: ctx.northStar,
      spokenBeat: beatTextAround(ctx.words, moment.timestamp),
      intent: `${moment.searchKeyword} ${moment.overlayText}`.trim(),
      workspace: ctx.workspace,
      onCost: ctx.onNorthStarCost,
    });
    if (video) {
      ctx.usedVideoKeys.add(stockAssetKeyOf(video));
      if (moment.layout === 'split') {
        return {
          overlay: toOverlay(
            moment,
            video,
            start,
            end,
            'video',
            'split',
            pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
          ),
        };
      }
      return {
        clip: toClip(moment, video, start, end),
      };
    }
    if (moment.layout === 'split') {
      const photos = await collectPhotos(queries, ctx.usedPhotoKeys, 4);
      if (photos.length === 0) {
        return null;
      }
      for (const photo of photos) {
        ctx.usedPhotoKeys.add(stockAssetKeyOf(photo));
      }
      const overlay = toOverlay(
        moment,
        photos[0]!,
        start,
        end,
        'image',
        'split',
        pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
      );
      return {
        overlay: photos.length >= 2 ? withSlides(overlay, slidesFromStock(photos)) : overlay,
      };
    }
    return null;
  }

  if (moment.layout === 'cutout' || moment.layout === 'composite') {
    const userAsset = pickUserBrollForMoment(moment, ctx);
    if (userAsset) {
      ctx.usedUserIds.add(userAsset.id);
      return {
        overlay: toUserOverlay(moment, userAsset, start, end, moment.layout),
      };
    }
    if (ctx.allowStock && stockConfigured()) {
      const queries = momentQueries(
        moment.searchKeyword,
        ctx.subject,
        [...(moment.queries ?? []), ...ctx.visualQueries.slice(0, 4)],
      );
      const video = await firstVideo(queries, {
        minDurationSec: Math.min(end - start, 2.2),
        excludeKeys: ctx.usedVideoKeys,
        northStar: ctx.northStar,
        spokenBeat: beatTextAround(ctx.words, moment.timestamp),
        intent: `${moment.searchKeyword} ${moment.overlayText}`.trim(),
        workspace: ctx.workspace,
        onCost: ctx.onNorthStarCost,
      });
      if (video) {
        ctx.usedVideoKeys.add(stockAssetKeyOf(video));
        return {
          overlay: toOverlay(moment, video, start, end, 'video', moment.layout),
        };
      }
      const photo = await firstPhoto(queries, ctx.usedPhotoKeys);
      if (photo) {
        ctx.usedPhotoKeys.add(stockAssetKeyOf(photo));
        return {
          overlay: toOverlay(moment, photo, start, end, 'image', moment.layout),
        };
      }
    }
    return {
      overlay: {
        ...textOverlay(moment, start, end),
        layout: moment.layout,
        overlayText: moment.overlayText || '',
      },
    };
  }

  if (moment.layout === 'bubble') {
    return {
      overlay: {
        ...textOverlay(moment, start, end),
        layout: 'bubble',
        textStyle: 'bubble',
      },
    };
  }

  if (moment.layout === 'card' || moment.layout === 'pip' || moment.layout === 'sticker') {
    const userAsset = pickUserBrollForMoment(moment, ctx);
    if (userAsset) {
      if (isStillUserAsset(userAsset)) {
        const photos = collectUserPhotos(ctx, userAsset);
        const wantShow =
          moment.treatment === 'slideshow' || photos.length >= 3 || end - start >= 3.6;
        if (wantShow && photos.length >= 2) {
          for (const photo of photos) {
            ctx.usedUserIds.add(photo.id);
          }
          return {
            overlay: withSlides(
              toDesignedCard(moment, photos[0]!, start, end, ctx.usedUserIds.size - 1),
              slidesFromUser(photos),
            ),
          };
        }
      }
      ctx.usedUserIds.add(userAsset.id);
      return {
        overlay: toDesignedCard(moment, userAsset, start, end, ctx.usedUserIds.size - 1),
      };
    }
    if (!ctx.allowStock || !stockConfigured()) {
      return null;
    }
    const queries = momentQueries(
      moment.searchKeyword,
      ctx.subject,
      [...(moment.queries ?? []), ...ctx.visualQueries.slice(0, 4)],
    );
    const wantSlides = moment.treatment === 'slideshow' || end - start >= 3.6;
    const photos = await collectPhotos(queries, ctx.usedPhotoKeys, wantSlides ? 4 : 1);
    if (photos.length === 0) {
      return null;
    }
    for (const photo of photos) {
      ctx.usedPhotoKeys.add(stockAssetKeyOf(photo));
    }
    const overlay = toOverlay(moment, photos[0]!, start, end, 'image', 'card');
    return {
      overlay: photos.length >= 2 ? withSlides(overlay, slidesFromStock(photos)) : overlay,
    };
  }

  return null;
}

function pickUserBrollForMoment(
  moment: DirectedMoment,
  ctx: {
    usedUserIds: Set<string>;
    userBrollById: Map<string, UserBrollAsset>;
    allowStock?: boolean;
  },
): UserBrollAsset | null {
  if (moment.userBrollId) {
    const tagged = ctx.userBrollById.get(moment.userBrollId);
    if (tagged) {
      return tagged;
    }
  }
  let best: UserBrollAsset | null = null;
  let bestScore = ctx.allowStock === false ? 0.01 : 0.34;
  for (const asset of ctx.userBrollById.values()) {
    const score = scoreUserBrollMatch(asset, moment.searchKeyword);
    if (score > bestScore) {
      bestScore = score;
      best = asset;
    }
  }
  return best;
}

function assignUserBrollToMoments(
  moments: DirectedMoment[],
  assets: UserBrollAsset[],
): void {
  const used = new Set(
    moments.map(m => m.userBrollId).filter((id): id is string => Boolean(id)),
  );
  for (const moment of moments) {
    if (moment.userBrollId || (moment.layout !== 'cutaway' && moment.layout !== 'split' && moment.layout !== 'card' && moment.layout !== 'pip' && moment.layout !== 'cutout')) {
      continue;
    }
    let best: UserBrollAsset | null = null;
    let bestScore = 0.08;
    for (const asset of assets) {
      if (used.has(asset.id)) {
        continue;
      }
      const score = scoreUserBrollMatch(asset, moment.searchKeyword);
      if (score > bestScore) {
        bestScore = score;
        best = asset;
      }
    }
    if (best) {
      moment.userBrollId = best.id;
      used.add(best.id);
    }
  }
  // Assign remaining assets to untagged cutaways in order.
  const leftover = assets.filter(asset => !used.has(asset.id));
  let li = 0;
  for (const moment of moments) {
    if (li >= leftover.length) {
      break;
    }
    if (moment.userBrollId || (moment.layout !== 'cutaway' && moment.layout !== 'split')) {
      continue;
    }
    moment.userBrollId = leftover[li]!.id;
    li += 1;
  }
}

function injectForcedUserCutaways(
  moments: DirectedMoment[],
  assets: UserBrollAsset[],
  outputDurationSec: number,
): void {
  const used = new Set(
    moments.map(m => m.userBrollId).filter((id): id is string => Boolean(id)),
  );
  const leftover = assets.filter(asset => !used.has(asset.id));
  leftover.forEach((asset, index) => {
    const timestamp = Math.min(
      outputDurationSec - 2.6,
      HOOK_GUARD_SEC + 1.4 + index * 3.2,
    );
    if (timestamp < HOOK_GUARD_SEC) {
      return;
    }
    moments.push({
      timestamp,
      searchKeyword: asset.description.slice(0, 48) || asset.id,
      media: asset.kind === 'photo' || asset.kind === 'document' ? 'image' : 'video',
      layout: asset.kind === 'clip' ? 'cutaway' : 'card',
      treatment:
        asset.kind === 'document'
          ? 'focus'
          : asset.kind === 'tall'
            ? 'scroll'
            : 'card',
      anchor: index % 2 === 0 ? 'top_right' : 'top_left',
      overlayText: '',
      textStyle: 'outline',
      accentColor: '#FDE68A',
      userBrollId: asset.id,
      glow: true,
      staggerIndex: index,
      focusRegion: asset.regions[0]
        ? {
            x: asset.regions[0].x,
            y: asset.regions[0].y,
            w: asset.regions[0].w,
            h: asset.regions[0].h,
            label: asset.regions[0].label,
          }
        : null,
    });
  });
}

function placeLeftoverUserBroll(input: {
  assets: UserBrollAsset[];
  usedUserIds: Set<string>;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  timeline: Timeline;
  sourceDurationSec: number;
  skipVideoLeftovers?: boolean;
}): void {
  const leftovers = input.assets.filter(asset => !input.usedUserIds.has(asset.id));
  if (leftovers.length === 0) {
    return;
  }
  const leftoverClips = input.skipVideoLeftovers
    ? []
    : leftovers.filter(asset => !isStillUserAsset(asset));
  const leftoverPhotos = leftovers.filter(asset => isStillUserAsset(asset));
  const occupied = [
    ...input.clips.map(clip => ({start: clip.start, end: clip.end})),
    ...input.overlays.map(overlay => ({start: overlay.start, end: overlay.end})),
  ];
  let cursor = HOOK_GUARD_SEC + 0.5;

  const placeWindow = (duration: number): {start: number; end: number} | null => {
    while (cursor + duration < input.timeline.outputDurationSec - 0.8) {
      const start = cursor;
      const end = start + duration;
      const overlaps = occupied.some(win => start < win.end + 0.4 && end > win.start - 0.4);
      if (!overlaps) {
        occupied.push({start, end});
        cursor = end + MIN_GAP_SEC + 1.2;
        return {start, end};
      }
      cursor += 1.1;
    }
    return null;
  };

  if (leftoverPhotos.length >= 2) {
    const window = placeWindow(3.6);
    if (window) {
      for (const photo of leftoverPhotos) {
        input.usedUserIds.add(photo.id);
      }
      input.overlays.push(
        withSlides(
          {
            start: round(window.start),
            end: round(window.end),
            layout: 'card',
            mediaKind: 'image',
            anchor: 'top_right',
            keyword: leftoverPhotos[0]?.description.slice(0, 60) || 'photos',
            overlayText: '',
            assetUrl: leftoverPhotos[0]!.url,
            provider: 'user',
            providerId: userProviderId(leftoverPhotos[0]!.id),
            width: leftoverPhotos[0]!.width,
            height: leftoverPhotos[0]!.height,
            credit: 'Creator B-roll',
            creditUrl: '',
            accentColor: '#FDE68A',
            textStyle: 'outline',
            treatment: 'slideshow',
            visualWeight: 'accent',
          },
          slidesFromUser(leftoverPhotos),
        ),
      );
    }
  } else {
    for (const photo of leftoverPhotos) {
      const window = placeWindow(2.6);
      if (!window) {
        continue;
      }
      input.usedUserIds.add(photo.id);
      input.overlays.push({
        start: round(window.start),
        end: round(window.end),
        layout: 'card',
        mediaKind: 'image',
        anchor: 'top_right',
        keyword: photo.description.slice(0, 60) || photo.id,
        overlayText: '',
        assetUrl: photo.url,
        provider: 'user',
        providerId: userProviderId(photo.id),
        width: photo.width,
        height: photo.height,
        credit: 'Creator B-roll',
        creditUrl: '',
        accentColor: '#FDE68A',
        textStyle: 'outline',
        treatment: 'card',
        visualWeight: 'accent',
      });
    }
  }

  for (const asset of leftoverClips) {
    const duration =
      asset.durationSec >= 0.6
        ? Math.min(5, Math.max(1.6, asset.durationSec))
        : 2.4;
    const window = placeWindow(duration);
    if (!window) {
      log.debug({id: asset.id}, 'could not place leftover user broll');
      continue;
    }
    input.clips.push({
      start: round(window.start),
      end: round(window.end),
      keyword: asset.description.slice(0, 60) || asset.id,
      assetUrl: asset.url,
      provider: 'user',
      providerId: userProviderId(asset.id),
      width: asset.width,
      height: asset.height,
      credit: 'Creator B-roll',
      creditUrl: '',
      durationSec: asset.durationSec,
    });
    input.usedUserIds.add(asset.id);
  }
}

function toUserClip(
  moment: DirectedMoment,
  asset: UserBrollAsset,
  start: number,
  end: number,
): BRollClip {
  return {
    start: round(start),
    end: round(end),
    keyword: moment.searchKeyword || asset.description.slice(0, 60),
    assetUrl: asset.url,
    provider: 'user',
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
    durationSec: asset.kind === 'clip' || asset.kind === 'tall' ? asset.durationSec : undefined,
  };
}

function toUserOverlay(
  moment: DirectedMoment,
  asset: UserBrollAsset,
  start: number,
  end: number,
  layout: VisualOverlay['layout'],
  speakerSide?: 'top' | 'bottom',
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout,
    mediaKind: asset.kind === 'clip' || asset.kind === 'tall' ? 'video' : 'image',
    anchor: moment.anchor,
    keyword: moment.searchKeyword || asset.description.slice(0, 60),
    overlayText: moment.overlayText,
    assetUrl: asset.url,
    provider: 'user',
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: moment.textStyle || 'outline',
    speakerSide: layout === 'split' ? speakerSide ?? 'bottom' : undefined,
    assetDurationSec:
      asset.kind === 'clip' || asset.kind === 'tall' ? asset.durationSec : undefined,
    ...motionFields(moment, asset),
  };
}

function toDesignedCard(
  moment: DirectedMoment,
  asset: UserBrollAsset,
  start: number,
  end: number,
  staggerIndex: number,
): VisualOverlay {
  const treatment =
    moment.treatment ||
    (asset.kind === 'document' ? 'focus' : asset.kind === 'tall' ? 'scroll' : 'card');
  const matched = matchRegionToSpeech(
    asset,
    `${moment.overlayText} ${moment.searchKeyword} ${moment.focusRegion?.label ?? ''}`,
  );
  const focus =
    moment.focusRegion ||
    (matched
      ? {x: matched.x, y: matched.y, w: matched.w, h: matched.h, label: matched.label}
      : null);
  return {
    start: round(start),
    end: round(end),
    layout: 'card',
    mediaKind: asset.kind === 'clip' || asset.kind === 'tall' ? 'video' : 'image',
    anchor: moment.anchor === 'top' || moment.anchor === 'bottom' ? 'top_right' : moment.anchor,
    keyword: moment.searchKeyword || asset.description.slice(0, 60),
    overlayText: moment.overlayText,
    assetUrl: asset.url,
    provider: 'user',
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
    accentColor: moment.accentColor || '#FDE68A',
    textStyle: moment.textStyle || 'outline',
    treatment,
    cornerRadius: 28,
    glow: moment.glow !== false,
    focusRegion: treatment === 'focus' ? focus : null,
    scrollAxis: treatment === 'scroll' ? 'y' : 'none',
    staggerIndex: moment.staggerIndex ?? staggerIndex,
    visualWeight: moment.visualWeight === 'hero' ? 'hero' : 'accent',
  };
}

function motionFields(
  moment: DirectedMoment,
  asset?: UserBrollAsset,
): Pick<
  VisualOverlay,
  | 'treatment'
  | 'cornerRadius'
  | 'glow'
  | 'focusRegion'
  | 'scrollAxis'
  | 'staggerIndex'
  | 'visualWeight'
> {
  const treatment =
    moment.treatment ||
    (moment.layout === 'card' || moment.layout === 'pip' || moment.layout === 'sticker'
      ? 'card'
      : 'card');
  const matched = asset
    ? matchRegionToSpeech(asset, `${moment.overlayText} ${moment.searchKeyword}`)
    : null;
  return {
    treatment,
    cornerRadius: 28,
    glow: moment.glow !== false,
    focusRegion:
      moment.focusRegion ||
      (matched
        ? {x: matched.x, y: matched.y, w: matched.w, h: matched.h, label: matched.label}
        : null),
    scrollAxis: treatment === 'scroll' ? 'y' : 'none',
    staggerIndex: moment.staggerIndex ?? 0,
    visualWeight: moment.visualWeight === 'hero' ? 'hero' : 'accent',
  };
}

function userProviderId(id: string): number {
  const match = id.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

async function firstPhoto(
  queries: string[],
  excludeKeys: Set<string>,
): Promise<StockAsset | null> {
  for (const query of queries) {
    const asset = await findPhotoAsset(query, {excludeKeys, orientation: 'portrait'});
    if (asset) {
      return asset;
    }
  }
  return null;
}

async function collectPhotos(
  queries: string[],
  excludeKeys: Set<string>,
  count: number,
): Promise<StockAsset[]> {
  const out: StockAsset[] = [];
  const used = new Set(excludeKeys);
  for (let i = 0; i < Math.max(1, count); i += 1) {
    const photo = await firstPhoto(queries, used);
    if (!photo) {
      break;
    }
    used.add(stockAssetKeyOf(photo));
    out.push(photo);
  }
  return out;
}

function isStillUserAsset(asset: UserBrollAsset): boolean {
  return asset.kind === 'photo' || asset.kind === 'document';
}

function collectUserPhotos(
  ctx: {usedUserIds: Set<string>; userBrollById: Map<string, UserBrollAsset>},
  seed: UserBrollAsset,
): UserBrollAsset[] {
  const photos: UserBrollAsset[] = [];
  if (seed.kind === 'photo' || seed.kind === 'document') {
    photos.push(seed);
  }
  for (const asset of ctx.userBrollById.values()) {
    if (ctx.usedUserIds.has(asset.id) || asset.id === seed.id) {
      continue;
    }
    if (asset.kind !== 'photo' && asset.kind !== 'document') {
      continue;
    }
    photos.push(asset);
    if (photos.length >= 4) {
      break;
    }
  }
  return photos;
}

function slidesFromStock(assets: StockAsset[]): OverlaySlide[] {
  return assets.map(asset => ({
    assetUrl: asset.assetUrl,
    provider: asset.provider,
    providerId: asset.providerId,
    width: asset.width,
    height: asset.height,
    credit: asset.credit,
    creditUrl: asset.creditUrl,
  }));
}

function slidesFromUser(assets: UserBrollAsset[]): OverlaySlide[] {
  return assets.map(asset => ({
    assetUrl: asset.url,
    provider: 'user' as const,
    providerId: userProviderId(asset.id),
    width: asset.width,
    height: asset.height,
    credit: 'Creator B-roll',
    creditUrl: '',
  }));
}

function withSlides(overlay: VisualOverlay, slides: OverlaySlide[]): VisualOverlay {
  if (slides.length < 2) {
    return overlay;
  }
  return {
    ...overlay,
    mediaKind: 'image',
    treatment: 'slideshow',
    slides,
    slideTransition: 'crossfade',
    assetUrl: slides[0]?.assetUrl || overlay.assetUrl,
  };
}

async function firstVideo(
  queries: string[],
  options: {
    minDurationSec: number;
    excludeKeys: Set<string>;
    northStar?: boolean;
    spokenBeat?: string;
    intent?: string;
    workspace?: {file: (name: string) => string};
    onCost?: (cost: number) => void;
  },
): Promise<StockAsset | null> {
  if (options.northStar) {
    let fallback: StockAsset | null = null;
    for (const query of queries) {
      const candidates = await listBRollAssets(query, {
        minDurationSec: options.minDurationSec,
        excludeKeys: options.excludeKeys,
        limit: 8,
      });
      const picked = pickRankedAsset(candidates, {minDurationSec: options.minDurationSec});
      if (!picked) {
        continue;
      }
      fallback ??= picked;
      const ranked = [
        picked,
        ...candidates.filter(candidate => stockAssetKeyOf(candidate) !== stockAssetKeyOf(picked)),
      ];
      const semantic = await chooseSemanticallyRelevantAsset({
        candidates: ranked,
        spokenBeat: options.spokenBeat ?? '',
        intent: options.intent || query,
        workspace: options.workspace,
      });
      options.onCost?.(semantic.estimatedCostUsd);
      if (semantic.asset) {
        return semantic.asset;
      }
      log.info({query, reason: semantic.reason}, 'north-star ranked stock without a strong vision match');
    }
    return fallback;
  }
  for (const query of queries) {
    const asset = await findBRollAsset(query, options);
    if (asset) {
      return asset;
    }
  }
  return null;
}

function beatTextAround(words: WordToken[], atSec: number): string {
  const nearby = words.filter(
    word => word.end >= atSec - 1.4 && word.start <= atSec + 3.2,
  );
  return nearby.map(word => word.text).join(' ').trim();
}

/** 2–4 word Pexels scenes from the director keyword plus searchable variants. */
function momentQueries(
  keyword: string,
  subject: ReturnType<typeof inferStockSubject>,
  extras: string[] = [],
): string[] {
  return stockFriendlyQueries(keyword, subject, extras);
}

function uniqueQueries(
  values: string[],
  subject: ReturnType<typeof inferStockSubject> = null,
): string[] {
  return stockFriendlyQueries(values[0] ?? '', subject, values.slice(1));
}

function injectForcedCutout(input: {
  overlays: VisualOverlay[];
  clips: BRollClip[];
  userBrollAssets: UserBrollAsset[];
  timeline: Timeline;
}): VisualOverlay[] {
  const start = Math.min(2.2, Math.max(0.6, input.timeline.outputDurationSec * 0.1));
  const end = Math.max(start + 1.2, input.timeline.outputDurationSec);
  const plate =
    input.userBrollAssets.find(asset => Boolean(asset.url)) ||
    null;
  const clipPlate = input.clips.find(clip => Boolean(clip.assetUrl));
  const existing = input.overlays.find(overlay => overlay.layout === 'cutout');
  const cutout: VisualOverlay = {
    start: round(start),
    end: round(end),
    layout: 'cutout',
    mediaKind: plate || clipPlate ? 'video' : existing?.mediaKind || 'image',
    anchor: existing?.anchor || 'bottom',
    keyword: existing?.keyword || 'speaker cutout plate',
    overlayText: existing?.overlayText || '',
    assetUrl: existing?.assetUrl || plate?.url || clipPlate?.assetUrl || '',
    provider: existing?.provider ?? (plate ? 'user' : clipPlate?.provider ?? 'generated'),
    providerId: existing?.providerId || 1,
    width: existing?.width || plate?.width || clipPlate?.width || 1080,
    height: existing?.height || plate?.height || clipPlate?.height || 1920,
    credit: existing?.credit ?? (plate ? 'Creator B-roll' : clipPlate?.credit || ''),
    creditUrl: existing?.creditUrl || clipPlate?.creditUrl || '',
    accentColor: existing?.accentColor || '#F8FAFC',
    textStyle: existing?.textStyle || 'outline',
    treatment: 'float',
    visualWeight: 'hero',
  };
  return [cutout, ...input.overlays.filter(overlay => overlay.layout !== 'cutout')];
}

function padSplitOverlay(
  overlay: VisualOverlay,
  outputDurationSec: number,
  assetDurationSec = overlay.assetDurationSec ?? 0,
): VisualOverlay {
  const speechSec = Math.max(0.4, overlay.end - overlay.start);
  const still = splitStillSec({
    speechSec,
    mediaKind: overlay.mediaKind,
    assetDurationSec,
  });
  const end = clamp(
    overlay.start + splitTotalSec(still),
    overlay.start + splitTotalSec(SPLIT_MIN_STILL_SEC * 0.5),
    outputDurationSec,
  );
  return {
    ...overlay,
    end: round(end),
    assetDurationSec: overlay.mediaKind === 'video' ? still : overlay.assetDurationSec,
  };
}

function durationFor(layout: DirectedMoment['layout']): number {
  if (layout === 'split') {
    return SPLIT_MIN_STILL_SEC;
  }
  if (layout === 'cutout') {
    return 3.2;
  }
  if (layout === 'cutaway' || layout === 'composite') {
    return Math.max(1.8, Math.min(3.2, env.BROLL_CLIP_DURATION_SEC));
  }
  if (layout === 'bubble' || layout === 'lockup' || layout === 'banner' || layout === 'chip') {
    return 2.2;
  }
  return 2.2;
}

function toClip(
  moment: DirectedMoment,
  asset: StockAsset,
  start: number,
  end: number,
): BRollClip {
  return {
    start: round(start),
    end: round(end),
    keyword: moment.searchKeyword,
    assetUrl: asset.assetUrl,
    provider: asset.provider,
    providerId: asset.providerId,
    width: asset.width,
    height: asset.height,
    credit: asset.credit,
    creditUrl: asset.creditUrl,
  };
}

function toOverlay(
  moment: DirectedMoment,
  asset: StockAsset,
  start: number,
  end: number,
  mediaKind: VisualOverlay['mediaKind'],
  layout: VisualOverlay['layout'],
  speakerSide?: 'top' | 'bottom',
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout,
    mediaKind,
    anchor: moment.anchor,
    keyword: moment.searchKeyword,
    overlayText: moment.overlayText,
    assetUrl: asset.assetUrl,
    provider: asset.provider,
    providerId: asset.providerId,
    width: asset.width,
    height: asset.height,
    credit: asset.credit,
    creditUrl: asset.creditUrl,
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: moment.textStyle || 'outline',
    speakerSide: layout === 'split' ? speakerSide ?? 'bottom' : undefined,
    assetDurationSec: mediaKind === 'video' ? asset.durationSec : undefined,
    ...motionFields(moment),
  };
}

function pickSpeakerSide(seed: string, splitIndex: number): 'top' | 'bottom' {
  let hash = splitIndex * 17;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? 'top' : 'bottom';
}

function textOverlay(
  moment: DirectedMoment,
  start: number,
  end: number,
): VisualOverlay {
  return {
    start: round(start),
    end: round(end),
    layout:
      moment.layout === 'chip' ||
      moment.layout === 'banner' ||
      moment.layout === 'lockup' ||
      moment.layout === 'bubble'
        ? moment.layout
        : 'lockup',
    mediaKind: 'text',
    anchor: moment.anchor,
    keyword: moment.searchKeyword,
    overlayText: moment.overlayText || moment.searchKeyword,
    assetUrl: '',
    provider: 'generated',
    providerId: 0,
    width: 0,
    height: 0,
    credit: '',
    creditUrl: '',
    accentColor: moment.accentColor || '#FFFFFF',
    textStyle: (moment.textStyle || 'bar') as OverlayTextStyle,
  };
}

function spacedMoments(
  moments: DirectedMoment[],
  durationSec: number,
): DirectedMoment[] {
  const sorted = [...moments].sort((a, b) => a.timestamp - b.timestamp);
  const out: DirectedMoment[] = [];
  for (const moment of sorted) {
    const timestamp = Math.max(HOOK_GUARD_SEC, Math.min(durationSec - 1, moment.timestamp));
    const previous = out.at(-1);
    const speechLocked = moment.layout === 'cutaway' || moment.layout === 'split';
    if (previous && timestamp < previous.timestamp + (speechLocked ? 2.6 : 5)) {
      if (speechLocked) {
        // Never nudge speech-aligned cutaways — that desyncs "swimming" from the swim shot.
        // Drop the earlier visual if this one is closer to a new spoken beat.
        if (
          (previous.layout === 'cutaway' || previous.layout === 'split') &&
          timestamp - previous.timestamp < 2.6
        ) {
          continue;
        }
        out.push({...moment, timestamp});
        continue;
      }
      const keep =
        moment.layout === 'lockup' && moment.textStyle === 'stack';
      const nudged = previous.timestamp + 5.2;
      if (!keep || nudged > durationSec - 2.8) {
        continue;
      }
      out.push({...moment, timestamp: nudged});
      continue;
    }
    out.push({...moment, timestamp});
  }
  return out;
}

function dropOverlappingClips(clips: BRollClip[]): BRollClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const out: BRollClip[] = [];
  for (const clip of sorted) {
    const previous = out.at(-1);
    if (previous && clip.start < previous.end + MIN_GAP_SEC) {
      continue;
    }
    out.push(clip);
  }
  return out;
}

function dropOverlappingOverlays(
  overlays: VisualOverlay[],
  clips: BRollClip[],
): VisualOverlay[] {
  const sorted = [...overlays].sort((a, b) => {
    const rank = (layout: VisualOverlay['layout']) =>
      layout === 'split' ? 0 : layout === 'lockup' ? 1 : 2;
    const byRank = rank(a.layout) - rank(b.layout);
    return byRank !== 0 ? byRank : a.start - b.start;
  });
  const out: VisualOverlay[] = [];
  for (const overlay of sorted) {
    const hitsClip = clips.some(
      clip => overlay.start < clip.end && overlay.end > clip.start,
    );
    if (overlay.layout === 'split') {
      out.push(overlay);
      continue;
    }
    if (
      hitsClip &&
      overlay.layout !== 'pip' &&
      overlay.layout !== 'sticker' &&
      overlay.layout !== 'chip'
    ) {
      continue;
    }
    const hitsKept = out.some(
      previous => overlay.start < previous.end + MIN_GAP_SEC && overlay.end > previous.start - MIN_GAP_SEC,
    );
    if (hitsKept && overlay.layout !== 'pip' && overlay.layout !== 'sticker') {
      continue;
    }
    out.push(overlay);
  }
  return out.sort((a, b) => a.start - b.start);
}

function overlapsAny(
  start: number,
  end: number,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): boolean {
  return (
    clips.some(clip => start < clip.end && end > clip.start) ||
    overlays.some(overlay => start < overlay.end && end > overlay.start)
  );
}

function planTransitions(input: {
  clips: BRollClip[];
  overlays: VisualOverlay[];
}): TransitionClip[] {
  const cuts = [
    ...input.clips.map(clip => clip.start),
    ...input.overlays
      .filter(
        overlay =>
          overlay.layout === 'split' ||
          overlay.layout === 'composite' ||
          overlay.layout === 'cutaway',
      )
      .map(overlay => overlay.start),
  ]
    .filter((at, index, all) => all.findIndex(other => Math.abs(other - at) < 0.4) === index)
    .sort((a, b) => a - b)
    .filter(at => at > 3.2);

  return cuts.slice(0, 6).map((at, index) => ({
    at: round(at),
    duration: 0.38,
    keyword: TRANSITION_QUERIES[index % TRANSITION_QUERIES.length]!,
    assetUrl: '',
    blend: index % 2 === 0 ? 'screen' : 'lighten',
    provider: 'generated',
    providerId: 0,
    width: 1080,
    height: 1920,
    credit: '',
    creditUrl: '',
  }));
}

async function ensureCutaways(input: {
  needed: number;
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
}): Promise<BRollClip[]> {
  const extras: BRollClip[] = [];
  const output = input.timeline.outputDurationSec;
  const duration = Math.max(3.2, Math.min(3.8, env.BROLL_CLIP_DURATION_SEC));
  const slots = [output * 0.22, output * 0.48, output * 0.72]
    .map(start => Math.max(HOOK_GUARD_SEC + 0.4, start))
    .filter(start => start + duration < output - 0.4);

  for (const start of slots) {
    if (extras.length >= input.needed) {
      break;
    }
    if (overlapsAny(start, start + duration, [...input.existingClips, ...extras], input.existingOverlays)) {
      continue;
    }
    const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
      minDurationSec: 2,
      excludeKeys: input.usedVideoKeys,
    });
    if (!video) {
      break;
    }
    input.usedVideoKeys.add(stockAssetKeyOf(video));
    extras.push(
      toClip(
        {
          timestamp: start,
          searchKeyword: input.queries[0] ?? 'cinematic travel',
          media: 'video',
          layout: 'cutaway',
          anchor: 'top',
          overlayText: '',
          textStyle: 'outline',
          accentColor: '#FFFFFF',
        },
        video,
        start,
        start + duration,
      ),
    );
  }
  return extras;
}

/**
 * Long unbroken talking-head stretches feel static. Drop a cutaway into each
 * gap longer than maxTalkSec between existing cutaways/splits.
 */
export function findStaticGapStarts(_input: {
  outputDurationSec: number;
  clips: BRollClip[];
  overlays: VisualOverlay[];
  maxTalkSec: number;
  cutawayDurationSec: number;
}): number[] {
  return [];
}

async function fillStaticTalkingHeadGaps(input: {
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
  maxTalkSec: number;
}): Promise<BRollClip[]> {
  const duration = Math.max(3.2, Math.min(3.8, env.BROLL_CLIP_DURATION_SEC));
  const slots = findStaticGapStarts({
    outputDurationSec: input.timeline.outputDurationSec,
    clips: input.existingClips,
    overlays: input.existingOverlays,
    maxTalkSec: input.maxTalkSec,
    cutawayDurationSec: duration,
  });
  const extras: BRollClip[] = [];
  for (const start of slots) {
    if (overlapsAny(start, start + duration, [...input.existingClips, ...extras], input.existingOverlays)) {
      continue;
    }
    const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
      minDurationSec: 2,
      excludeKeys: input.usedVideoKeys,
    });
    if (!video) {
      break;
    }
    input.usedVideoKeys.add(stockAssetKeyOf(video));
    extras.push(
      toClip(
        {
          timestamp: start,
          searchKeyword: input.queries[extras.length % Math.max(1, input.queries.length)] ?? 'lifestyle broll',
          media: 'video',
          layout: 'cutaway',
          anchor: 'top',
          overlayText: '',
          textStyle: 'outline',
          accentColor: '#FFFFFF',
        },
        video,
        start,
        start + duration,
      ),
    );
  }
  return extras;
}

function findOpenSlot(
  duration: number,
  output: number,
  clips: BRollClip[],
  overlays: VisualOverlay[],
): number | null {
  const earliest = HOOK_GUARD_SEC + 0.6;
  const latest = output - duration - 0.5;
  if (latest <= earliest) {
    return null;
  }
  const preferred = [
    output * 0.38,
    output * 0.18,
    output * 0.55,
    output * 0.68,
    output * 0.82,
  ];
  for (const raw of preferred) {
    const start = Math.max(earliest, Math.min(latest, raw));
    if (!overlapsAny(start, start + duration, clips, overlays)) {
      return start;
    }
  }
  for (let start = earliest; start <= latest; start += 1.1) {
    if (!overlapsAny(start, start + duration, clips, overlays)) {
      return start;
    }
  }
  return null;
}

async function ensureSplit(input: {
  queries: string[];
  timeline: Timeline;
  usedVideoKeys: Set<string>;
  existingClips: BRollClip[];
  existingOverlays: VisualOverlay[];
  subject: ReturnType<typeof inferStockSubject>;
}): Promise<VisualOverlay | null> {
  const output = input.timeline.outputDurationSec;
  const duration = splitTotalSec(SPLIT_MIN_STILL_SEC);
  const start = findOpenSlot(
    duration,
    output,
    input.existingClips,
    input.existingOverlays,
  );
  if (start == null) {
    return null;
  }
  const video = await firstVideo(uniqueQueries(input.queries, input.subject), {
    minDurationSec: 2,
    excludeKeys: input.usedVideoKeys,
  });
  if (!video) {
    return null;
  }
  input.usedVideoKeys.add(stockAssetKeyOf(video));
  return padSplitOverlay(
    toOverlay(
      {
        timestamp: start,
        searchKeyword: input.queries[0] ?? 'woman walking airport',
        media: 'video',
        layout: 'split',
        anchor: 'top',
        overlayText: '',
        textStyle: 'outline',
        accentColor: '#FFFFFF',
      },
      video,
      start,
      start + SPLIT_MIN_STILL_SEC,
      'video',
      'split',
      pickSpeakerSide(input.queries[0] ?? 'split', input.existingOverlays.length),
    ),
    output,
    video.durationSec,
  );
}

function phraseCardsFromTranscript(
  transcript: string,
  timeline: Timeline,
  clips: BRollClip[],
  overlays: VisualOverlay[],
  words: WordToken[],
): VisualOverlay[] {
  const phrases = keyPhrasesFromTranscript(transcript, 2);
  if (phrases.length === 0) {
    return [];
  }
  const extras: VisualOverlay[] = [];
  for (const [index, phrase] of phrases.entries()) {
    const spoken = firstPhraseWindow(words, phrase, {
      start: HOOK_GUARD_SEC,
      end: HOOK_GUARD_SEC + 2.4,
    });
    const start = spoken.start;
    const end = Math.min(timeline.outputDurationSec - 0.4, spoken.end);
    if (end - start < 1.1) {
      continue;
    }
    const overlaps = [...clips, ...overlays, ...extras].some(
      item => start < item.end + 0.3 && end > item.start - 0.3,
    );
    if (overlaps) {
      continue;
    }
    extras.push(
      textOverlay(
        {
          timestamp: start,
          searchKeyword: 'phrase',
          media: 'text',
          layout: 'lockup',
          anchor: index % 2 === 0 ? 'top_left' : 'top_right',
          overlayText: phrase,
          textStyle: 'stack',
          accentColor: '#F7F1E1',
        },
        start,
        end,
      ),
    );
    if (extras.length >= 2) {
      break;
    }
  }
  return extras;
}

function remapMotionGraphics(
  graphics: MotionGraphic[],
  timeline: Timeline,
  alreadyOutput = false,
): MotionGraphic[] {
  return graphics
    .map(graphic => {
      const start = alreadyOutput
        ? clamp(graphic.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(graphic.start);
      const end = alreadyOutput
        ? clamp(graphic.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(graphic.end);
      if (end - start < 1.8 || start < 0.55) {
        return null;
      }
      return {
        ...graphic,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 2.2, end))),
      };
    })
    .filter((graphic): graphic is MotionGraphic => graphic != null)
    .slice(0, 6);
}

function remapMediaContainers(
  containers: MediaContainerMoment[],
  timeline: Timeline,
  alreadyOutput = false,
): MediaContainerMoment[] {
  return containers
    .map(container => {
      const start = alreadyOutput
        ? clamp(container.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(container.start);
      const end = alreadyOutput
        ? clamp(container.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(container.end);
      if (end - start < 2.4 || start < HOOK_GUARD_SEC) {
        return null;
      }
      return {
        ...container,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 2.4, end))),
      };
    })
    .filter((container): container is MediaContainerMoment => container != null)
    .slice(0, 3);
}

function remapFrameInsets(
  insets: FrameInset[],
  timeline: Timeline,
  alreadyOutput = false,
): FrameInset[] {
  return insets
    .map(inset => {
      const start = alreadyOutput
        ? clamp(inset.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(inset.start);
      const end = alreadyOutput
        ? clamp(inset.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(inset.end);
      if (end - start < 3.2 || start < HOOK_GUARD_SEC) {
        return null;
      }
      return {
        ...inset,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 3.8, end))),
        scale: Math.min(0.94, Math.max(0.7, inset.scale || 0.86)),
        marginColor: inset.marginColor || '#000000',
      };
    })
    .filter((inset): inset is FrameInset => inset != null)
    .slice(0, 2);
}

function remapSemanticEmphasis(
  emphasis: SemanticEmphasis[],
  timeline: Timeline,
  alreadyOutput = false,
): SemanticEmphasis[] {
  return emphasis
    .map(item => {
      const start = alreadyOutput
        ? clamp(item.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(item.start);
      const end = alreadyOutput
        ? clamp(item.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(item.end);
      if (end - start < 0.9 || start < 0.55) {
        return null;
      }
      const minHold = item.treatment === 'count' ? 2.1 : 1.2;
      return {
        ...item,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + minHold, end))),
      };
    })
    .filter((item): item is SemanticEmphasis => item != null)
    .slice(0, 5);
}
