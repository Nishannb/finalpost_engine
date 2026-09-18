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
import {copyLocalFile, downloadToFile, isLocalMediaPath, withWorkspace} from '../lib/tempFiles.ts';
import {extractSpeechAudio, probeMedia, sampleFramePalette} from '../media/ffmpeg.ts';
import {planBRoll} from '../stages/broll/brollPlanner.ts';
import {romanizeCaptionWords} from '../stages/broll/romanizeCaptions.ts';
import {describeUserBrollAssets} from '../stages/broll/userBrollDescribe.ts';
import {normalizeLutId} from '../stages/color/luts.ts';
import {autoTrimSilence} from '../stages/filters/autoTrim.ts';
import {buildCaptionWords, resolveDirectedZooms, splitSentences} from '../stages/filters/autoZoom.ts';
import {buildTimeline, round} from '../stages/filters/timeline.ts';
import {transcribeAudio} from '../stages/transcribe/groqTranscribe.ts';
import {uploadSourceVideo} from '../storage/r2.ts';
import type {
  AnalysisStage,
  LanguageCode,
  TimelineBlueprint,
} from '../types/blueprint.ts';
import {coerceVideoTemplateRecipe} from '../types/templateRecipe.ts';

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
  /** Creator-uploaded B-roll URLs for the director to place. */
  userBrollUrls?: string[];
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
    const probe = await probeMedia(sourcePath);
    timings.probe = Date.now() - mark;

    if (probe.durationSec > env.MAX_SOURCE_DURATION_SEC) {
      throw new EngineError(
        'source_too_long',
        `Video is ${Math.round(probe.durationSec)}s; the limit is ` +
          `${env.MAX_SOURCE_DURATION_SEC}s`,
        {durationSec: round(probe.durationSec)},
      );
    }
    if (!probe.hasAudio) {
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
      durationSec: probe.durationSec,
    });
    timings.transcribe = Date.now() - mark;

    const recipe = input.styleRecipe
      ? coerceVideoTemplateRecipe(input.styleRecipe)
      : null;

    // --- Stage B ------------------------------------------------------------
    stage('filtering', 0.7);
    mark = Date.now();
    const trim =
      recipe && recipe.trimSilence === false
        ? {
            keepSegments: [
              {
                sourceStart: 0,
                sourceEnd: probe.durationSec,
                outputStart: 0,
              },
            ],
            trimExclusions: [] as Array<{start: number; end: number}>,
            removedSec: 0,
            skipped: 'template_trim_disabled' as const,
          }
        : autoTrimSilence(transcription.words, {
            thresholdSec: env.SILENCE_THRESHOLD_SEC,
            paddingSec: env.SILENCE_PADDING_SEC,
            sourceDurationSec: probe.durationSec,
            removeFillers: true,
          });
    if (trim.skipped) {
      warnings.push(`silence_trim_skipped:${trim.skipped}`);
    }
    const timeline = buildTimeline(trim.keepSegments);
    const captionWordsRaw = buildCaptionWords(transcription.words, timeline);
    const captionWords = await romanizeCaptionWords({
      captionWords: captionWordsRaw,
      words: transcription.words,
      transcript: transcription.transcript,
      detectedLanguage: transcription.detectedLanguage,
      languageCode: input.languageCode,
    });
    const sentences = splitSentences(transcription.words);
    timings.filters = Date.now() - mark;

    // --- Stage C ------------------------------------------------------------
    stage('sourcing_broll', 0.8);
    mark = Date.now();
    const palette = await sampleFramePalette(
      sourcePath,
      workspace.file('swatch.rgb'),
      probe.durationSec,
    );
    const userBrollAssets = await describeUserBrollAssets(
      input.userBrollUrls ?? [],
      workspace,
    );
    if ((input.userBrollUrls?.length ?? 0) > 0 && userBrollAssets.length === 0) {
      warnings.push('user_broll_describe_failed');
    }
    const broll = await planBRoll({
      transcript: transcription.transcript,
      sourceDurationSec: probe.durationSec,
      timeline,
      palette,
      words: transcription.words,
      userBrollAssets,
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
      // Density 0 → empty, 1 → keep all planned beats.
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

    const zoomTriggers = resolveDirectedZooms({
      directed: broll.zooms,
      words: transcription.words,
      timeline,
      scale: env.ZOOM_SCALE,
      maxDurationSec: Math.min(2.2, env.ZOOM_MAX_DURATION_SEC),
      blockedRanges: [
        ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
        ...broll.overlays
          .filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite')
          .map(overlay => ({start: overlay.start, end: overlay.end})),
      ],
    });

    // --- Stage D ------------------------------------------------------------
    const resolvedLanguage = resolveLanguageCode(
      input.languageCode,
      transcription.detectedLanguage,
    );
    const blueprint: TimelineBlueprint = {
      blueprintId: `bp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      createdAt: new Date().toISOString(),
      videoUrl: publicVideoUrl,
      languageCode: resolvedLanguage,
      detectedLanguage: transcription.detectedLanguage,
      fps: OUTPUT_FPS,
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      sourceDurationSec: round(probe.durationSec),
      outputDurationSec: round(timeline.outputDurationSec),
      words: transcription.words.map(word => ({
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
      hookTitle: broll.hookTitle,
      hookSubtitle: '',
      hookDurationSec: broll.hookDurationSec,
      hookStyle: broll.hookStyle,
      visualOverlays: broll.overlays,
      transitions: broll.transitions,
      motionGraphics: broll.motionGraphics ?? [],
      mediaContainers: broll.mediaContainers ?? [],
      semanticEmphasis: broll.semanticEmphasis ?? [],
      captionDirection: broll.caption,
      colorGradeLut:
        normalizeLutId(input.colorGradeLut) ||
        normalizeLutId(broll.preferredLutId) ||
        (recipe ? normalizeLutId(recipe.preferredLutId) : '') ||
        '',
      suggestedLutIds: broll.suggestedLutIds ?? [],
      preferredLutId: normalizeLutId(broll.preferredLutId) || '',
      stats: {
        wordCount: transcription.words.length,
        sentenceCount: sentences.length,
        silenceCutCount: trim.trimExclusions.length,
        silenceRemovedSec: trim.removedSec,
        zoomTriggerCount: zoomTriggers.length,
        brollClipCount: broll.clips.length,
        visualOverlayCount: broll.overlays.length,
        splitCount: broll.overlays.filter(overlay => overlay.layout === 'split').length,
        transitionCount: broll.transitions.length,
        motionGraphicCount: (broll.motionGraphics ?? []).length,
        mediaContainerCount: (broll.mediaContainers ?? []).length,
        semanticEmphasisCount: (broll.semanticEmphasis ?? []).length,
        hasHookTitle: Boolean(broll.hookTitle),
        timings: {...timings, total: Date.now() - startedAll},
        estimatedCostUsd: round(
          transcription.estimatedCostUsd + broll.estimatedCostUsd,
          5,
        ),
        warnings,
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
      broll: blueprint.brollClips.length,
      overlays: blueprint.visualOverlays.length,
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
