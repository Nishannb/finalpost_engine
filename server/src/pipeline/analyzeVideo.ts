/**
 * Stages A→D — produce a Timeline Blueprint and stop.
 *
 * Deliberately halting before any render is what makes the economics work: the
 * expensive AI work happens once per source video, and every style change the
 * user makes afterwards is a free client-side re-draw of this same payload.
 */

import {randomUUID} from 'node:crypto';

import {
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  env,
} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {remapWords} from '../lib/timeRemap.ts';
import {copyLocalFile, downloadToFile, isLocalMediaPath, withWorkspace} from '../lib/tempFiles.ts';
import {extractSpeakerCutout, extractSpeechAudio, probeMedia, sampleFramePalette} from '../media/ffmpeg.ts';
import {analyzeDeliveryAcoustics} from '../stages/audio/deliveryAcoustics.ts';
import {
  directDeliveryShaping,
  planDeliveryShaping,
} from '../stages/audio/deliveryPlanner.ts';
import {renderDeliveryShaping} from '../stages/audio/deliveryRenderer.ts';
import {planBRoll, captionsOnlyVisualPlan} from '../stages/broll/brollPlanner.ts';
import {romanizeCaptionWords} from '../stages/broll/romanizeCaptions.ts';
import {describeUserBrollAssets} from '../stages/broll/userBrollDescribe.ts';
import {contrastCaptionWithFootage} from '../stages/broll/captionContrast.ts';
import {shineCaptionDirection} from '../stages/broll/geminiDirector.ts';
import {critiqueAndPatchLayout} from '../stages/layout/layoutCritique.ts';
import {measureOccupancy, occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {detectSpeakerCutout, type SpeakerCutout} from '../stages/layout/speakerCutout.ts';
import {composeBeautifulLayout} from '../stages/layout/slotCompositor.ts';
import {normalizeLutId} from '../stages/color/luts.ts';
import {autoTrimSilence} from '../stages/filters/autoTrim.ts';
import {buildCaptionWords, resolveDirectedZooms, splitSentences} from '../stages/filters/autoZoom.ts';
import {buildTimeline, round} from '../stages/filters/timeline.ts';
import {transcribeAudio} from '../stages/transcribe/groqTranscribe.ts';
import {uploadSourceVideo} from '../storage/r2.ts';
import type {
  AnalysisStage,
  DeliveryShapingClip,
  LanguageCode,
  TimelineBlueprint,
} from '../types/blueprint.ts';
import {coerceVideoTemplateRecipe} from '../types/templateRecipe.ts';
import {
  captionGuideToDirection,
  coerceCaptionStyleGuide,
} from '../types/captionStyleGuide.ts';
import {lockCaptionTemplate, defaultRequestedEdits, visualToolkitsRequested} from '../lib/editToolkits.ts';

const log = stageLogger('pipeline');

/** Source ceiling: 5 minutes at bitrates phones produce, with headroom. */
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;

export type AnalyzeInput = {
  videoUrl: string;
  languageCode: LanguageCode;
  userId: string;
  /** Optional .cube LUT id from ai-video-engine/luts. */
  colorGradeLut?: string;
  /** Optional Kinmel template recipe to bias the director / grades. */
  styleRecipe?: Record<string, unknown>;
  /** Learned caption look from the creator's profile reference video. */
  captionStyleGuide?: Record<string, unknown> | null;
  /** Creator-uploaded B-roll URLs for the director to place. */
  userBrollUrls?: string[];
  /** Force speaker-over-B-roll regardless of director choice. */
  forceSpeakerCutout?: boolean;
  /** Free multi-stage director (perception + story + creative + compiler). */
  directorV2?: boolean;
  /** Opt-in north-star compositor (implies Director v2). */
  northStar?: boolean;
  /** Allowlist of edit toolkits. `undefined` = lean default. `null` = every toolkit. */
  requestedEdits?: string[] | null;
  /**
   * Terminal `--delivery-shaping` / `--no-delivery-shaping`.
   * true = run even if --edits omitted (and skip the monotony gate).
   * false = never run, even when DELIVERY_SHAPING_AUTO is on.
   * omit = follow the --edits allowlist and auto flag.
   */
  forceDeliveryShaping?: boolean;
  /** Optional caption template the Director should honor. */
  captionTemplate?: import('../types/blueprint.ts').CaptionTemplateId | null;
  noRepair?: boolean;
};

/** Coarse stage reporting so the app can show real progress, not a spinner. */
export type AnalyzeHooks = {
  onStage?: (stage: AnalysisStage, progress: number) => void;
};

export async function analyzeVideo(
  input: AnalyzeInput,
  hooks: AnalyzeHooks = {},
): Promise<TimelineBlueprint> {
  const stage = (name: AnalysisStage, progress: number) =>
    hooks.onStage?.(name, progress);
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const startedAll = Date.now();
  const requestedEdits = defaultRequestedEdits(input.requestedEdits, env.PIPELINE_MODE);
  const visualEditsOn = visualToolkitsRequested(requestedEdits);

  return withWorkspace('analyze', async workspace => {
    // --- Ingest -------------------------------------------------------------
    stage('downloading', 0.05);
    let mark = Date.now();
    const local = isLocalMediaPath(input.videoUrl);
    const extension = local
      ? input.videoUrl.toLowerCase().includes('.mov')
        ? '.mov'
        : '.mp4'
      : '.mp4';
    const sourcePath = workspace.file(`source${extension}`);
    const download = local
      ? await copyLocalFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES})
      : await downloadToFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES});
    // Remotion only fetches http(s). A laptop path is copied for ASR, then
    // uploaded so the burn and the phone share the same public URL.
    let publicVideoUrl = input.videoUrl;
    if (local) {
      const uploaded = await uploadSourceVideo(sourcePath, extension);
      publicVideoUrl = uploaded.publicUrl;
    }
    timings.download = Date.now() - mark;

    mark = Date.now();
    const originalProbe = await probeMedia(sourcePath);
    timings.probe = Date.now() - mark;

    if (originalProbe.durationSec > env.MAX_SOURCE_DURATION_SEC) {
      throw new EngineError(
        'source_too_long',
        `Video is ${Math.round(originalProbe.durationSec)}s; the limit is ` +
          `${env.MAX_SOURCE_DURATION_SEC}s`,
        {durationSec: round(originalProbe.durationSec)},
      );
    }
    if (!originalProbe.hasAudio) {
      throw new EngineError('no_speech_detected', 'This video has no audio track');
    }

    // --- Stage A ------------------------------------------------------------
    stage('transcribing', 0.25);
    mark = Date.now();
    const audio = await extractSpeechAudio(sourcePath, workspace.file('speech.ogg'));
    timings.audioExtract = Date.now() - mark;

    mark = Date.now();
    const transcription = await transcribeAudio({
      audioPath: audio.path,
      audioBytes: audio.bytes,
      languageCode: input.languageCode,
      durationSec: originalProbe.durationSec,
    });
    timings.transcribe = Date.now() - mark;

    const recipe = input.styleRecipe
      ? coerceVideoTemplateRecipe(input.styleRecipe)
      : null;
    const captionGuide = coerceCaptionStyleGuide(input.captionStyleGuide);
    const northStar = Boolean(input.northStar || env.NORTH_STAR);
    const directorV2 = Boolean(input.directorV2 || env.DIRECTOR_V2 || northStar);

    // --- Stage B ------------------------------------------------------------
    stage('filtering', 0.7);
    mark = Date.now();
    const sourceSentences = splitSentences(transcription.words);
    const deliveryDenied = input.forceDeliveryShaping === false;
    const deliveryAllowed =
      !deliveryDenied &&
      (input.forceDeliveryShaping === true ||
        requestedEdits == null ||
        requestedEdits.includes('delivery_shaping'));
    const deliveryExplicit = Boolean(
      input.forceDeliveryShaping === true ||
        requestedEdits?.includes('delivery_shaping'),
    );
    if (deliveryDenied) {
      warnings.push('delivery_shaping_skipped:disabled');
    } else if (!deliveryAllowed && requestedEdits != null) {
      warnings.push('delivery_shaping_skipped:not_in_allowlist');
    }
    let deliveryShaping: DeliveryShapingClip | undefined;
    let activeSourcePath = sourcePath;
    let activePublicVideoUrl = publicVideoUrl;
    let activeWords = transcription.words;
    let activeDurationSec = originalProbe.durationSec;

    if (deliveryAllowed && (deliveryExplicit || env.DELIVERY_SHAPING_AUTO)) {
      try {
        const acoustic = await analyzeDeliveryAcoustics({
          sourcePath,
          sentences: sourceSentences,
          words: transcription.words,
        });
        const meanMonotony =
          acoustic.sentences.length > 0
            ? acoustic.sentences.reduce(
                (sum, item) => sum + item.monotonyScore,
                0,
              ) / acoustic.sentences.length
            : 0;
        if (deliveryExplicit || meanMonotony >= 0.62) {
          const direction = directorV2
            ? await directDeliveryShaping({
                words: transcription.words,
                acoustic: acoustic.sentences,
                durationSec: originalProbe.durationSec,
                musicPresent: false,
                loudness: acoustic.loudness,
              })
            : undefined;
          const delivery = await planDeliveryShaping({
            words: transcription.words,
            sentences: sourceSentences,
            acoustic: acoustic.sentences,
            sourceDurationSec: originalProbe.durationSec,
            intensity: direction?.intensity,
            preset: direction?.preset,
            explicitOps: direction?.ops,
            useLlmEmphasis:
              env.DELIVERY_LLM_EMPHASIS &&
              (direction ? direction.useLlmEmphasis : true),
          });
          if (delivery.ops.length > 0) {
            const shapedPath = workspace.file('delivery-shaped.mp4');
            const rendered = await renderDeliveryShaping({
              sourcePath,
              outputPath: shapedPath,
              map: delivery.timeRemap,
              ops: delivery.ops,
              preset: delivery.preset,
              fps: OUTPUT_FPS,
            });
            const uploaded = await uploadSourceVideo(shapedPath, '.mp4');
            activeSourcePath = shapedPath;
            activePublicVideoUrl = uploaded.publicUrl;
            activeWords = remapWords(transcription.words, delivery.timeRemap);
            activeDurationSec = delivery.timeRemap.outputDurationSec;
            deliveryShaping = {
              type: 'delivery_shaping',
              start: 0,
              end: activeDurationSec,
              intensity: delivery.intensity,
              preset: delivery.preset,
              useLlmEmphasis:
                env.DELIVERY_LLM_EMPHASIS &&
                (direction ? direction.useLlmEmphasis : true),
              ops: delivery.ops,
              timeRemap: delivery.timeRemap,
              acoustic: acoustic.sentences,
              loudnessBefore: acoustic.loudness,
              loudnessAfter: rendered.loudnessAfter,
              summary: delivery.summary,
              reason: direction?.reason ?? delivery.reason,
            };
            warnings.push(...delivery.drops);
          }
        } else {
          warnings.push(
            `delivery_shaping_skipped:expressive:${meanMonotony.toFixed(2)}`,
          );
        }
      } catch (error) {
        log.warn({error}, 'delivery shaping failed; continuing with original timing');
        warnings.push('delivery_shaping_failed');
      }
    }

    const captionsOnly = !visualEditsOn;
    const trim =
      deliveryShaping || captionsOnly || (recipe && recipe.trimSilence === false)
        ? {
            keepSegments: [
              {
                sourceStart: 0,
                sourceEnd: activeDurationSec,
                outputStart: 0,
              },
            ],
            trimExclusions: [] as Array<{start: number; end: number}>,
            removedSec: 0,
            skipped: captionsOnly
              ? ('captions_only' as const)
              : ('template_trim_disabled' as const),
          }
        : autoTrimSilence(activeWords, {
            thresholdSec: env.SILENCE_THRESHOLD_SEC,
            paddingSec: env.SILENCE_PADDING_SEC,
            sourceDurationSec: activeDurationSec,
            removeFillers: true,
          });
    if (trim.skipped) {
      warnings.push(`silence_trim_skipped:${trim.skipped}`);
    }
    const timeline = buildTimeline(trim.keepSegments);
    const captionWordsRaw = buildCaptionWords(activeWords, timeline);
    const captionWords = await romanizeCaptionWords({
      captionWords: captionWordsRaw,
      words: activeWords,
      transcript: transcription.transcript,
      detectedLanguage: transcription.detectedLanguage,
      languageCode: input.languageCode,
    });
    const sentences = splitSentences(activeWords);
    timings.filters = Date.now() - mark;

    // --- Stage C ------------------------------------------------------------
    stage('sourcing_broll', 0.8);
    mark = Date.now();
    const palette = await sampleFramePalette(
      activeSourcePath,
      workspace.file('swatch.rgb'),
      activeDurationSec,
    );
    const occupancyStill = workspace.file('occupancy.jpg');
    const forceSpeakerCutout = Boolean(input.forceSpeakerCutout || env.FORCE_SPEAKER_CUTOUT);
    let occupancy = occupancyFromSpeaker(
      {x: 0.18, y: 0.16, w: 0.64, h: 0.62},
      'fallback',
    );
    let broll = captionsOnlyVisualPlan(shineCaptionDirection());
    let zoomTriggers: ReturnType<typeof resolveDirectedZooms> = [];
    let resolvedCutout: SpeakerCutout = {
      available: false,
      keyColor: '#000000',
      similarity: 0.12,
      blend: 0.06,
      speaker: occupancy.speaker,
    };
    let layoutHookAnchor = occupancy.overlayAnchor;
    let layoutCostUsd = 0;

    if (captionsOnly) {
      let caption = shineCaptionDirection();
      if (captionGuide) {
        caption = {
          ...caption,
          ...captionGuideToDirection(captionGuide),
          template: 'karaoke',
          animation: 'highlight',
        };
      }
      caption = contrastCaptionWithFootage(caption, palette);
      caption = lockCaptionTemplate(caption, input.captionTemplate ?? 'karaoke');
      caption = {
        ...caption,
        animation: 'highlight',
        template: caption.template || 'karaoke',
      };
      broll = captionsOnlyVisualPlan(caption);
      timings.broll = Date.now() - mark;
      timings.occupancy = 0;
      timings.layout = 0;
      warnings.push(...broll.warnings);
    } else {
      const userBrollAssets = await describeUserBrollAssets(
        input.userBrollUrls ?? [],
        workspace,
      );
      if ((input.userBrollUrls?.length ?? 0) > 0 && userBrollAssets.length === 0) {
        warnings.push('user_broll_describe_failed');
      }
      occupancy = await measureOccupancy({
        sourcePath: activeSourcePath,
        durationSec: activeDurationSec,
        stillPath: occupancyStill,
      });
      timings.occupancy = Date.now() - mark;
      const speakerCutout = {
        ...(await detectSpeakerCutout(occupancyStill)),
        speaker: occupancy.speaker,
      };
      broll = await planBRoll({
        transcript: transcription.transcript,
        sourceDurationSec: activeDurationSec,
        timeline,
        palette,
        words: activeWords,
        captionWords,
        userBrollAssets,
        occupancy,
        speakerCutout,
        captionStyleGuide: captionGuide,
        forceSpeakerCutout,
        directorV2,
        northStar,
        sourcePath: activeSourcePath,
        workspace,
        requestedEdits,
        captionTemplate: input.captionTemplate ?? null,
        noRepair: input.noRepair,
      });
      timings.broll = Date.now() - mark;
      warnings.push(...broll.warnings);

      if (recipe) {
        broll.caption = {
          ...broll.caption,
          template: recipe.captionTemplate,
        };
        broll.hookStyle = recipe.hookStyle;
        broll.suggestedLutIds =
          recipe.suggestedLutIds.length > 0
            ? recipe.suggestedLutIds
            : broll.suggestedLutIds;
        broll.preferredLutId =
          recipe.preferredLutId || broll.preferredLutId || '';
        const keepN = <T,>(items: T[], density: number): T[] => {
          if (items.length === 0) {
            return items;
          }
          const n = Math.max(
            0,
            Math.min(items.length, Math.round(items.length * density)),
          );
          return n <= 0 ? [] : items.slice(0, n);
        };
        broll.clips = keepN(broll.clips, recipe.brollDensity);
        broll.overlays = keepN(broll.overlays, recipe.brollDensity);
        broll.zooms = keepN(broll.zooms, recipe.zoomDensity);
        if (recipe.directorNotes) {
          warnings.push(`template_notes:${recipe.directorNotes.slice(0, 120)}`);
        }
      }

      mark = Date.now();
      const directedCaption = captionGuide && !northStar
        ? {
            ...broll.caption,
            ...captionGuideToDirection(captionGuide),
          }
        : broll.caption;
      const composed = northStar
        ? {
            hookStyle: broll.hookStyle,
            hookAnchor: broll.northStarHookAnchor ?? occupancy.overlayAnchor,
            caption: directedCaption,
            motionGraphics: broll.motionGraphics ?? [],
            overlays: broll.overlays,
            mediaContainers: broll.mediaContainers ?? [],
            semanticEmphasis: broll.semanticEmphasis ?? [],
          }
        : composeBeautifulLayout({
            occupancy,
            hookStyle: broll.hookStyle,
            caption: directedCaption,
            motionGraphics: broll.motionGraphics ?? [],
            overlays: broll.overlays,
            mediaContainers: broll.mediaContainers ?? [],
            semanticEmphasis: broll.semanticEmphasis ?? [],
          });
      const patched = await critiqueAndPatchLayout({
        stillPath: occupancyStill,
        occupancy,
        plan: {
          hookAnchor: composed.hookAnchor,
          hookDurationSec: broll.hookDurationSec,
          caption: composed.caption,
          motionGraphics: composed.motionGraphics,
          overlays: composed.overlays,
          mediaContainers: composed.mediaContainers,
          semanticEmphasis: composed.semanticEmphasis,
        },
      });
      broll.hookStyle = composed.hookStyle;
      broll.caption = lockCaptionTemplate(
        patched.plan.caption,
        input.captionTemplate,
      );
      broll.motionGraphics = patched.plan.motionGraphics;
      broll.overlays = patched.plan.overlays;
      broll.mediaContainers = patched.plan.mediaContainers;
      broll.semanticEmphasis = patched.plan.semanticEmphasis;
      layoutHookAnchor = patched.plan.hookAnchor;
      layoutCostUsd = patched.estimatedCostUsd;
      timings.layout = Date.now() - mark;
      warnings.push(`occupancy_${occupancy.source}`);
      warnings.push(`layout_patch:${patched.source}`);
      if (patched.issues.length > 0) {
        warnings.push(
          `layout_issues:${patched.issues.map(issue => issue.kind).join(',')}`,
        );
      }

      zoomTriggers = resolveDirectedZooms({
        directed: broll.zooms,
        words: activeWords,
        timeline,
        scale: env.ZOOM_SCALE,
        maxDurationSec: Math.min(3.2, Math.max(2.6, env.ZOOM_MAX_DURATION_SEC)),
        blockedRanges: [
          ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
          ...broll.overlays
            .filter(
              overlay =>
                overlay.layout === 'split' ||
                overlay.layout === 'composite' ||
                overlay.layout === 'cutout',
            )
            .map(overlay => ({start: overlay.start, end: overlay.end})),
          ...(broll.depthOverlays ?? []).map(clip => ({
            start: clip.start,
            end: clip.end,
          })),
          ...(broll.insetReveals ?? []).map(clip => ({
            start: clip.start,
            end: clip.end,
          })),
        ],
      });

      resolvedCutout = speakerCutout;
      const usesCutout =
        forceSpeakerCutout ||
        broll.overlays.some(overlay => overlay.layout === 'cutout');
      if (usesCutout && (speakerCutout.available || forceSpeakerCutout)) {
        try {
          const cutPath = workspace.file('speaker-cutout.webm');
          await extractSpeakerCutout({
            inputPath: activeSourcePath,
            outputPath: cutPath,
            keyColor: speakerCutout.keyColor,
            similarity: speakerCutout.similarity,
            blend: speakerCutout.blend,
          });
          const uploaded = await uploadSourceVideo(cutPath, '.webm');
          resolvedCutout = {...speakerCutout, videoUrl: uploaded.publicUrl};
          warnings.push('speaker_cutout_keyed');
        } catch (error) {
          warnings.push('speaker_cutout_extract_failed');
          log.warn({error}, 'speaker cutout extract failed; using occupancy crop');
        }
      } else if (usesCutout) {
        warnings.push('speaker_cutout_crop');
      }
    }

    // --- Stage D ------------------------------------------------------------
    const resolvedLanguage = resolveLanguageCode(
      input.languageCode,
      transcription.detectedLanguage,
    );

    const blueprint: TimelineBlueprint = {
      schemaVersion: directorV2 || northStar ? 2 : 1,
      blueprintId: `bp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      createdAt: new Date().toISOString(),
      videoUrl: activePublicVideoUrl,
      originalVideoUrl: deliveryShaping ? publicVideoUrl : undefined,
      languageCode: resolvedLanguage,
      detectedLanguage: transcription.detectedLanguage,
      fps: OUTPUT_FPS,
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      sourceDurationSec: round(activeDurationSec),
      outputDurationSec: round(timeline.outputDurationSec),
      words: activeWords.map(word => ({
        text: word.text,
        start: round(word.start),
        end: round(word.end),
      })),
      captionWords,
      transcript: transcription.transcript,
      trimExclusions: trim.trimExclusions,
      keepSegments: timeline.keepSegments,
      zoomTriggers,
      brollClips: broll.clips,
      depthOverlays: resolvedCutout.videoUrl
        ? broll.depthOverlays ?? []
        : [],
      insetReveals: broll.insetReveals ?? [],
      deliveryShaping,
      hookTitle: broll.hookTitle,
      hookSubtitle: '',
      hookDurationSec: broll.hookDurationSec,
      hookStartSec: broll.hookStartSec ?? 0,
      hookStyle: broll.hookStyle,
      hookAnchor:
        northStar && broll.northStarHookAnchor
          ? broll.northStarHookAnchor
          : layoutHookAnchor,
      visualOverlays: broll.overlays,
      transitions: broll.transitions,
      motionGraphics: broll.motionGraphics ?? [],
      mediaContainers: broll.mediaContainers ?? [],
      frameInsets: broll.frameInsets ?? [],
      semanticEmphasis: broll.semanticEmphasis ?? [],
      speakerCutout: resolvedCutout,
      captionDirection: broll.caption,
      audioDesign: broll.audioDesign,
      northStarDesign: broll.northStarDesign,
      colorGradeLut: normalizeLutId(input.colorGradeLut) || '',
      suggestedLutIds: broll.suggestedLutIds ?? [],
      preferredLutId: normalizeLutId(broll.preferredLutId) || '',
      editThesis: broll.editThesis,
      cta: broll.cta,
      directorReport: broll.directorReport,
      assembler: broll.assembler,
      tracks: [
        ...(deliveryShaping
          ? [
              {
                id: 'delivery_shaping',
                kind: 'delivery_shaping' as const,
                zIndex: 0,
                elements: deliveryShaping.ops as unknown as Array<
                  Record<string, unknown>
                >,
              },
            ]
          : []),
        {
          id: 'overlay',
          kind: 'overlay',
          zIndex: 20,
          elements: broll.overlays as unknown as Array<Record<string, unknown>>,
        },
        {
          id: 'broll',
          kind: 'broll',
          zIndex: 10,
          elements: broll.clips as unknown as Array<Record<string, unknown>>,
        },
        {
          id: 'depth_overlay',
          kind: 'depth_overlay',
          zIndex: 12,
          elements: (broll.depthOverlays ?? []) as unknown as Array<
            Record<string, unknown>
          >,
        },
        {
          id: 'inset_reveal',
          kind: 'inset_reveal',
          zIndex: 11,
          elements: (broll.insetReveals ?? []) as unknown as Array<
            Record<string, unknown>
          >,
        },
      ],
      stats: {
        wordCount: activeWords.length,
        sentenceCount: sentences.length,
        silenceCutCount: trim.trimExclusions.length,
        silenceRemovedSec: trim.removedSec,
        zoomTriggerCount: zoomTriggers.length,
        brollClipCount: broll.clips.length,
        depthOverlayCount: (broll.depthOverlays ?? []).length,
        insetRevealCount: (broll.insetReveals ?? []).length,
        deliveryOperationCount: deliveryShaping?.ops.length ?? 0,
        visualOverlayCount: broll.overlays.length,
        splitCount: broll.overlays.filter(overlay => overlay.layout === 'split').length,
        transitionCount: broll.transitions.length,
        motionGraphicCount: (broll.motionGraphics ?? []).length,
        mediaContainerCount: (broll.mediaContainers ?? []).length,
        frameInsetCount: (broll.frameInsets ?? []).length,
        semanticEmphasisCount: (broll.semanticEmphasis ?? []).length,
        hasHookTitle: Boolean(broll.hookTitle),
        timings: {...timings, total: Date.now() - startedAll},
        estimatedCostUsd: round(
          transcription.estimatedCostUsd +
            broll.estimatedCostUsd +
            layoutCostUsd,
          5,
        ),
        warnings,
        perStageCostUsd: broll.directorReport?.perStageCostUsd,
        perStageLatencyMs: broll.directorReport?.perStageLatencyMs,
      },
    };

    log.info(
      {
        blueprintId: blueprint.blueprintId,
        userId: input.userId,
        sourceBytes: download.bytes,
      sourceSec: blueprint.sourceDurationSec,
      outputSec: blueprint.outputDurationSec,
      removedSec: trim.removedSec,
      hook: blueprint.hookTitle,
      hookStyle: blueprint.hookStyle,
      hookAnchor: blueprint.hookAnchor,
      occupancy: occupancy.source,
      broll: blueprint.brollClips.length,
      overlays: blueprint.visualOverlays.length,
      insetReveals: (blueprint.insetReveals ?? []).length,
      motionGraphics: blueprint.motionGraphics.length,
      mediaContainers: blueprint.mediaContainers.length,
      splits: blueprint.stats.splitCount,
      transitions: blueprint.stats.transitionCount,
      costUsd: blueprint.stats.estimatedCostUsd,
        timings: blueprint.stats.timings,
      },
      'blueprint ready',
    );

    return blueprint;
  });
}

function resolveLanguageCode(
  requested: LanguageCode,
  detected: string,
): Exclude<LanguageCode, 'auto'> {
  if (requested !== 'auto') {
    return requested;
  }
  const lang = detected.toLowerCase();
  if (lang.startsWith('hi') || lang.includes('hindi')) {
    return 'hi';
  }
  if (lang.startsWith('ne') || lang.includes('nepali')) {
    return 'ne';
  }
  if (lang.startsWith('ta') || lang.includes('tamil')) {
    return 'ta';
  }
  if (lang.startsWith('es') || lang.includes('spanish')) {
    return 'es';
  }
  return 'en';
}
