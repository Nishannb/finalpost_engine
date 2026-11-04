/**
 * Stages A→D — produce a Timeline Blueprint and stop.
 *
 * Deliberately halting before any render is what makes the economics work: the
 * expensive AI work happens once per source video, and every style change the
 * user makes afterwards is a free client-side re-draw of this same payload.
 */

import {createHash, randomUUID} from 'node:crypto';

import {
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  env,
} from '../config/env.ts';
import {captionMuteRanges, mergeMuteRanges, type MuteRange} from '../lib/captionMute.ts';
import {densityTransitionClip, ensurePolishTransitionDensity, sentenceStartsOf} from '../stages/broll/transitionDensity.ts';
import {schedulePolishSfxHits} from '../lib/polishSfx.ts';
import {applyCatalogToHits, loadSfxCatalog, sfxVoiceOffsetLu} from '../lib/sfxCatalog.ts';
import {buildDuckEnvelope} from '../stages/music/duckEnvelope.ts';
import {saveBlueprintForReplay} from '../stages/music/saveBlueprint.ts';
import {resolveBedSource, resolveDuckPreset} from '../stages/music/flags.ts';
import {resolveMusicBed} from '../stages/music/resolveMusicBed.ts';
import {agentsDir as musicAgentsDir, awaitMusicPlan} from '../stages/music/musicSpecialist.ts';
import {measureVoLufs} from '../stages/music/measureVoLufs.ts';
import {VO_LUFS_ASSUMED} from '../stages/music/duckEnvelope.ts';
import {playbackFromPlan, toAudioDesign} from '../stages/music/toAudioDesign.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar} from '../stages/broll/voCutGrammar.ts';
import {LOOK_CAPTION_TYPE, pickShortFormLookId, preferVideoEditLook} from '../lib/shortFormLook.ts';
import {polishAccumulateCaptions} from '../lib/polishAccumulateCaptions.ts';
import {impactFxIsEmpty, planImpactFx} from '../lib/polishImpactFx.ts';
import {polishBareCaption} from '../lib/polishBareCaption.ts';
import {EngineError} from '../lib/errors.ts';
import {designFieldsForBlueprint} from '../lib/designTokens.ts';
import {buildDirectorVideoPart, type DirectorVideoPart} from '../media/directorVideo.ts';
import {stageLogger} from '../lib/logger.ts';
import {remapWords} from '../lib/timeRemap.ts';
import {copyLocalFile, downloadToFile, isLocalMediaPath, resolveLocalMediaPath, withWorkspace} from '../lib/tempFiles.ts';
import {denoiseTalkingHeadAudio, extractSpeakerCutout, extractSpeechAudio, probeMedia, sampleFramePalette} from '../media/ffmpeg.ts';
import {buildDenoiseFilter, DENOISE_APPLIED_WARNING, DENOISE_FAILED_WARNING} from '../stages/audio/noiseFilter.ts';
import {analyzeDeliveryAcoustics} from '../stages/audio/deliveryAcoustics.ts';
import {prepareSpeechCuts} from '../stages/audio/speechVad.ts';
import {
  directDeliveryShaping,
  planDeliveryShaping,
} from '../stages/audio/deliveryPlanner.ts';
import {renderDeliveryShaping} from '../stages/audio/deliveryRenderer.ts';
import {planBRoll, captionsOnlyVisualPlan} from '../stages/broll/brollPlanner.ts';
import {
  applyLabeledAssetBindings,
  computeEditReadiness,
  buildLabeledAssetBrief,
  type LabeledAssetBinding,
} from '../stages/broll/labeledAssetBrief.ts';
import {clampStickyEnds, dedupeStatKinetic, dropBubbleOverlays, dropDoubleStatEmphasis, paletteRepeats, refuseOverlappingImages} from '../stages/broll/craftMutualExclusion.ts';
import {planKlipyOverlays} from '../stages/broll/klipyOverlayPlanner.ts';
import {romanizeCaptionWords} from '../stages/broll/romanizeCaptions.ts';
import {describeUserBrollAssets} from '../stages/broll/userBrollDescribe.ts';
import {fillerWarnings, planFillerClipLane} from '../stages/broll/fillerClipLane.ts';
import {preferMediaWarnings, textOnlyOpensWithMediaAvailable} from '../stages/broll/preferMedia.ts';
import {publishImageRuns} from '../stages/broll/imageRunPublish.ts';
import {runTextualMgStage} from '../stages/broll/textualMgStage.ts';
import {TEXTUAL_MG_GRAPHIC_ID_PREFIX} from '../stages/broll/textualMgPublish.ts';
import {MOTION_TEMPLATE_GRAPHIC_ID_PREFIX} from '../stages/broll/motionTemplateCatalog.ts';
import {runMotionTemplateStage} from '../stages/broll/motionTemplateStage.ts';
import {dropEmphasisCoveredByVisualBackend} from '../stages/broll/visualBackend/planVisualBackendBeats.ts';
import {runVisualBackendStage} from '../stages/broll/visualBackend/visualBackendStage.ts';
import {runCraftTemplateStage} from '../stages/broll/craftTemplateStage.ts';
import {brandNameFor, isSocialSlot} from '../stages/broll/kineticAssets.ts';
import {heroBeatsOutsideCoverage, resolveKineticSubject, type KineticForeground} from '../stages/broll/kineticSubject.ts';
import {extractSubjectMatte, subjectMatteConfigured} from '../media/personMatte.ts';
import {probeMeanAlpha} from '../media/alphaProbe.ts';
import {collectMatteNeeds, obtainPersonMatte, reconcileDirectorElements} from './personMatteStage.ts';
import {applySubjectStageExclusions, kineticInputsUnderStage, runSubjectStage} from './subjectStageStage.ts';
import type {SubjectStageBlueprint} from '../stages/subjectStage/planSubjectStage.ts';
import type {MatteCoverage} from '../stages/broll/kineticSubject.ts';
import {stat as statFile} from 'node:fs/promises';
import {formatKineticTypeForDirector} from '../stages/broll/kineticTypeCapabilities.ts';
import {LIBRARY_COMPOSITION_IDS} from '../stages/motionDirector/libraryRegistry.ts';
import {mapPolishSkillToMotionTemplateSkill} from '../stages/broll/motionTemplateCatalog.ts';
import {planStillnessFrameInsets} from '../stages/broll/stillnessFrameInsets.ts';
import {labeledAssetWarnings, mediaKindOfUrl, planLabeledAssetPlacements} from '../stages/broll/labeledAssetPlacement.ts';
import {coveredFraction, editorialRunRanges, planEditorialStillMontage} from '../stages/broll/editorialStillMontage.ts';
import {claimBeatQueries, planClaimVisuals} from '../stages/broll/explainerClaims.ts';
import type {EditPalette} from '../stages/broll/editPalette.ts';
import {directEditColors} from '../stages/broll/colorDirector.ts';
import {KINETIC_LED_CONFIG, isMatteBeat, matteBudgetSecForDevice} from '../stages/broll/kineticLedConfig.ts';
import {explainerStockResolver, placeExplainerMedia, planExplainerMount, type ExplainerMountPlan} from '../stages/broll/explainerMount.ts';
import {planNewsroomMgPacing} from '../stages/broll/newsroomMgPacing.ts';
import {planExplainerPacing, resolvePolishSkill} from '../stages/broll/explainerPacing.ts';
import {polishExplainerCaptions} from '../lib/polishExplainerCaptions.ts';
import {planFacelessDocLane} from '../stages/broll/facelessDocLane.ts';
import {resolveTalkingHeadSkillA, talkingHeadCaption, talkingHeadSkillAWarnings, talkingHeadStillOptions} from '../stages/broll/talkingHeadSkillA.ts';
import {findPhotoAsset, stockConfigured} from '../stages/broll/stockSearch.ts';
import {contrastCaptionWithFootage} from '../stages/broll/captionContrast.ts';
import {currentGeminiBudget, geminiBudgetUnconfiguredWarning} from '../lib/geminiEditBudget.ts';
import {absentOpeningHookWarning, applyLegibility, captionSplitHold, captionSplitSpec, dropUngroundedBehindSubject, dropUngroundedGeneratedGraphics, generatedGraphicIsGrounded, groundCanvasTitles, groundInsetText, groundOverlayText, legibleCaption, legibleOnScreenText, openingIsPresent, survivingOpeningBehindSubject, type LegibilitySpec} from '../stages/broll/legibility.ts';
import {ledgerIdOf} from '../stages/broll/planLedger.ts';
import {stampUserBrollIds, userBrollIdByUrl} from '../stages/broll/userBrollContract.ts';
import {shineCaptionDirection} from '../stages/broll/geminiDirector.ts';
import {critiqueAndPatchLayout} from '../stages/layout/layoutCritique.ts';
import {colorDirectionSchema, openingRect, resolveOpening, type OpeningReport} from '../stages/openingPlan/openingPlan.ts';
import {designColorsFromRoles, motionThemeFromRoles, validateColorRoles, type RoleReport} from '../stages/openingPlan/colorRoles.ts';
import {sampleRegionStats, worstOf} from '../stages/openingPlan/regionStats.ts';
import {assertStrictDirectorDeliverables, assertStrictOpeningAccepted, assertStrictProvenance, assessStrictMotion, enforceStrictMotion, strictDegradedWarnings} from './strictOutcome.ts';
import {currentBillingBlock, runWithBillingGuard} from '../lib/billingGuard.ts';
import {stampProvenance} from '../lib/provenance.ts';
import {runMotionGraphicsStage, type MotionGraphicsStageResult} from '../stages/motionDirector/index.ts';
import {defaultMaxGraphics} from '../stages/motionDirector/motionDirector.ts';
import {anthropicGenerator, DEFAULT_MOTION_WORKER_MODEL, estimateClaudeCostUsd, MAX_REPAIR_ATTEMPTS} from '../motionWorker/worker.ts';
import {createBoundedClaudeGenerator} from '../lib/productClaudeBudget.ts';
import {decideClaudeBound, jobGraphicsStatus, libraryOnlyGraphics, type JobGraphicsStatus, type ProductEditProfile} from '../lib/productEditProfile.ts';
import {classifyContent, profileBlockForVisualDirector, type ContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {artDirectionLines, designFromProfile} from '../stages/contentProfile/artDirection.ts';
import {EditLedger} from '../lib/editLedger.ts';
import {finalizeEdits, recordAnchorChanges, zoomResolutionTrace} from './finalizeEdits.ts';
import {dumpDirectorTrace} from '../lib/directorDump.ts';
import {measureOccupancy, occupancyFromSpeaker, occupancySampleSec} from '../stages/layout/occupancy.ts';
import {dropGraphicsWithBakedText} from '../stages/broll/bakedGraphicText.ts';
import {markUnmeasuredFace, resolveTopAnchors, speakerForMotion} from '../stages/layout/unmeasuredSlots.ts';
import {evaluateFocus, visualContextFromSingleOccupancy} from '../stages/directorV2/visualContext.ts';
import {decideMatteGate, matteGateWarning, TEXT_BEHIND_SKIPPED_WARNING} from '../lib/matteGate.ts';
import {detectSpeakerCutout, type SpeakerCutout} from '../stages/layout/speakerCutout.ts';
import {composeBeautifulLayout} from '../stages/layout/slotCompositor.ts';
import {normalizeLutId} from '../stages/color/luts.ts';
import {autoTrimSilence, keepSegmentsFor} from '../stages/filters/autoTrim.ts';
import {applyAiKeepPlan, requestAiKeepPlan} from '../stages/filters/cutsAiKeepPlan.ts';
import {writeCutsDebugDump} from '../lib/cutsDebugDump.ts';
import {transcriptRetakeExclusions, wordsOutsideRanges} from '../stages/filters/transcriptRetakeTrim.ts';
import {
  mergeTimeRanges,
  nonSpeechExclusions,
  scriptRetakeExclusions,
} from '../stages/filters/scriptRetakeTrim.ts';
import {buildCaptionWords, dropUnmeasuredZoomFocus, resolveDirectedZooms, splitSentences} from '../stages/filters/autoZoom.ts';
import {buildTimeline, round} from '../stages/filters/timeline.ts';
import {transcribeAudio} from '../stages/transcribe/groqTranscribe.ts';
import {uploadSourceVideo} from '../storage/r2.ts';
import {applyProvidedCutout, normalizeProvidedCutoutUrl} from '../lib/providedCutout.ts';
import type {
  AnalysisStage,
  DeliveryShapingClip,
  LanguageCode,
  TimeRange,
  TimelineBlueprint,
} from '../types/blueprint.ts';
import {coerceVideoTemplateRecipe} from '../types/templateRecipe.ts';
import {
  captionGuideToDirection,
  coerceCaptionStyleGuide,
} from '../types/captionStyleGuide.ts';
import {lockCaptionTemplate, defaultRequestedEdits, isCaptionsOnlyEdits, polishRequestedEdits, visualToolkitsRequested} from '../lib/editToolkits.ts';
import {observe} from '../lib/runObserver.ts';
import {summarizeEditOutcomes} from '../lib/cutawayOutcomes.ts';

const log = stageLogger('pipeline');

/** Source ceiling: 5 minutes at bitrates phones produce, with headroom. */
/** WP7G: cuts profile only, the largest share the transcript retake pass may remove (the module default is 0.3; the analyze merge still caps the total at 0.55). */
const CUTS_RETAKE_MAX_REMOVAL = 0.5;
/** WP7I: timeline-level removal cap when the AI keep-plan was applied (speech removal is capped at 0.55 inside the plan; the rest is silence). */
const CUTS_AI_MAX_TIMELINE_REMOVAL = 0.85;
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
  /**
   * Labeled-asset UI bindings (slot → uploaded/skipped). Applied onto assetBrief
   * after describe; uploaded asset URLs should also appear in userBrollUrls.
   */
  labeledAssetBindings?: LabeledAssetBinding[];
  /** WP55: creator / business brand name for type_logo_reveal (optional; never guessed from the transcript). */
  brandName?: string;
  /** Force speaker-over-B-roll regardless of director choice. */
  forceSpeakerCutout?: boolean;
  /** A ready transparent talking-head WebM (the RVM matting job's outputUrl). When a non-empty http(s) URL is given it IS the cutout: no chroma-key extract, no RVM person matte. Absent = unchanged. */
  subjectCutoutUrl?: string;
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
  /**
   * CaptionKit preset for the captions-only burn. When set, this pipeline must
   * not overwrite the look with shineCaptionDirection — CaptionKit owns the style.
   */
  captionPreset?: string;
  noRepair?: boolean;
  /**
   * Teleprompter clean-edit (v1+v2): force silence/filler/cough trim + optional
   * script-aligned retake cuts even when the visual pipeline is captions-only.
   */
  teleprompterClean?: boolean;
  /** Teleprompter script text used for retake detection. */
  scriptText?: string;
  /** Generated motion graphics (Gemini briefs → Claude worker). Default: MOTION_GRAPHICS_ENABLED. */
  generatedGraphicsEnabled?: boolean;
  /**
   * Opt-in experiment (Phase 34), programmatic only (not part of any HTTP schema): send the WHOLE video to the Gemini decision calls (the v1 Director's
   * single planning call and the motion Director) as an inline video part, and optionally override the Claude worker's uploader/limits so compiled
   * modules stay local. Both absent: the pipeline is exactly as before.
   */
  directorVideoInput?: boolean;
  /**
   * Opt-in (Phase 35, needs directorVideoInput): the Director also returns an opening plan and semantic colour roles after watching the whole video.
   * They are validated (grounding, placement, contrast against the real footage) and applied as `openingTreatment` + a role-derived design; absent: unchanged.
   */
  openingDirection?: boolean;
  /**
   * Opt-in, programmatic only, default off (Phase 36I; needs strictAiDirection): record who supplied each Director field BEFORE the deterministic fallback completes it, and fail the
   * run when fallback content stands in for a Director field, when every Director item of a field was rejected, or when a requested opening plan is missing. Not reachable from the HTTP
   * API (not in http/schemas.ts); only the Phase 36 runner sets it. Absent: behaviour is unchanged.
   */
  strictProvenance?: boolean;
  /**
   * Opt-in, programmatic only: this run is meant to measure the AI Director, so it must never degrade silently. A terminal billing failure (HTTP 402,
   * "credits depleted") or a Director fallback stops the run with the exact blocker instead of producing a deterministic plan that looks like an AI edit.
   * Absent: the pipeline degrades exactly as before.
   */
  strictAiDirection?: boolean;
  /**
   * Strict runs only. Brief ids of generated graphics the caller explicitly accepts as missing (only for a placement reason: a Director refusal or a conflict-validator drop).
   * Nothing in a brief says a graphic is optional, so absent this list every requested graphic is required and the strict run fails closed (see strictOutcome.ts).
   */
  strictOptionalGraphicIds?: string[];
  motionWorkerOptions?: import('../stages/motionDirector/index.ts').MotionGraphicsStageInput['workerOptions'];
  /**
   * WP1, default off, set only by the product analyze path from server configuration (never by an API caller): creator-supplied B-roll only. No stock search or
   * placement, exact-id asset use, no substitution (see stages/broll/userBrollContract.ts). Absent: behaviour unchanged.
   */
  userBrollOnly?: boolean;
  /** WP1: the product editing profile (lib/productEditProfile.ts). `mvp` makes a Claude spend bound mandatory for generated graphics and lets a failed Director video proxy degrade. Absent = legacy. */
  editProfile?: ProductEditProfile;
};

/** Coarse stage reporting so the app can show real progress, not a spinner. */
export type AnalyzeHooks = {
  onStage?: (stage: AnalysisStage, progress: number) => void;
  /** WP3X: called once, when the server has decided whether generated graphics run (flag + Claude budget). */
  onGraphicsDecision?: (graphics: JobGraphicsStatus) => void;
};

export async function analyzeVideo(
  input: AnalyzeInput,
  hooks: AnalyzeHooks = {},
): Promise<TimelineBlueprint> {
  return input.strictAiDirection ? runWithBillingGuard(() => analyzeVideoUnguarded(input, hooks)) : analyzeVideoUnguarded(input, hooks);
}

/** Stage-boundary check for strict runs: throws the exact billing blocker. A no-op outside a strict run. */
export function assertNoBillingBlock(strict: boolean | undefined, stage: string): void {
  const block = strict ? currentBillingBlock() : null;
  if (block) {
    throw new EngineError('billing_blocked', `AI-directed run stopped at "${stage}": ${block.provider} billing is blocked${block.status ? ` (HTTP ${block.status})` : ''}. No deterministic plan was substituted.`, {stage, ...block});
  }
}

/** Strict runs also refuse a Director that fell back to the deterministic plan for any reason. */
export function assertDirectorRan(strict: boolean | undefined, plan: {directorFallbackReason?: string; warnings: string[]}): void {
  if (strict && (plan.directorFallbackReason || plan.warnings.includes('director_fallback'))) {
    throw new EngineError('broll_failed', `AI-directed run stopped: the visual Director did not run (${plan.directorFallbackReason ?? 'director_fallback'}). No deterministic plan was substituted.`, {stage: 'director'});
  }
}

async function analyzeVideoUnguarded(
  input: AnalyzeInput,
  hooks: AnalyzeHooks = {},
): Promise<TimelineBlueprint> {
  const stage = (name: AnalysisStage, progress: number) =>
    hooks.onStage?.(name, progress);
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const startedAll = Date.now();
  // WP8L: on polish a captions-only list (what the HTTP route and the CLI hand over for "no edits named") is expanded like an omitted one; say so once.
  if (input.editProfile === 'polish' && isCaptionsOnlyEdits(input.requestedEdits)) {
    warnings.push(env.POLISH_DEFAULT_EDITS === 'all' ? 'polish_edits_expanded:captions_to_all' : 'polish_edits_expanded:captions_to_lean');
  }
  // WP8I: on polish an omitted edit list means the polish default (not captions-only), the same function the HTTP runner uses for its cache key; every other profile is unchanged.
  const requestedEdits = input.editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, env.POLISH_DEFAULT_EDITS) : defaultRequestedEdits(input.requestedEdits, env.PIPELINE_MODE);
  // WP7A: the cuts-first profile (lib/productEditProfile.ts). It forces the trim ON (silence, fillers, transcript retakes), reduces background noise, and runs NO visual edit: no Director, no B-roll,
  // no generated or motion graphics, no delivery shaping. Every other profile is unchanged.
  // WP8A: the cuts profile is split into two switches. `speechCutsOn` (cuts AND polish) is Stage A, the speech path: denoise, AI keep-plan, fluency scrub, retakes, forced trim, debug dump.
  // `cutsOnlyVisualsOff` (cuts only) forces every visual stage off. `polish` = Stage A, then the mvp visual editor (`mvpLike`: mvp and polish share every mvp-only behaviour).
  const speechCutsOn = input.editProfile === 'cuts' || input.editProfile === 'polish';
  const cutsOnlyVisualsOff = input.editProfile === 'cuts';
  const polishPath = input.editProfile === 'polish';
  const mvpLike = input.editProfile === 'mvp' || input.editProfile === 'polish';
  // A client-provided transparent cutout (RVM matting job). '' = not provided: every cutout / matte path below is then exactly as before.
  const providedCutoutUrl = normalizeProvidedCutoutUrl(input.subjectCutoutUrl);
  const visualEditsOn = !cutsOnlyVisualsOff && visualToolkitsRequested(requestedEdits);

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
    observe(() => ({type: 'source', path: sourcePath, isLocal: local}));
    // Remotion only fetches http(s). A laptop path is copied for ASR, then
    // uploaded so the burn and the phone share the same public URL.
    let publicVideoUrl = input.videoUrl;
    if (local) {
      const uploaded = await uploadSourceVideo(sourcePath, extension);
      publicVideoUrl = uploaded.publicUrl;
    }
    timings.download = Date.now() - mark;
    // Stable per source video (the workspace path and blueprintId are random per run): original path/URL + byte size.
    const musicVideoId = createHash('sha256').update(`${input.videoUrl}|${(await statFile(sourcePath).catch(() => null))?.size ?? 0}`).digest('hex').slice(0, 24);

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
    observe(() => ({type: 'transcript', transcript: transcription.transcript, wordCount: transcription.words.length, detectedLanguage: transcription.detectedLanguage}));

    const recipe = input.styleRecipe
      ? coerceVideoTemplateRecipe(input.styleRecipe)
      : null;
    const captionGuide = coerceCaptionStyleGuide(input.captionStyleGuide);
    const northStar = Boolean(input.northStar || env.NORTH_STAR);
    const directorV2 = Boolean(input.directorV2 || env.DIRECTOR_V2 || northStar);
    // WP8B: the polish profile works inside an Edit Look (stages/directorV2/editLooks.ts), which lives in the Director v2 Stage 2, so polish runs the v2 visual Director. This switch drives the
    // visual Director only; the LLM delivery direction above keeps reading `directorV2`. Other profiles are unchanged.
    const visualDirectorV2 = directorV2 || polishPath;

    // --- Stage B ------------------------------------------------------------
    stage('filtering', 0.7);
    mark = Date.now();
    const sourceSentences = splitSentences(transcription.words);
    const deliveryDenied = input.forceDeliveryShaping === false || cutsOnlyVisualsOff;
    const deliveryAllowed =
      !deliveryDenied &&
      (input.forceDeliveryShaping === true ||
        requestedEdits == null ||
        requestedEdits.includes('delivery_shaping'));
    const deliveryExplicit = Boolean(
      input.forceDeliveryShaping === true ||
        requestedEdits?.includes('delivery_shaping'),
    );
    if (cutsOnlyVisualsOff) {
      warnings.push('delivery_shaping_skipped:cuts_profile');
    } else if (deliveryDenied) {
      warnings.push('delivery_shaping_skipped:disabled');
    } else if (!deliveryAllowed && requestedEdits != null) {
      warnings.push('delivery_shaping_skipped:not_in_allowlist');
    }
    let deliveryShaping: DeliveryShapingClip | undefined;
    let activeSourcePath = sourcePath;
    let activePublicVideoUrl = publicVideoUrl;
    let activeWords = transcription.words;
    let activeDurationSec = originalProbe.durationSec;

    // WP8A: on polish the automatic delivery pass is not run (it would skip the Stage A trim); only an explicit request runs it.
    if (deliveryAllowed && (deliveryExplicit || (env.DELIVERY_SHAPING_AUTO && !polishPath))) {
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

    // WP7A: cuts profile only. Reduce background noise on the talking-head audio. The audio is replaced by a denoised copy with the SAME video stream and duration, so every word time and cut
    // stays valid (the transcript above was made from the original audio). Any failure (ffmpeg or upload) warns and keeps the original audio: it never fails the edit.
    if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {
      try {
        const denoisedPath = workspace.file('denoised.mp4');
        await denoiseTalkingHeadAudio({
          inputPath: activeSourcePath,
          outputPath: denoisedPath,
          filter: buildDenoiseFilter({reductionDb: env.CUTS_DENOISE_NR_DB, highPassHz: env.CUTS_DENOISE_HIGHPASS_HZ}),
        });
        const uploaded = await uploadSourceVideo(denoisedPath, '.mp4');
        activeSourcePath = denoisedPath;
        activePublicVideoUrl = uploaded.publicUrl;
        warnings.push(DENOISE_APPLIED_WARNING);
      } catch (error) {
        log.warn({error}, 'cuts denoise failed; continuing with the original audio');
        warnings.push(DENOISE_FAILED_WARNING);
      }
    }

    const captionsOnly = !visualEditsOn;
    const teleprompterClean = Boolean(input.teleprompterClean);
    const skipSilenceTrim =
      Boolean(deliveryShaping) ||
      (captionsOnly && !teleprompterClean && !speechCutsOn) ||
      (Boolean(recipe && recipe.trimSilence === false) && !teleprompterClean && !speechCutsOn);

    let cutsAiDebug: NonNullable<Parameters<typeof writeCutsDebugDump>[0]['aiKeepPlan']> | undefined;
    let cutsAiApplied = false;
    let cutsDebugCounts = {droppedTakes: 0, restarts: 0, echoes: 0};
    let trim: {
      keepSegments: Array<{
        sourceStart: number;
        sourceEnd: number;
        outputStart: number;
      }>;
      trimExclusions: TimeRange[];
      removedSec: number;
      skipped?: string;
    };

    if (polishPath && deliveryShaping) {
      warnings.push('polish_stage_a_trim_skipped:delivery_shaped'); // an explicit delivery-shaping request replaced the Stage A trim on polish
    }
    if (skipSilenceTrim) {
      trim = {
        keepSegments: [
          {
            sourceStart: 0,
            sourceEnd: activeDurationSec,
            outputStart: 0,
          },
        ],
        trimExclusions: [],
        removedSec: 0,
        skipped: deliveryShaping
          ? 'delivery_shaped'
          : captionsOnly
            ? 'captions_only'
            : 'template_trim_disabled',
      };
    } else {
      let vad: Awaited<ReturnType<typeof prepareSpeechCuts>> | null = null;
      if (env.VAD_ENABLED) {
        vad = await prepareSpeechCuts({audioPath: audio.path, words: activeWords, durationSec: activeDurationSec});
        if (vad.warning) warnings.push(vad.warning);
        else warnings.push(`vad_speech_regions:${vad.speechRegions?.length ?? 0}`);
        activeWords = vad.words;
      }
      const silence = autoTrimSilence(activeWords, {
        thresholdSec: env.SILENCE_THRESHOLD_SEC,
        paddingSec: env.SILENCE_PADDING_SEC,
        sourceDurationSec: activeDurationSec,
        removeFillers: true,
        aggressiveBackchannel: speechCutsOn, // WP7G: cuts profile cuts glued mid-phrase yeah / yep / yup too
        ...(vad ? {speechRegions: vad.speechRegions, pausePolicy: vad.pausePolicy} : {}),
      });
      const exclusions: TimeRange[] = [...silence.trimExclusions];
      const coughCuts = nonSpeechExclusions(activeWords, {
        paddingSec: env.SILENCE_PADDING_SEC,
      });
      exclusions.push(...coughCuts);

      let retakeDropped = 0;
      let scriptCuts: TimeRange[] = [];
      if (teleprompterClean && (input.scriptText || '').trim()) {
        const retakes = scriptRetakeExclusions(activeWords, input.scriptText || '', {
          sourceDurationSec: activeDurationSec,
          paddingSec: env.SILENCE_PADDING_SEC,
        });
        exclusions.push(...retakes.trimExclusions);
        scriptCuts = retakes.trimExclusions;
        retakeDropped = retakes.droppedTakes;
        if (retakes.droppedTakes > 0) {
          warnings.push(`retakes_dropped:${retakes.droppedTakes}`);
        } else if (retakes.matchedLines < 1) {
          warnings.push('retakes_skipped:no_script_match');
        }
      }

      // WP6A: near-duplicate takes found from the transcript alone (no script needed). Gate: the mvp profile on a full-edits (not captions-only) run, or an explicit teleprompter-clean
      // request. Legacy full-edits runs and lean captions-only runs are unchanged. It judges only the speech the script path has not already cut.
      let transcriptRetakeDropped = 0;
      // WP7I (cuts profile only): ONE text-model call picks the speech that stays. On any failure or guard trip the deterministic retake path below runs as before.
      if (speechCutsOn && env.CUTS_AI_KEEP_PLAN && env.GEMINI_API_KEY) {
        const requested = await requestAiKeepPlan({words: activeWords, sourceDurationSec: activeDurationSec});
        const applied = requested.plan
          ? applyAiKeepPlan({words: activeWords, plan: requested.plan, sourceDurationSec: activeDurationSec})
          : ({ok: false, reason: requested.reason ?? 'model_failed'} as const);
        cutsAiDebug = {
          model: requested.model,
          applied: applied.ok,
          ...(applied.ok ? {} : {skipped: applied.reason}),
          raw: requested.raw,
          normalizedKeep: applied.ok ? applied.keepRanges : [],
          exclusions: applied.ok ? applied.exclusions : [],
        };
        if (applied.ok) {
          exclusions.push(...applied.exclusions);
          cutsAiApplied = true;
          transcriptRetakeDropped = applied.totalWords - applied.keptWords;
          warnings.push(`cuts_ai_keep_plan_applied:${applied.keptWords}/${applied.totalWords}`);
          if (applied.scrub.yeah + applied.scrub.stutter + applied.scrub.dupe + applied.scrub.stuck + applied.scrub.restart > 0) {
            warnings.push(`cuts_ai_keep_plan_post_scrub:yeah=${applied.scrub.yeah},stutter=${applied.scrub.stutter},dupe=${applied.scrub.dupe},stuck=${applied.scrub.stuck},restart=${applied.scrub.restart}`);
          }
        } else {
          warnings.push(`cuts_ai_keep_plan_skipped:${applied.reason}`);
        }
      }
      if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {
        const transcriptRetakes = transcriptRetakeExclusions(wordsOutsideRanges(activeWords, scriptCuts), {
          sourceDurationSec: activeDurationSec,
          paddingSec: env.SILENCE_PADDING_SEC,
          // WP7G (cuts profile only): a messy one-take must not be under-cut by the 0.3 default; the analyze merge below still refuses to remove more than 55%.
          ...(speechCutsOn ? {maxRemovalFrac: CUTS_RETAKE_MAX_REMOVAL, wholeVideo: true} : {}),
          ...(cutsAiApplied ? {skip: true} : {}), // WP7I: the AI keep-plan already decided what stays
        });
        cutsDebugCounts = {droppedTakes: transcriptRetakes.droppedTakes, restarts: transcriptRetakes.restarts, echoes: transcriptRetakes.echoes ?? 0};
        exclusions.push(...transcriptRetakes.trimExclusions);
        transcriptRetakeDropped = transcriptRetakes.droppedTakes;
        if (transcriptRetakes.droppedTakes > 0) {
          warnings.push(`transcript_retakes_dropped:${transcriptRetakes.droppedTakes}`);
        } else if (transcriptRetakes.skipped === 'would_remove_too_much' || transcriptRetakes.skipped === 'too_many_takes') {
          warnings.push(`transcript_retakes_skipped:${transcriptRetakes.skipped}`);
        }
      }

      if (silence.skipped && retakeDropped < 1 && transcriptRetakeDropped < 1 && coughCuts.length < 1) {
        trim = {
          keepSegments: silence.keepSegments,
          trimExclusions: silence.trimExclusions,
          removedSec: silence.removedSec,
          skipped: silence.skipped,
        };
      } else {
        const merged = mergeTimeRanges(exclusions);
        const keepSegments = keepSegmentsFor(merged, activeDurationSec);
        const removedSec = merged.reduce(
          (total, range) => total + (range.end - range.start),
          0,
        );
        const keptSec = activeDurationSec - removedSec;
        // WP7I: an applied AI keep-plan already passed its own speech-removal guard (55% of spoken time); dead air it also cuts must not trip the timeline cap, so that cap is looser then.
        const maxRemoval = 0.55;
        const removalCap = cutsAiApplied ? CUTS_AI_MAX_TIMELINE_REMOVAL : maxRemoval;
        const minKeepFrac = cutsAiApplied ? 0.2 : 0.4;
        const minKeepSec = 2.5;
        if (
          activeDurationSec > 0 &&
          (removedSec / activeDurationSec > removalCap ||
            keptSec <
              Math.min(
                activeDurationSec,
                Math.max(minKeepSec, activeDurationSec * minKeepFrac),
              ))
        ) {
          // Fall back to silence-only (or intact) if combined cuts are too aggressive.
          trim = {
            keepSegments: silence.keepSegments,
            trimExclusions: silence.trimExclusions,
            removedSec: silence.removedSec,
            skipped: silence.skipped || 'combined_trim_too_aggressive',
          };
          warnings.push('teleprompter_trim_guard:combined_too_aggressive');
        } else {
          trim = {
            keepSegments,
            trimExclusions: merged.map(range => ({
              start: round(range.start),
              end: round(range.end),
            })),
            removedSec: round(removedSec),
          };
        }
      }
    }
    if (trim.skipped) {
      warnings.push(`silence_trim_skipped:${trim.skipped}`);
    }
    const timeline = buildTimeline(trim.keepSegments);
    const captionWordsRaw = buildCaptionWords(activeWords, timeline, trim.trimExclusions);
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
    // Decide what kind of video this is before any edit is planned.
    const motionGraphicsRequested = !cutsOnlyVisualsOff && (input.generatedGraphicsEnabled ?? env.MOTION_GRAPHICS_ENABLED);
    // WP1: how Claude calls for this edit are bounded. Legacy without a configured cap is unchanged; mvp without one switches generated graphics off (fail closed).
    const claudeBound = decideClaudeBound({
      profile: input.editProfile ?? 'legacy',
      graphicsOn: motionGraphicsRequested,
      callerSuppliedGenerator: Boolean(input.motionWorkerOptions?.generator),
      capUsd: env.CLAUDE_EDIT_BUDGET_USD,
      maxRequests: env.CLAUDE_EDIT_MAX_REQUESTS,
      maxTokensPerCall: env.CLAUDE_EDIT_MAX_TOKENS,
      defaultMaxRequests: defaultMaxGraphics(timeline.outputDurationSec) * (1 + MAX_REPAIR_ATTEMPTS),
    });
    // WP8E: on polish only, a disabled Claude bound no longer switches graphics off: the motion stage runs for LIBRARY hits only (no Claude call is ever made; a miss is dropped). The job's graphics
    // status then says `library_only`, not `on`. mvp, legacy and cuts are unchanged (fail closed).
    const libraryOnly = libraryOnlyGraphics(input.editProfile, motionGraphicsRequested, claudeBound);
    const claudeAllowed = claudeBound.action !== 'disabled';
    const motionGraphicsOn = motionGraphicsRequested && (claudeAllowed || libraryOnly);
    hooks.onGraphicsDecision?.(jobGraphicsStatus({requested: motionGraphicsRequested, bound: claudeBound, libraryOnly}));
    if (claudeBound.action === 'disabled') {
      warnings.push(`claude_graphics_disabled:${claudeBound.reason}`);
    }
    if (libraryOnly) {
      warnings.push('motion_graphics:library_only');
    }
    // WP5D: on mvp, say so when no Gemini attempt cap is configured (0 / unset means unbounded). A warning only: the job is not refused and the default is unchanged.
    const geminiUncapped = geminiBudgetUnconfiguredWarning(input.editProfile, env.GEMINI_EDIT_MAX_REQUESTS);
    if (geminiUncapped) {
      warnings.push(geminiUncapped);
    }
    // The configuration this run actually resolved (caller overrides merged with the environment), not the environment alone.
    observe(() => ({
      type: 'run_config',
      effective: {
        directorV2, northStar, captionsOnly, visualEditsOn, motionGraphicsOn,
        requestedEdits: requestedEdits ? [...requestedEdits] : null,
        languageCode: input.languageCode,
        HOOK_TITLE_POLICY: env.HOOK_TITLE_POLICY,
        OCCUPANCY_CONTEXT_V2: env.OCCUPANCY_CONTEXT_V2,
        VISUAL_CONTEXT_V2: env.VISUAL_CONTEXT_V2,
        GENERATED_TRANSITIONS_ENABLED: env.GENERATED_TRANSITIONS_ENABLED,
        DIRECTOR_V2: directorV2,
        NORTH_STAR: northStar,
        PIPELINE_MODE: env.PIPELINE_MODE,
        ZOOM_SCALE: env.ZOOM_SCALE,
        MOTION_GRAPHICS_ENABLED: motionGraphicsOn,
        CONTENT_PROFILE_ENABLED: env.CONTENT_PROFILE_ENABLED,
        HOOK_DURATION_SEC: env.HOOK_DURATION_SEC,
        BROLL_MOMENT_COUNT: env.BROLL_MOMENT_COUNT,
        GEMINI_MODEL: env.GEMINI_MODEL,
      },
    }));
    let contentProfile: ContentProfile | null = null;
    if (env.CONTENT_PROFILE_ENABLED && (visualEditsOn || motionGraphicsOn)) {
      contentProfile = await classifyContent({
        transcript: transcription.transcript,
        durationSec: timeline.outputDurationSec,
        languageCode: transcription.detectedLanguage || input.languageCode,
      });
      if (contentProfile) {
        warnings.push(`content_type:${contentProfile.contentType}`);
        dumpDirectorTrace('00-content-profile', contentProfile);
      }
    }
    assertNoBillingBlock(input.strictAiDirection, 'content_profile');
    const profileDesign = contentProfile ? designFromProfile(contentProfile) : undefined;
    let colorRoles: RoleReport | null = null;
    let directorDesign: import('../types/blueprint.ts').DesignTokens | undefined;
    let ledger = new EditLedger();
    ledger.setProfile(
      contentProfile
        ? {
            present: true,
            contentType: contentProfile.contentType,
            structure: contentProfile.structure,
            density: contentProfile.density,
            mood: contentProfile.mood,
            maxGraphics: contentProfile.policy.maxGraphics,
          }
        : {present: false},
    );
    const occupancyStill = workspace.file('occupancy.jpg');
    const forceSpeakerCutout = Boolean(input.forceSpeakerCutout || env.FORCE_SPEAKER_CUTOUT);
    let occupancy = occupancyFromSpeaker(
      {x: 0.18, y: 0.16, w: 0.64, h: 0.62},
      'fallback',
    );
    let userAssetIdByUrl: Map<string, string> | undefined; // WP3B (mvp profile only)
    const solidUserUrls = new Set<string>(); // WP29: described user stills that are solid / near-solid color
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
    // Phase C: planning-time matte state. `available` on the planning cutout means a matte is OBTAINABLE (the backdrop is keyable, or RVM is configured); the real asset is obtained later (see "Phase C" below).
    let speakerKeyable = false;
    let planningMatteReason = '';
    let matteOccupancyCtx: {source: typeof occupancy.source; unmeasured: boolean} | null = null;
    const matteExpected = () => Boolean(resolvedCutout.available);

    // Opt-in whole-video input for the Gemini decision calls (never built unless a caller asks and a Gemini stage will run).
    let directorVideo: DirectorVideoPart | undefined;
    if (input.directorVideoInput && (visualEditsOn || motionGraphicsOn)) {
      try {
        directorVideo = await buildDirectorVideoPart(activeSourcePath, workspace.file('director-video.mp4'));
      } catch (error) {
        // WP1: in the product MVP profile a proxy that cannot be built (too large for one request, ffmpeg failure) degrades to the transcript-only Director with a warning
        // instead of failing the whole edit. Strict runs and the legacy profile keep today's behaviour: the error propagates.
        if (input.strictAiDirection || !mvpLike) {
          throw error;
        }
        warnings.push('director_video_unavailable');
        log.warn({error}, 'director video proxy unavailable; using the transcript-only Director');
      }
    }
    if (directorVideo) {
      log.info({bytes: directorVideo.bytes, width: directorVideo.width, height: directorVideo.height, fps: directorVideo.fps}, 'director video proxy built');
      warnings.push(`director_video_input:${directorVideo.bytes}b`);
    }

    if (captionsOnly) {
      const presetId = (input.captionPreset || '').trim();
      if (presetId) {
        // CaptionKit burns this preset. Do not force the karaoke shine look.
        broll = captionsOnlyVisualPlan({
          position: 'bottom',
          bottomFrac: 0.16,
          textColor: '#FFFFFF',
          highlightColor: '#FFFFFF',
          boxColor: null,
          template: 'clean',
          animation: 'scale',
          fontScale: 1,
          uppercase: false,
        });
      } else {
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
      }
      timings.broll = Date.now() - mark;
      timings.occupancy = 0;
      timings.layout = 0;
      warnings.push(...broll.warnings);
    } else {
      const userBrollAssets = await describeUserBrollAssets(
        input.userBrollUrls ?? [],
        workspace,
      );
      if (mvpLike) {
        userAssetIdByUrl = userBrollIdByUrl(userBrollAssets);
      }
      for (const asset of userBrollAssets) if (asset.solidLike) solidUserUrls.add(asset.url);
      if (solidUserUrls.size > 0) warnings.push(`user_broll_solid_stills:${solidUserUrls.size}`);
      if ((input.userBrollUrls?.length ?? 0) > 0 && userBrollAssets.length === 0) {
        warnings.push('user_broll_describe_failed');
      }
      if (input.userBrollOnly) {
        // WP1: the creator's own clips must not vanish silently. Ids are positional (ub_1...), so a failed asset leaves a gap rather than renumbering the rest.
        const requested = new Set((input.userBrollUrls ?? []).map(url => url.trim()).filter(Boolean)).size;
        if (userBrollAssets.length < requested) {
          warnings.push(`user_broll_unavailable:${requested - userBrollAssets.length}`);
        }
      }
      occupancy = await measureOccupancy({
        sourcePath: activeSourcePath,
        durationSec: activeDurationSec,
        stillPath: occupancyStill,
      });
      timings.occupancy = Date.now() - mark;
      // WP3H (mvp profile only): an undetected speaker is unknown. Mark the occupancy so the slot list no longer subtracts the default box, and say so.
      const unmeasured = markUnmeasuredFace(occupancy, input.editProfile);
      occupancy = unmeasured.occupancy;
      warnings.push(...unmeasured.warnings);
      // Experimental (VISUAL_CONTEXT_V2, default off): what the v1 Director is told about the frame it was measured on.
      // One speaker box at one moment, placed on the OUTPUT timeline; everything else is reported as not observed.
      const visualContext =
        env.VISUAL_CONTEXT_V2 && !visualDirectorV2
          ? visualContextFromSingleOccupancy({
              durationSec: timeline.outputDurationSec,
              keepSegments: timeline.keepSegments,
              sampleSourceSec: occupancySampleSec(activeDurationSec),
              mapSourceToOutput: timeline.mapSourceToOutput,
              occupancy,
            })
          : undefined;
      const detectedCutout = await detectSpeakerCutout(occupancyStill);
      speakerKeyable = detectedCutout.available;
      // Phase C: a matte is obtainable when the backdrop is keyable (chroma, the fast path) OR RVM is configured (any backdrop). Neither = planning stays as before (no behind-subject / depth / cutout).
      const rvmObtainable = !speakerKeyable && subjectMatteConfigured();
      const speakerCutout = {
        ...detectedCutout,
        speaker: occupancy.speaker,
        available: speakerKeyable || rvmObtainable,
        ...(rvmObtainable ? {source: 'rvm' as const} : {}),
        // a provided cutout IS the matte, so planning may use it even when the backdrop is not keyable (absent: unchanged)
        ...(providedCutoutUrl ? {available: true} : {}),
      };
      // WP8C: the planning matte gate (lib/matteGate.ts): a MEASURED speaker and a keyable cutout. On the mvp-like profiles it is reported; on polish it is also what tells the Director (and the Edit Look
      // enforcement) whether a cutout / text-behind / depth element may be planned. The alpha video itself is extracted after planning; the final gate below re-checks it.
      const matteOccupancy = {source: occupancy.source, unmeasured: Boolean(occupancy.unmeasuredSlots)};
      const planningMatte = decideMatteGate({occupancy: matteOccupancy, cutout: {available: speakerCutout.available}});
      if (mvpLike) warnings.push(matteGateWarning(planningMatte));
      planningMatteReason = planningMatte.reason;
      matteOccupancyCtx = matteOccupancy;
      assertNoBillingBlock(input.strictAiDirection, 'speaker_occupancy');
      if (polishPath) warnings.push('polish_craft:standards:on'); // WP54: formatCraftStandardsForDirector() is appended to the creative-director prompt (creativeDirector.designEdit, editLooks = polish)
      // WP55 phase 2: offer KINETIC_TYPE_STORYTELLING to the live Director (same flag, same L1 allowlist as the craft stage; the skill is a pure function of env flags so it can be resolved before planning).
      const kineticOfferSkill = resolvePolishSkill({faceless: Boolean(polishPath && env.POLISH_FACELESS_DOC), explainer: Boolean(polishPath && env.POLISH_EXPLAINER_SKILL), newsroom: Boolean(polishPath && env.POLISH_NEWSROOM_MG)}).skill;
      const kineticTypePrompt =
        polishPath && env.POLISH_MOTION_TEMPLATES && visualDirectorV2
          ? formatKineticTypeForDirector(mapPolishSkillToMotionTemplateSkill(kineticOfferSkill), new Set<string>(LIBRARY_COMPOSITION_IDS))
          : '';
      if (kineticTypePrompt) warnings.push('kinetic_type:director_offered');
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
        directorV2: visualDirectorV2,
        editLooks: polishPath,
        ...(kineticTypePrompt ? {kineticType: {prompt: kineticTypePrompt}} : {}),
        matteUsable: polishPath ? planningMatte.usable : undefined,
        expectLibraryGraphics: polishPath && motionGraphicsRequested, // WP8X
        videoId: musicVideoId,
        lookBias: polishPath && contentProfile ? {contentType: contentProfile.contentType, density: contentProfile.density, structure: contentProfile.structure, mood: contentProfile.mood} : undefined, // WP8P/WP8S
        northStar,
        directorVideo,
        openingDirection: Boolean(input.openingDirection && directorVideo),
        userBrollOnly: input.userBrollOnly,
        captureProvenance: Boolean(input.strictAiDirection && input.strictProvenance),
        sourcePath: activeSourcePath,
        workspace,
        requestedEdits,
        captionTemplate: input.captionTemplate ?? null,
        contentProfileBlock: contentProfile ? profileBlockForVisualDirector(contentProfile, artDirectionLines(contentProfile)) : undefined,
        themeColorHints: profileDesign ? [profileDesign.surfaceColor, profileDesign.primaryColor] : undefined,
        noRepair: input.noRepair,
        ...(visualContext ? {visualContext} : {}),
        occupancyAtSec: timeline.mapSourceToOutput(occupancySampleSec(activeDurationSec)),
      });
      timings.broll = Date.now() - mark;
      assertNoBillingBlock(input.strictAiDirection, 'visual_director');
      assertDirectorRan(input.strictAiDirection, broll);
      assertStrictDirectorDeliverables(input.strictAiDirection, {openingRequested: Boolean(input.openingDirection && directorVideo), openingPlanPresent: Boolean(broll.openingRaw?.openingPlan), fallbackSubstitutions: broll.fallbackSubstitutions});
      assertStrictProvenance(Boolean(input.strictAiDirection && input.strictProvenance), broll.directorProvenance, {openingRequested: Boolean(input.openingDirection && directorVideo)});
      warnings.push(...broll.warnings);
      ledger = broll.ledger ?? ledger;
      if (broll.openingRaw) {
        const parsedColors = colorDirectionSchema.safeParse(broll.openingRaw.colorDirection);
        if (parsedColors.success) {
          colorRoles = validateColorRoles(parsedColors.data.roles);
          const base = profileDesign ?? broll.northStarDesign;
          directorDesign = stampProvenance(
            {
              enabled: true as const,
              contentType: base?.contentType ?? 'other',
              displayFont: base?.displayFont ?? 'space_grotesk',
              motionPreset: base?.motionPreset ?? 'documentary',
              cornerRadius: base?.cornerRadius ?? 16,
              density: base?.density ?? 'balanced',
              ...designColorsFromRoles(colorRoles.roles),
            },
            {primaryColor: 'director', secondaryColor: 'director', inkColor: 'director', surfaceColor: 'director'},
          );
          warnings.push(...colorRoles.corrections.map(c => `color_role_corrected:${c.role}`), ...colorRoles.warnings.map(w => `color_role_warning:${w}`));
        } else {
          warnings.push('color_direction_invalid');
        }
      }

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
      const anchorsBefore = {kinetic: [...(broll.motionGraphics ?? [])], emphasis: [...(broll.semanticEmphasis ?? [])]};
      const patched = await critiqueAndPatchLayout({
        stillPath: occupancyStill,
        occupancy,
        plan: {
          hookTitle: broll.hookTitle,
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
      if (occupancy.unmeasuredSlots) {
        // WP3L: an unmeasured face has no side. `top` (which the renderer and the validator read as left in some components and right in others) becomes a top corner no other top-corner
        // element occupies at that time, before the ledger notes the anchors and before the shared validator sees them.
        const topBand = resolveTopAnchors({motionGraphics: broll.motionGraphics ?? [], semanticEmphasis: broll.semanticEmphasis ?? [], overlays: broll.overlays});
        broll.motionGraphics = topBand.motionGraphics;
        broll.semanticEmphasis = topBand.semanticEmphasis;
        broll.overlays = topBand.overlays;
        if (topBand.converted > 0) {
          warnings.push(`top_anchor_converted:${topBand.converted}`);
        }
      }
      recordAnchorChanges(ledger, 'kinetic_text', anchorsBefore.kinetic, broll.motionGraphics);
      recordAnchorChanges(ledger, 'emphasis', anchorsBefore.emphasis, broll.semanticEmphasis);
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
        alreadyOutput: visualDirectorV2,
        trace: zoomResolutionTrace(ledger),
        // VISUAL_CONTEXT_V2: a focus is honoured only if an observation near the zoom contains it (output-time windows).
        ...(env.VISUAL_CONTEXT_V2
          ? {
              focusEvidence: (_zoom: unknown, window: {start: number; end: number}, focus: {x: number; y: number}) => {
                const decision = evaluateFocus(broll.visualContext, window, focus);
                return decision.ok ? null : decision.reason;
              },
            }
          : {}),
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

      // WP4H: an unmeasured speaker box is a guess; a focus picked against it can crop the real head, so on mvp the zoom stays and its focus goes (default origin).
      const unmeasuredZoom = dropUnmeasuredZoomFocus(zoomTriggers, {profile: input.editProfile, source: occupancy.source});
      zoomTriggers = unmeasuredZoom.triggers;
      if (unmeasuredZoom.dropped > 0) warnings.push(`zoom_focus_unmeasured_dropped:${unmeasuredZoom.dropped}`);

      // Phase C: the real alpha asset is NOT extracted here any more. The motion Director and the opening still have to plan their behind-subject windows (they only need to know a matte is expected, `matteExpected()`),
      // so the asset is obtained after them and before finalizeEdits ("Phase C" below). A provided cutout is already the asset.
      resolvedCutout = providedCutoutUrl ? applyProvidedCutout({...speakerCutout, source: undefined}, providedCutoutUrl) : {...speakerCutout, source: undefined};
      if (providedCutoutUrl) warnings.push('speaker_cutout_provided');
    }

    // --- Stage C2: generated motion graphics (opt-in) -------------------------
    // Runs over the finished edit; existing B-roll/overlays/hook take priority.
    // Footage measurement for text legibility (opt-in stages only). Output time -> source time through the keep segments.
    const toSource = (outputSec: number) => {
      const segment = [...timeline.keepSegments].reverse().find(item => item.outputStart <= outputSec) ?? timeline.keepSegments[0];
      return segment ? segment.sourceStart + (outputSec - segment.outputStart) : outputSec;
    };
    const measureOver = async (box: {x: number; y: number; w: number; h: number}, span: {start: number; end: number}) =>
      worstOf(await Promise.all([span.start, (span.start + span.end) / 2, Math.max(span.start, span.end - 0.3)].map(t => sampleRegionStats(activeSourcePath, toSource(t), box))));
    // Strict runs: an opening the resolver will reject is known now (local, deterministic), so stop before the paid motion stage instead of after it.
    if (input.strictAiDirection && broll.openingRaw?.openingPlan) {
      const early = await resolveOpening({
        plan: broll.openingRaw.openingPlan,
        colorDirection: broll.openingRaw.colorDirection,
        transcript: transcription.transcript,
        durationSec: timeline.outputDurationSec,
        hookDurationSec: Math.max(1.5, broll.hookDurationSec || 3),
        ...speakerForMotion(occupancy), // WP3O: the real box for a face; no box and "unknown" for an unmeasured one
        matteUsable: matteExpected(),
        measure: box => measureOver(box, {start: 0, end: Math.max(1.5, broll.hookDurationSec || 3)}),
      });
      assertStrictOpeningAccepted(input.strictAiDirection, early.report);
    }
    // WP33: the Metromedia VO cut grammar (polish only, POLISH_VO_CUT_GRAMMAR): 1-3 word caption groups -> cut times (~0.85 s mean shot), holds only on money / CTA, a chapter card every 15-25 s. Pure plan from the spoken
    // words; it feeds the library seed (chapter cards) and the WP16 transition density (hard-cut anchors) below.
    const voGrammar = polishPath && env.POLISH_VO_CUT_GRAMMAR
      ? planVoCutGrammar({words: captionWords, durationSec: timeline.outputDurationSec, flags: {moneyWindows: moneyWindowsOf(captionWords), ctaWindows: ctaWindowsOf(captionWords, timeline.outputDurationSec)}})
      : null;
    if (voGrammar) warnings.push(...voGrammar.warnings);
    let motion: MotionGraphicsStageResult | null = null;
    if (motionGraphicsOn) {
      mark = Date.now();
      // WP1: when a per-edit bound applies, EVERY Claude call of this edit (first generation and repairs, across concurrent graphics) goes through one budget.
      let boundedClaude: ReturnType<typeof createBoundedClaudeGenerator<{system: string; user: string}, Awaited<ReturnType<ReturnType<typeof anthropicGenerator>>>>> | null = null;
      let workerOptions = input.motionWorkerOptions;
      if (claudeBound.action === 'bounded') {
        const model = process.env.MOTION_WORKER_MODEL || DEFAULT_MOTION_WORKER_MODEL; // the same expression anthropicGenerator uses
        const zero = {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0};
        let price: {input: number; output: number} | null = null;
        try {
          price = {input: estimateClaudeCostUsd(model, {...zero, inputTokens: 1e6}) / 1e6, output: estimateClaudeCostUsd(model, {...zero, outputTokens: 1e6}) / 1e6};
        } catch {
          price = null; // unpriced model: every reservation is refused (fail closed)
        }
        boundedClaude = createBoundedClaudeGenerator({
          config: claudeBound,
          price,
          generate: (request, maxTokens) => anthropicGenerator({maxTokens})(request),
          costOf: result => estimateClaudeCostUsd(result.model, result.usage),
          describe: result => ({model: result.model, stopReason: result.stopReason, usage: result.usage}),
        });
        workerOptions = {...input.motionWorkerOptions, generator: boundedClaude.generator};
      }
      motion = await runMotionGraphicsStage({
        videoPart: directorVideo,
        workerOptions,
        plateAnchors: broll.plateAnchors, // WP9B: explicit plates the polish plan asked for (e.g. a split with no creator media)
        explainPlates: polishPath && !(input.userBrollUrls ?? []).some(url => url.trim()), // WP9A: no creator B-roll -> one library explain plate per engagement window
        ...(voGrammar && voGrammar.chapterCards.length > 0 ? {chapterCards: voGrammar.chapterCards} : {}), // WP33: chapter cards ride the existing FlashCard seed path
        preferLibrary: polishPath, // WP8D: polish delivers briefs that fit a library composition without a Claude call
        claudeAllowed, // WP8E: false = library hits only; the generator is never called
        isCopyGrounded: content => generatedGraphicIsGrounded({props: {content}}, transcription.transcript), // WP8N
        lookId: [...warnings].reverse().find(warning => warning.startsWith('edit_look:'))?.slice('edit_look:'.length) ?? null, // WP8J: the chosen look, for the library seed's cap
        transcript: transcription.transcript,
        words: captionWords,
        outputDurationSec: timeline.outputDurationSec,
        languageCode: transcription.detectedLanguage || input.languageCode,
        edit: {
          brollClips: broll.clips,
          visualOverlays: broll.overlays,
          insetReveals: broll.insetReveals ?? [],
          depthOverlays: matteExpected() ? broll.depthOverlays ?? [] : [],
          mediaContainers: broll.mediaContainers ?? [],
          motionGraphics: broll.motionGraphics ?? [],
          semanticEmphasis: broll.semanticEmphasis ?? [],
          frameInsets: broll.frameInsets ?? [],
          hookTitle: broll.hookTitle,
          hookStartSec: broll.hookStartSec ?? 0,
          hookDurationSec: broll.hookDurationSec,
        },
        ...speakerForMotion(occupancy), // WP3N: the real box for a face; no box and "unknown" for an unmeasured one
        framePath: occupancyStill,
        captionBottomFrac: broll.caption.bottomFrac ?? undefined,
        captionPosition: broll.caption.position ?? 'bottom',
        contentProfile,
        subjectMatteUsable: matteExpected(),
        ...(colorRoles ? {themeOverride: motionThemeFromRoles(colorRoles.roles), textRoles: {primary_text: colorRoles.roles.primary_text, panel: colorRoles.roles.panel}} : {}),
        measureText: measureOver,
        ledger,
      });
      timings.motionGraphics = Date.now() - mark;
      if (occupancy.unmeasuredSlots) {
        // WP3M: the same conversion once more, now that the motion stage has run, for any anchored element still on `top`. Elements the first pass already converted keep their corner (the
        // function is idempotent and counts them as occupying their side), so no side is flipped. The stage returns generated graphics (box placements) and behind-subject text, which carry
        // no anchor, so today this is a safety net; the ledger is told about any change it does make.
        const lateKinetic = broll.motionGraphics ?? [];
        const lateEmphasis = broll.semanticEmphasis ?? [];
        const late = resolveTopAnchors({motionGraphics: lateKinetic, semanticEmphasis: lateEmphasis, overlays: broll.overlays});
        if (late.converted > 0) {
          broll.motionGraphics = late.motionGraphics;
          broll.semanticEmphasis = late.semanticEmphasis;
          broll.overlays = late.overlays;
          recordAnchorChanges(ledger, 'kinetic_text', lateKinetic, broll.motionGraphics);
          recordAnchorChanges(ledger, 'emphasis', lateEmphasis, broll.semanticEmphasis);
          warnings.push(`top_anchor_converted_after_motion:${late.converted}`);
        }
      }
      if (boundedClaude) {
        // Counts, usage and refusal reasons only (no prompts, outputs or keys).
        const spend = boundedClaude.report();
        dumpDirectorTrace('08-claude-budget', spend);
        warnings.push(`claude_budget:${spend.committedUsd.toFixed(4)}/${spend.capUsd}`);
        if (spend.stoppedBy) {
          warnings.push('claude_budget_stopped');
        }
      }
      assertNoBillingBlock(input.strictAiDirection, 'motion_graphics');
      if (input.strictAiDirection) {
        enforceStrictMotion(true, assessStrictMotion(motion, {optionalIds: input.strictOptionalGraphicIds}), 'motion_graphics');
      }
      warnings.push(...motion.warnings);
      if (motion.suppressHookTitle) broll.hookTitle = ''; // WP10A: the designed open plate is the opening beat; the stack hook would paint over it
    }

    // --- Stage C2b: art-directed opening (opt-in) --------------------------------
    let openingSpec: Awaited<ReturnType<typeof resolveOpening>>['spec'] = null;
    let openingReport: OpeningReport | null = null;
    let openingBehindSubject: Awaited<ReturnType<typeof resolveOpening>>['behindSubject'];
    if (broll.openingRaw?.openingPlan) {
      const hookSec = Math.max(1.5, broll.hookDurationSec || 3);
      const resolved = await resolveOpening({
        plan: broll.openingRaw.openingPlan,
        colorDirection: broll.openingRaw.colorDirection,
        transcript: transcription.transcript,
        durationSec: timeline.outputDurationSec,
        hookDurationSec: hookSec,
        ...speakerForMotion(occupancy), // WP3O: the real box for a face; no box and "unknown" for an unmeasured one
        matteUsable: matteExpected(),
        measure: box => measureOver(box, {start: 0, end: hookSec}),
      });
      openingSpec = resolved.spec;
      openingReport = resolved.report;
      openingBehindSubject = resolved.behindSubject;
      warnings.push(resolved.report.accepted ? `opening_treatment:${resolved.report.delivered}` : `opening_rejected:${resolved.report.rejection}`);
      dumpDirectorTrace('01c-opening-resolution', {report: resolved.report, spec: resolved.spec, behindSubject: resolved.behindSubject ?? null, colorRoles});
    }

    // --- Stage C3: art direction, shared conflict validation, ledger ------------
    const hookAnchor = northStar && broll.northStarHookAnchor ? broll.northStarHookAnchor : layoutHookAnchor;
    // WP2B: legibility of the shipped edit, product `mvp` profile only (never caption-only mode, never the legacy profile). Runs BEFORE the shared conflict validator so
    // it validates the hook band and caption position that are actually drawn, and every text removal is recorded in the ledger (no silent reconciliation gap).
    let legibility: LegibilitySpec | undefined;
    let legibleHookRect: {x: number; y: number; w: number; h: number} | undefined;
    if (mvpLike && !captionsOnly) {
      const legible = applyLegibility({
        hookTitle: broll.hookTitle,
        canvasWidth: OUTPUT_WIDTH,
        canvasHeight: OUTPUT_HEIGHT,
        speakerTopFrac: occupancy.speaker.y,
        speakerSource: occupancy.source,
        caption: broll.caption,
        motionGraphics: broll.motionGraphics ?? [],
        semanticEmphasis: broll.semanticEmphasis ?? [],
        transcript: transcription.transcript,
      });
      for (const item of legible.droppedText) {
        const id = ledgerIdOf(item);
        if (id && ledger.get(id)) {
          ledger.drop(id, 'plan_assembly', 'ungrounded_text');
        }
      }
      // WP3S: the other words a viewer can read are held to the same rule as the motion graphics above (the hook title is not filtered).
      if (motion) {
        const grounded = dropUngroundedGeneratedGraphics(motion.generatedGraphics, transcription.transcript);
        // WP3T: copy that is not in props.content (a headline baked into the component's TSX, a toolkit text treatment's words) is held to the same rule. The worker's validation does not look at it.
        const baked = dropGraphicsWithBakedText(
          grounded.kept,
          new Map((motion.worker?.results ?? []).map(result => [result.id, result.source])),
          new Map((motion.director?.graphics ?? []).map(directed => [directed.brief.id, directed.brief])),
          transcription.transcript,
        );
        for (const { graphic } of baked.dropped) {
          const entry = ledger.findByLabel('generated_graphic', graphic.id, graphic.start);
          if (entry) {
            ledger.drop(entry.id, 'plan_assembly', 'ungrounded_text');
          }
        }
        grounded.kept = baked.kept;
        if (baked.dropped.length > 0) warnings.push(`legibility:baked_graphic_text_dropped:${baked.dropped.length}`);
        const behind = dropUngroundedBehindSubject(motion.behindSubjectTexts, transcription.transcript);
        for (const graphic of grounded.dropped) {
          const entry = ledger.findByLabel('generated_graphic', graphic.id, graphic.start);
          if (entry) {
            ledger.drop(entry.id, 'plan_assembly', 'ungrounded_text');
          }
        }
        for (const text of behind.dropped) {
          const entry = ledger.find('generated_graphic', text.start, 0.001);
          if (entry) {
            ledger.drop(entry.id, 'plan_assembly', 'ungrounded_text');
          }
        }
        if (grounded.dropped.length > 0 || baked.dropped.length > 0 || behind.dropped.length > 0) {
          motion = {...motion, generatedGraphics: grounded.kept, behindSubjectTexts: behind.kept};
          if (grounded.dropped.length > 0) warnings.push(`legibility:ungrounded_generated_graphics_dropped:${grounded.dropped.length}`);
          if (behind.dropped.length > 0) warnings.push(`legibility:ungrounded_behind_subject_text_dropped:${behind.dropped.length}`);
        }
      }
      const overlayText = groundOverlayText(broll.overlays, transcription.transcript, captionWords);
      for (const overlay of overlayText.dropped) {
        const id = ledgerIdOf(overlay);
        if (id && ledger.get(id)) {
          ledger.drop(id, 'plan_assembly', 'ungrounded_text');
        }
      }
      broll.overlays = overlayText.overlays;
      if (overlayText.dropped.length > 0) warnings.push(`legibility:ungrounded_overlay_dropped:${overlayText.dropped.length}`);
      if (overlayText.cleared.length > 0) warnings.push(`legibility:ungrounded_overlay_text_cleared:${overlayText.cleared.length}`);
      if (overlayText.contextMismatched && overlayText.contextMismatched.length > 0) {
        warnings.push(`legibility:context_mismatch_dropped:${overlayText.contextMismatched.length}`);
      }
      // WP4G: a media container's canvas title and an inset graphic's text / stat label are held to the same rule. Nothing is dropped (the container and the reveal stay, with their times and colours), so there is no ledger entry.
      const canvasTitles = groundCanvasTitles(broll.mediaContainers ?? [], transcription.transcript);
      broll.mediaContainers = canvasTitles.containers;
      if (canvasTitles.cleared.length > 0) warnings.push(`legibility:ungrounded_canvas_title_cleared:${canvasTitles.cleared.length}`);
      const insetText = groundInsetText(broll.insetReveals ?? [], transcription.transcript);
      broll.insetReveals = insetText.insetReveals;
      if (insetText.cleared.length > 0) warnings.push(`legibility:ungrounded_inset_text_cleared:${insetText.cleared.length}`);
      if (!openingSpec) {
        broll.hookTitle = legible.hookTitle; // an art-directed opening replaces the standard hook, so the hook text is left alone then
      }
      broll.caption = legible.caption;
      broll.motionGraphics = legible.motionGraphics;
      broll.semanticEmphasis = legible.semanticEmphasis;
      legibility = openingSpec ? {...legible.legibility, hook: undefined} : legible.legibility;
      const fit = legibility.hook;
      if (fit && !openingSpec) {
        legibleHookRect = {x: (1 - fit.widthFrac) / 2, y: fit.topFrac, w: fit.widthFrac, h: fit.heightFrac};
      }
      warnings.push(...legible.warnings);
    }
    // --- Phase C: the person matte for the Director's elements (text behind the speaker, depth overlays, the cutout layout) -----------------------------------------------------------------------------
    // Planning only EXPECTED a matte. Now that the windows are known (B-roll plan + motion Director + opening) and before finalizeEdits, the asset is obtained: a chroma key when the backdrop is keyable (and its
    // alpha passes a sanity check), otherwise RVM over just the merged windows, trimmed to the matted-footage budget (cached; shared RVM slot). What the asset cannot draw is dropped and reported: no asset, no
    // behind-subject element. A provided cutout is already the asset (full coverage).
    let personCoverage: MatteCoverage | undefined;
    let personMatteSec = 0;
    let behindForFinalize = [...(motion?.behindSubjectTexts ?? [])];
    let openingBehindForFinalize = openingBehindSubject;
    // --- SUBJECT STAGE (style subject_stage, POLISH_SUBJECT_STAGE; default OFF) ------------------------------------------------------------------------------------------------------------------------------
    // Same outer gate as kinetic-led (polish profile + motion templates + the motion stage) and talking-head polish only. The stage needs the person over the WHOLE run (provided cutout | chroma | RVM on mps / cuda, or CPU
    // for <= 45 s); without a usable matte it stays OFF and every field below is exactly what it was. When it runs it owns "behind the speaker": text-behind, depth overlays, inset reveals and the cutout layout are
    // cleared, and kinetic-led is forced off for the run (no hero behind her, no competing subjectForeground). Warnings: polish_subject_stage:on | off | skipped:<reason>.
    let subjectStagePayload: SubjectStageBlueprint | undefined;
    {
      const stage = await runSubjectStage({
        flag: env.POLISH_SUBJECT_STAGE,
        polishPath,
        motionTemplates: env.POLISH_MOTION_TEMPLATES,
        motionPresent: Boolean(motion),
        skillFlags: {faceless: env.POLISH_FACELESS_DOC, explainer: env.POLISH_EXPLAINER_SKILL, newsroom: env.POLISH_NEWSROOM_MG},
        durationSec: timeline.outputDurationSec,
        rvmConfigured: subjectMatteConfigured(),
        rvmDevice: env.RVM_DEVICE,
        keyable: speakerKeyable,
        providedCutout: Boolean(providedCutoutUrl),
        captionWords,
        keepSegments: timeline.keepSegments,
        activeSourcePath,
        ...(providedCutoutUrl ? {providedCutoutUrl} : {}),
        chromaPath: workspace.file('subject-stage-chroma.webm'),
        rvmPath: workspace.file('subject-stage-matte.webm'),
        deps: {
          rvmConfigured: subjectMatteConfigured(),
          extractChroma: async outputPath => {
            await extractSpeakerCutout({inputPath: activeSourcePath, outputPath, keyColor: resolvedCutout.keyColor, similarity: resolvedCutout.similarity, blend: resolvedCutout.blend});
          },
          probeAlpha: probeMeanAlpha,
          fileBytes: async path => (await statFile(path)).size,
          upload: (localPath, extension) => uploadSourceVideo(localPath, extension),
          extractRvm: extractSubjectMatte,
        },
      });
      warnings.push(...stage.warnings);
      if (stage.active && stage.payload) {
        subjectStagePayload = stage.payload;
        personMatteSec += stage.matteSec;
        if (env.POLISH_KINETIC_LED) warnings.push('polish_subject_stage:kinetic_led_yielded');
        const cleared = applySubjectStageExclusions({behind: behindForFinalize, opening: openingBehindSubject ?? null, depth: broll.depthOverlays ?? [], insetReveals: broll.insetReveals ?? [], overlays: broll.overlays});
        const ledgerDrop = (type: Parameters<typeof ledger.find>[0], start: number) => {
          const entry = ledger.find(type, start, 0.05);
          if (entry) ledger.drop(entry.id, 'plan_assembly', 'subject_stage');
        };
        for (const item of cleared.dropped.behind) ledgerDrop('behind_subject_text', item.start);
        for (const item of cleared.dropped.depth) ledgerDrop('depth_overlay', item.start);
        for (const item of cleared.dropped.insetReveals) ledgerDrop('inset_reveal', item.start);
        for (const item of cleared.dropped.cutouts) ledgerDrop('cutout', item.start);
        behindForFinalize = cleared.behind;
        if (motion) motion = {...motion, behindSubjectTexts: cleared.behind};
        if (cleared.openingDropped) openingBehindForFinalize = undefined; // `openingBehindSubject` stays set: the "no opening hook" check below still reports a missing title honestly
        broll.depthOverlays = cleared.depth;
        broll.insetReveals = cleared.insetReveals;
        broll.overlays = cleared.overlays;
        const droppedCount = cleared.dropped.behind.length + cleared.dropped.depth.length + cleared.dropped.insetReveals.length + cleared.dropped.cutouts.length + (cleared.openingDropped ? 1 : 0);
        if (droppedCount > 0) warnings.push(`subject_stage:excluded:${droppedCount}`);
      }
    }
    {
      const needs = collectMatteNeeds({
        openingBehind: openingBehindSubject ?? null,
        behindTexts: behindForFinalize,
        depthOverlays: polishPath ? broll.depthOverlays ?? [] : [], // a depth overlay alone only triggers an extraction on polish (as before)
        cutoutOverlays: broll.overlays.filter(overlay => overlay.layout === 'cutout'),
      });
      const outcome = providedCutoutUrl
        ? null
        : await obtainPersonMatte({
            needs,
            keyable: speakerKeyable,
            force: forceSpeakerCutout,
            keepSegments: timeline.keepSegments,
            activeSourcePath,
            chromaPath: workspace.file('speaker-cutout.webm'),
            rvmPath: workspace.file('person-matte.webm'),
            budgetSec: matteBudgetSecForDevice(env.RVM_DEVICE),
            deps: {
              rvmConfigured: subjectMatteConfigured(),
              extractChroma: async outputPath => {
                await extractSpeakerCutout({inputPath: activeSourcePath, outputPath, keyColor: resolvedCutout.keyColor, similarity: resolvedCutout.similarity, blend: resolvedCutout.blend});
              },
              probeAlpha: probeMeanAlpha,
              fileBytes: async path => (await statFile(path)).size,
              upload: (localPath, extension) => uploadSourceVideo(localPath, extension),
              extractRvm: extractSubjectMatte,
            },
          });
      if (outcome) {
        warnings.push(...outcome.warnings);
        if (outcome.videoUrl) resolvedCutout = {...resolvedCutout, available: true, videoUrl: outcome.videoUrl};
        if (outcome.source === 'rvm') {
          personCoverage = outcome.coverage ?? undefined;
          personMatteSec = outcome.matteSec;
        }
      }
      const coverage: MatteCoverage | null = outcome ? outcome.coverage : {kind: 'all'};
      const reconciled = reconcileDirectorElements({behind: behindForFinalize, opening: openingBehindSubject ?? null, depth: broll.depthOverlays ?? [], cutouts: broll.overlays.filter(overlay => overlay.layout === 'cutout'), coverage});
      const dropFromLedger = (type: Parameters<typeof ledger.find>[0], start: number) => {
        const entry = ledger.find(type, start, 0.05);
        if (entry) ledger.drop(entry.id, 'plan_assembly', reconciled.why);
      };
      for (const item of reconciled.behind.dropped) dropFromLedger('behind_subject_text', item.start);
      for (const item of reconciled.depth.dropped) dropFromLedger('depth_overlay', item.start);
      for (const item of reconciled.cutouts.dropped) dropFromLedger('cutout', item.start);
      if (reconciled.behind.dropped.length > 0) {
        behindForFinalize = reconciled.behind.kept;
        if (motion) motion = {...motion, behindSubjectTexts: reconciled.behind.kept};
      }
      if (reconciled.openingDropped) openingBehindForFinalize = undefined; // `openingBehindSubject` stays set, so the "no opening hook" check below still reports the missing title honestly
      if (reconciled.depth.dropped.length > 0) broll.depthOverlays = reconciled.depth.kept;
      if (reconciled.cutouts.dropped.length > 0) {
        const droppedCutouts = new Set<unknown>(reconciled.cutouts.dropped);
        broll.overlays = broll.overlays.filter(overlay => !droppedCutouts.has(overlay));
      }
      warnings.push(...reconciled.warnings);
      // WP8C final gate (same wording as before): reported only when it differs from the planning answer.
      if (matteOccupancyCtx) {
        const finalMatte = decideMatteGate({occupancy: matteOccupancyCtx, cutout: {available: matteExpected()}, extract: {attempted: Boolean(outcome?.attempted), videoUrl: resolvedCutout.videoUrl}});
        if (mvpLike && finalMatte.reason !== planningMatteReason) warnings.push(matteGateWarning(finalMatte));
      }
      if (mvpLike && reconciled.textBehindSkipped) warnings.push(TEXT_BEHIND_SKIPPED_WARNING);
      // the blueprint must not claim a usable matte that was only EXPECTED while planning; a keyable backdrop keeps its old meaning of `available`
      resolvedCutout = {...resolvedCutout, available: speakerKeyable || Boolean(resolvedCutout.videoUrl)};
    }
    const finalized = finalizeEdits({
      ledger,
      contentProfile,
      existingDesign: broll.northStarDesign,
      ...(directorDesign ? {directorDesign} : {}),
      footageLuminance: palette.luminance,
      captionLocked: Boolean(captionGuide),
      durationSec: timeline.outputDurationSec,
      hook: {
        text: broll.hookTitle,
        start: broll.hookStartSec ?? 0,
        end: (broll.hookStartSec ?? 0) + Math.max(1.2, broll.hookDurationSec || 0),
        anchor: hookAnchor,
      },
      // The opening's drawn box (not the legacy corner slot) and any behind-subject text take part in conflict validation.
      ...(openingSpec
        ? {opening: {start: openingSpec.startSec, end: openingSpec.startSec + openingSpec.durationSec, rect: openingRect(openingSpec)}}
        : legibleHookRect
          ? {opening: {start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + Math.max(1.2, broll.hookDurationSec || 0), rect: legibleHookRect}}
          : {}),
      behindSubjectTexts: [...behindForFinalize, ...(openingBehindForFinalize ? [openingBehindForFinalize] : [])],
      caption: broll.caption,
      brollClips: broll.clips,
      visualOverlays: broll.overlays,
      insetReveals: broll.insetReveals ?? [],
      frameInsets: broll.frameInsets ?? [],
      mediaContainers: broll.mediaContainers ?? [],
      motionGraphics: broll.motionGraphics ?? [],
      semanticEmphasis: broll.semanticEmphasis ?? [],
      depthOverlays: resolvedCutout.videoUrl ? broll.depthOverlays ?? [] : [],
      transitions: broll.transitions,
      zoomTriggers,
      generatedGraphics: motion?.generatedGraphics ?? [],
      speaker: {box: occupancy.speaker, source: occupancy.source},
      speakerCutout: resolvedCutout,
    });
    broll.caption = finalized.caption;
    broll.motionGraphics = finalized.motionGraphics;
    broll.semanticEmphasis = finalized.semanticEmphasis;
    if (legibility) {
      // The shared palette step (finalizeEdits) may recolour text, so the contrast guarantees are re-applied to its result. Recolouring never changes an edit's count or timing.
      broll.caption = legibleCaption(broll.caption).caption;
      legibility = {...legibility, captions: captionSplitSpec(broll.caption)}; // the palette step may have changed the highlight colour
      const hold = captionSplitHold(OUTPUT_FPS);
      if ('frames' in hold) {
        legibility = {...legibility, captions: {...legibility.captions, splitHoldFrames: hold.frames}};
      } else {
        warnings.push(`legibility:${hold.skipped}`);
      }
      const text = legibleOnScreenText({motionGraphics: broll.motionGraphics, semanticEmphasis: broll.semanticEmphasis});
      broll.motionGraphics = text.motionGraphics;
      broll.semanticEmphasis = text.semanticEmphasis;
      if (text.recolored > 0) {
        warnings.push(`legibility:text_recolored:${text.recolored}`);
      }
      // WP4W/WP4X/WP5C: name the state where the first seconds show no title: no opening treatment spec, no behind-subject opening that SURVIVED the shared validator
      // (finalized.behindSubjectTexts), and the hook title that is written on the blueprint is empty. Computed after finalizeEdits so a later removal is seen. Nothing is invented.
      const survivedBehind = survivingOpeningBehindSubject(openingBehindSubject, finalized.behindSubjectTexts);
      const noOpeningHook = absentOpeningHookWarning(openingIsPresent(openingSpec, survivedBehind), broll.hookTitle);
      if (noOpeningHook) warnings.push(noOpeningHook);
    }
    broll.frameInsets = finalized.frameInsets;
    broll.mediaContainers = finalized.mediaContainers;
    if (motion) {
      motion = {...motion, generatedGraphics: finalized.generatedGraphics};
    }
    if (input.strictAiDirection && motion) {
      // Second look, after the conflict validator: a graphic that survived the stage but not the plan, or a ledger that disagrees with the blueprint, is a failed run.
      const assessment = enforceStrictMotion(
        true,
        assessStrictMotion(motion, {
          optionalIds: input.strictOptionalGraphicIds,
          final: {generatedGraphicIds: new Set(finalized.generatedGraphics.map(graphic => graphic.id)), behindSubjectTexts: finalized.behindSubjectTexts},
          ledger,
        }),
        'conflict_validator',
      );
      warnings.push(...strictDegradedWarnings(assessment));
    }
    for (const decision of finalized.decisions) {
      if (decision.action !== 'keep') {
        warnings.push(`edit_conflict:${decision.id}:${decision.action}:${decision.reason ?? 'none'}`);
      }
    }
    dumpDirectorTrace('06-edit-ledger', ledger.toJSON());
    // One explicit outcome per planned cutaway (pipeline evidence, not rendered-frame evidence). Empty when the plan had none.
    const editOutcomes = summarizeEditOutcomes(ledger.entries(), {
      scheduling: env.CUTAWAY_SCHEDULING,
      parseRejections: broll.parseRejections,
      fallbackSubstitutions: broll.fallbackSubstitutions,
      directorFallbackReason: broll.directorFallbackReason,
    });
    dumpDirectorTrace('07-edit-outcomes', editOutcomes);

    // --- Stage D ------------------------------------------------------------
    const resolvedLanguage = resolveLanguageCode(
      input.languageCode,
      transcription.detectedLanguage,
    );

    // Dual-write of the shared design object (preferred key + legacy key, same object); nothing is written when there is no design.
    const designFields = designFieldsForBlueprint(finalized.design);
    if (designFields.warning) {
      warnings.push(designFields.warning);
    }
    // WP3C: when this job runs under a Gemini request cap, say how many attempts it used and whether it stopped (counts and stage labels only).
    const geminiBudget = currentGeminiBudget();
    if (geminiBudget) {
      const spend = geminiBudget.report();
      dumpDirectorTrace('09-gemini-budget', spend);
      warnings.push(`gemini_budget:${spend.attempted}/${spend.maxRequests}`);
      if (spend.stopped) {
        warnings.push(`gemini_budget_stopped:${spend.refused}_refused`);
      }
    }
    // WP3B (mvp profile only): record which supplied asset each placed creator item shows. Recording only: no selection, timing or pixel changes.
    if (mvpLike && userAssetIdByUrl) {
      const stamped = stampUserBrollIds({clips: broll.clips, overlays: broll.overlays, depthOverlays: broll.depthOverlays ?? [], idByUrl: userAssetIdByUrl});
      if (stamped.unmatched > 0) {
        warnings.push(`user_broll_id_unrecorded:${stamped.unmatched}`);
      }
    }
    // WP12A: one highlighter colour per polish explain edit: the karaoke highlight takes the accent of the same short-form look the plates are drawn in.
    if (polishPath && motion && !input.captionTemplate && !(input.userBrollUrls ?? []).some(url => url.trim())) {
      const lookTheme = (colorRoles ? motionThemeFromRoles(colorRoles.roles) : contentProfile?.theme) as Record<string, unknown> | undefined;
      const themeLook = pickShortFormLookId(lookTheme ?? {});
      // WP48: sales / edu / energetic content prefers CapCut-style lime over warm amber from the footage theme
      const biased = preferVideoEditLook(themeLook, contentProfile);
      const lookId = biased ?? themeLook;
      // WP13C: the look's TYPE contract replaces the neon-fill / glowing-pill treatment: ink fill (or ink on a marker bar for paper_lime) with a heavy dark stroke, no coloured glow.
      const type = LOOK_CAPTION_TYPE[lookId];
      broll.caption = {
        ...broll.caption,
        textColor: type.textColor,
        highlightColor: type.highlightColor,
        strokeColor: type.strokeColor,
        strokeWidthEm: type.strokeWidthEm,
        glow: type.glow,
        activeStyle: type.activeStyle,
        ...(type.activeInk ? {activeInk: type.activeInk} : {}),
      };
      warnings.push(`look:palette:${lookId}`, `look:caption_type:${lookId}`);
      if (biased) warnings.push(`look:palette_bias:video_edit_lime:${themeLook}->${lookId}`);
    }
    // WP31: the one switch that keeps glossy-pill karaoke off polish. The WP12A/13C block above only fires on explain edits with no creator B-roll and no caller template, so WP28 (labeled assets) shipped
    // the shine pill. This runs on EVERY polish edit: plate-style templates (moving-pill, box, grape, ...) become the bare `karaoke` type, the box colour is cleared and the look's stroke + soft-shadow
    // contract is written wherever the direction would otherwise draw the shine plate. Idempotent after the block above. Skipped for CaptionKit presets and designed caption style guides (their own look).
    if (polishPath && env.POLISH_BARE_CAPTIONS && !(input.captionPreset || '').trim() && !captionGuide) {
      const bareTheme = (colorRoles ? motionThemeFromRoles(colorRoles.roles) : contentProfile?.theme) as Record<string, unknown> | undefined;
      const themeLook = pickShortFormLookId(bareTheme ?? {});
      const bareLook = preferVideoEditLook(themeLook, contentProfile) ?? themeLook;
      const bare = polishBareCaption(broll.caption, {lookId: bareLook, templateLocked: Boolean(input.captionTemplate)});
      broll.caption = bare.caption;
      warnings.push(...bare.warnings);
    }
    // WP34: the Metromedia ACCUMULATE caption grammar on top of the bare type: words build up with a blur-fade and the line hard-clears on the WP33 cut that starts the next group. Needs the VO cut plan; polish
    // only; CaptionKit presets, designed caption style guides and caller-named templates keep their own captions. Kill switch POLISH_ACCUMULATE_CAPTIONS=0.
    if (polishPath && env.POLISH_ACCUMULATE_CAPTIONS && voGrammar && !(input.captionPreset || '').trim() && !captionGuide && !input.captionTemplate) {
      const accumulate = polishAccumulateCaptions(broll.caption, {plan: voGrammar, words: captionWords, durationSec: timeline.outputDurationSec});
      broll.caption = accumulate.caption;
      warnings.push(...accumulate.warnings);
    }
    // WP38: CLASSIC talking-head polish (neither the faceless lane nor the explainer skill on) keeps the face primary and borrows the Skill A tools: the cut plan, the accumulate captions and the impact FX above (each on its
    // own flag) plus tighter editorial stills below. The one caption change: the accumulate line moves to the face-safe band (y ~58 %). POLISH_TH_SKILL_A_TOOLS=0 = the pre-WP38 polish. Faceless / explainer never read this.
    const thSkillA = resolveTalkingHeadSkillA({polish: Boolean(polishPath), skillAToolsEnabled: env.POLISH_TH_SKILL_A_TOOLS, faceless: env.POLISH_FACELESS_DOC, explainer: env.POLISH_EXPLAINER_SKILL});
    if (thSkillA) {
      const faceSafe = talkingHeadCaption(broll.caption);
      broll.caption = faceSafe.caption;
      warnings.push(...faceSafe.warnings);
    }
    // WP35: the Metromedia impact FX (polish only, POLISH_IMPACT_FX; needs the WP33 plan for the cuts / holds): hook / reveal flash, name saturation pop, money punch-in, emotional B&W spans. Pure plan; the renderer paints it.
    const impactFx = polishPath && env.POLISH_IMPACT_FX && voGrammar ? planImpactFx({words: captionWords, plan: voGrammar, durationSec: timeline.outputDurationSec}) : null;
    if (impactFx) warnings.push(...impactFx.warnings);
    // WP13B: grade-flip face beats survive only where the talking head is what is on screen (no cutaway, split, overlay cover, media container or full / split plate over them).
    const gradeBeats = polishPath
      ? (broll.gradeBeats ?? [])
          .filter(beat => ![
            ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
            ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
            ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
            ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
          ].some(other => beat.start < other.end && beat.end > other.start))
          .map(beat => ({startSec: beat.start, endSec: beat.end}))
      : [];
    // WP15: contextual KLIPY GIF/sticker overlays on polish (context phrases from speech, not bare stock keywords).
    let imageRunCuts: number[] = []; // WP22: visual changes inside the image runs (mid-run pops of a long logo cloud get a transition)
    let editorialRunWindows: Array<{start: number; end: number}> = []; // WP30: published editorial still runs (anchors for the WP16 transition density)
    const templateStillUrls: string[] = []; // WP48: https stills for motion-template personalization
    let assetBrief = polishPath
      ? buildLabeledAssetBrief({
          words: captionWords,
          outputDurationSec: timeline.outputDurationSec,
        })
      : undefined;
    if (polishPath) {
      const klipy = await planKlipyOverlays({
        words: captionWords,
        outputDurationSec: timeline.outputDurationSec,
        contentType: contentProfile?.contentType,
        existingOverlays: broll.overlays,
        blockedRanges: [
          ...(motion?.generatedGraphics ?? [])
            .filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen')
            .map(graphic => ({start: graphic.start, end: graphic.end})),
        ],
        customerId: input.userId,
      });
      warnings.push(...klipy.warnings);
      if (klipy.overlays.length > 0) {
        broll.overlays = [...broll.overlays, ...klipy.overlays];
      }
      if (assetBrief && assetBrief.slots.length > 0) {
        const bindings = input.labeledAssetBindings ?? [];
        if (bindings.length > 0) {
          // userAssetIdByUrl is set on mvp/polish after describeUserBrollAssets.
          assetBrief = applyLabeledAssetBindings(
            assetBrief,
            bindings,
            userAssetIdByUrl,
          );
          const bound = assetBrief.slots.filter(slot => slot.status === 'uploaded').length;
          warnings.push(`asset_brief:bound:${bound}`);
        }
        warnings.push(`asset_brief:slots:${assetBrief.slots.length}`);
        dumpDirectorTrace('10-asset-brief', assetBrief);
      } else {
        assetBrief = undefined;
      }
    }
    // WP18: the bound labeled assets (the mobile upload loop) become overlays: logos / people / screenshots / products as pips and cards, nearby stills as one image run. Unresolved or skipped slots place nothing.
    if (polishPath && assetBrief && userAssetIdByUrl && assetBrief.slots.some(slot => slot.status === 'uploaded')) {
      const urlById = new Map([...userAssetIdByUrl].map(([url, id]) => [id, {url, mediaKind: mediaKindOfUrl(url), ...(solidUserUrls.has(url) ? {solidLike: true} : {})}] as const));
      const placement = planLabeledAssetPlacements({
        brief: assetBrief,
        assets: urlById,
        outputDurationSec: timeline.outputDurationSec,
        blockedRanges: [
          ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
          ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
          ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
          ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
        ],
      });
      let placedOverlays = placement.overlays;
      imageRunCuts = placement.runs.filter(run => run.mode === 'logo_cloud').flatMap(run => run.cutAts);
      // WP18B: each cluster is published as a real ImageRun graphic and replaces the slideshow overlay that stands in for it; a run that cannot be published keeps its slideshow (never a double cover, never a crash).
      if (placement.runs.length > 0) {
        let fallback = placement.runs.length;
        if (motion) {
          try {
            const {published} = await publishImageRuns(placement.runs, {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined});
            if (published.length > 0) {
              const replaced = new Set(published.map(item => item.overlayIntent));
              placedOverlays = placedOverlays.filter(overlay => !replaced.has(overlay.intent ?? ''));
              motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...published.map(item => item.graphic)].sort((a, b) => a.start - b.start)};
              warnings.push(`polish_assets:imagerun_published:${published.length}`);
            }
            fallback = placement.runs.length - published.length;
          } catch (error) {
            log.warn({error}, 'image run publish failed; keeping the slideshow overlays');
          }
        }
        if (fallback > 0) warnings.push(`polish_assets:imagerun_fallback:${fallback}`);
      }
      if (placedOverlays.length > 0) broll.overlays = [...broll.overlays, ...placedOverlays];
      warnings.push(...labeledAssetWarnings(placement));
    }
    // WP36: FACELESS DOCUMENTARY LANE (opt-in, POLISH_FACELESS_DOC=1; default off, so talking-head polish is unchanged): the talking head is not the world. One literal stock still per WP33 cut-plan shot
    // (hard cuts, push-in, ~15 % framed fly-out cards) covers ~100 % of the runtime; chapter cards stay on their own span. It REPLACES the WP30 montage (below), runs after the WP33 plan (the clock) and before
    // the WP34 captions / WP35 FX paint over it (those are planned from the same cut plan). A run that cannot be published places nothing (the talking head would show there; the coverage warning says so).
    const facelessDoc = Boolean(polishPath && env.POLISH_FACELESS_DOC && voGrammar && motion && stockConfigured());
    if (polishPath && env.POLISH_FACELESS_DOC && !facelessDoc) warnings.push(`polish_pace:faceless_skipped:${!voGrammar ? 'no_cut_plan' : !motion ? 'no_motion' : 'no_stock'}`);
    // WP40/44: polish skill lane. Priority faceless (A) > newsroom_mg (D) > explainer (B) > default. WP42 mounts Skill B into ShortVideo; WP44 plans Skill D + content-aware editPalette.
    let explainerMount: ExplainerMountPlan | null = null;
    let newsroomLayoutTrack: Array<{start: number; end: number; layout: 'newsroom_gfx' | 'newsroom_card' | 'newsroom_host' | 'newsroom_expert'}> | null = null;
    let editPalette: EditPalette | null = null;
    const polishSkill = resolvePolishSkill({
      faceless: Boolean(polishPath && env.POLISH_FACELESS_DOC),
      explainer: Boolean(polishPath && env.POLISH_EXPLAINER_SKILL),
      newsroom: Boolean(polishPath && env.POLISH_NEWSROOM_MG),
    });
    warnings.push(...polishSkill.warnings);
    if (polishSkill.skill === 'newsroom_mg') {
      const pacing = planNewsroomMgPacing({durationSec: timeline.outputDurationSec, words: captionWords});
      warnings.push(...pacing.warnings);
      newsroomLayoutTrack = pacing.segments.map(s => ({start: s.start, end: s.end, layout: s.layout}));
      {
        const directed = directEditColors({skill: 'newsroom_mg', words: captionWords});
        editPalette = directed.palette;
        warnings.push(`polish_palette:${editPalette.id}:${editPalette.accent}`, directed.warning);
      }
      // Captions: Skill D uses thin white chunk-swap at y~74% without stroke (reuse chunk_swap; stroke off via caption direction when no preset)
      if (!(input.captionPreset || '').trim() && !captionGuide && !input.captionTemplate) {
        const explainerCaptions = polishExplainerCaptions(broll.caption, {
          layoutTrack: pacing.segments.map(s => ({
            start: s.start,
            end: s.end,
            layout: s.layout === 'newsroom_host' ? 'explainer_a' : 'explainer_c',
          })),
        });
        // Newsroom captions: no thick stroke (grammar: stroke none)
        broll.caption = {
          ...explainerCaptions.caption,
          strokeWidthEm: 0,
          strokeColor: undefined,
          yTrack: explainerCaptions.caption.yTrack?.map(row => ({...row, yFrac: 0.74})) ?? [{start: 0, end: timeline.outputDurationSec, yFrac: 0.74}],
        };
        warnings.push(...explainerCaptions.warnings);
        warnings.push('polish_newsroom_captions:chunk_swap_thin');
      }
    }
    if (polishSkill.skill === 'explainer') {
      const pacing = planExplainerPacing({durationSec: timeline.outputDurationSec, words: captionWords});
      warnings.push(...pacing.warnings);
      // WP41: claim -> visual (a number / name / amount gets a visual within 0.5 s: a B / C / D segment already on screen or a short article beat) + the Skill B chunk-swap captions, y by the resulting layout
      // track. Replaces the accumulate captions (Skill A's grammar) for this edit; CaptionKit presets, designed caption style guides and caller-named templates keep their own captions. Plan + direction only.
      const claimPlan = planClaimVisuals({segments: pacing.segments, words: captionWords});
      warnings.push(...claimPlan.warnings);
      // WP37: noun-locked stock queries for the claim beats (a number / amount / name gets a picture of the noun, never a loose scene); planned + reported only, like the beats themselves
      warnings.push(...claimBeatQueries(claimPlan, captionWords).warnings);
      if (!(input.captionPreset || '').trim() && !captionGuide && !input.captionTemplate) {
        const explainerCaptions = polishExplainerCaptions(broll.caption, {layoutTrack: claimPlan.layoutTrack});
        broll.caption = explainerCaptions.caption;
        warnings.push(...explainerCaptions.warnings);
      }
      // WP42: MOUNT. The layout track + claim beats go into the blueprint; the B / C / D media is placed best-effort (noun-locked stock stills, else a text plate) as `cutaway` overlays tagged `intent: explainer_*`.
      // A clip too short for any B / C / D span keeps the classic polish picture (nothing mounted).
      const mount = planExplainerMount({claimPlan, words: captionWords, durationSec: timeline.outputDurationSec});
      if (mount.layoutTrack.some(span => span.layout !== 'explainer_a')) {
        explainerMount = mount;
        warnings.push(...mount.warnings);
        const media = await placeExplainerMedia({
          slots: mount.slots,
          resolver: stockConfigured() ? explainerStockResolver(findPhotoAsset) : null,
        });
        broll.overlays = [...broll.overlays, ...media.overlays];
        warnings.push(...media.warnings);
      } else {
        warnings.push('polish_explainer_mounted:skipped:no_layouts');
      }
      // WP44 / WP56: Color Director — editorial paper default; finance/news may pick signal red
      {
        const directed = directEditColors({skill: 'explainer', words: captionWords, videoEdit: true});
        editPalette = directed.palette;
        warnings.push(`polish_palette:${editPalette.id}:${editPalette.accent}`, directed.warning);
      }
    }
    // WP48 / WP56: default / faceless polish via Color Director (paper editorial; no neon lime video_edit_force)
    if (polishPath && !editPalette) {
      const videoEditForce =
        Boolean(contentProfile) &&
        (['sales_pitch', 'educational_tips', 'tutorial', 'announcement'].includes(contentProfile!.contentType) ||
          ['bold_energetic', 'tech_sharp', 'clean_light'].includes(contentProfile!.mood));
      const directed = directEditColors({
        skill: polishSkill.skill === 'faceless' ? 'faceless' : 'default',
        words: captionWords,
        videoEdit: true,
        // WP56: force preferred = editorial_paper / clean_mono, never neon lime
        ...(videoEditForce ? {forcePreferred: true} : {}),
      });
      editPalette = directed.palette;
      warnings.push(`polish_palette:${editPalette.id}:${editPalette.accent}${videoEditForce ? ':video_edit_force' : ''}`, directed.warning);
    }
    if (facelessDoc && voGrammar && motion) {
      try {
        // portrait photos: ~85 % of the shots are full-bleed in the 9:16 frame (the framed cards cover-crop a portrait photo too)
        const lane = await planFacelessDocLane({
          plan: voGrammar,
          words: captionWords,
          durationSec: timeline.outputDurationSec,
          blockedRanges: [
            ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
            ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
            ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
            ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
          ],
          // WP37: the photo's alt / tags / page slug travel with it so the noun-lock judge can refuse a still that is not a picture of the spoken noun
          resolver: async (query, options) => {
            const asset = await findPhotoAsset(query, {excludeKeys: options.excludeKeys, orientation: 'portrait'});
            return asset ? {assetUrl: asset.assetUrl, provider: asset.provider, providerId: asset.providerId, alt: asset.alt, tags: asset.tags, pageUrl: asset.pageUrl} : null;
          },
        });
        warnings.push(...lane.warnings);
        if (lane.runs.length > 0) {
          const {published, failed} = await publishImageRuns(lane.runs, {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined, idPrefix: 'faceless_run'});
          if (published.length > 0) {
            motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...published.map(item => item.graphic)].sort((a, b) => a.start - b.start)};
            editorialRunWindows = editorialRunRanges(published.map(item => item.run));
            for (const item of published) for (const still of item.run.items) if (/^https:\/\//i.test(still.src)) templateStillUrls.push(still.src);
            warnings.push(`polish_assets:faceless_published:${published.length}`);
          }
          if (failed.length > 0) warnings.push(`polish_assets:faceless_publish_failed:${failed.length}`);
        }
      } catch (error) {
        log.warn({error}, 'faceless documentary lane failed; continuing without it');
        warnings.push('polish_assets:faceless_failed');
      }
    }
    // WP30: when the labeled runs did not fill the open (or there are none), run editorial STOCK STILLS (Pexels / Pixabay photos that show the spoken claim) as an ImageRun with still_push_in / card_tilt_in / orbit_drift.
    // Published through the same ImageRun path; a miss or failure places nothing (never a solid, never a crash). The WP16 density below anchors on the run boundaries.
    let thStillCount = 0;
    let thStillSec = 0;
    if (polishPath && motion && !facelessDoc && env.POLISH_EDITORIAL_STILLS_ENABLED && stockConfigured()) {
      try {
        const stillBlocked = [
          ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
          ...broll.overlays
            .filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway' || (overlay.provider !== 'klipy' && (overlay.layout === 'card' || overlay.layout === 'pip' || overlay.layout === 'sticker')))
            .map(overlay => ({start: overlay.start, end: overlay.end})),
          ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
          ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
          // WP42: a mounted explainer edit owns the whole picture (its layout track tiles the runtime): no editorial still run is planned over it
          ...(explainerMount ? [{start: 0, end: timeline.outputDurationSec}] : []),
        ];
        const montage = await planEditorialStillMontage({
          words: captionWords,
          outputDurationSec: timeline.outputDurationSec,
          // WP38: tighter caps so the face stays primary (classic talking-head polish only); the full-frame beats already on screen come out of the same budget
          ...(thSkillA ? talkingHeadStillOptions(timeline.outputDurationSec, coveredFraction(0, timeline.outputDurationSec, stillBlocked) * timeline.outputDurationSec) : {}),
          blockedRanges: stillBlocked,
          // WP37: the photo's alt / tags / page slug travel with it so the noun-lock judge can refuse a still that is not a picture of the spoken noun
          resolver: async (query, options) => {
            const asset = await findPhotoAsset(query, {excludeKeys: options.excludeKeys, orientation: 'landscape'});
            return asset ? {assetUrl: asset.assetUrl, provider: asset.provider, providerId: asset.providerId, alt: asset.alt, tags: asset.tags, pageUrl: asset.pageUrl} : null;
          },
        });
        warnings.push(...montage.warnings);
        if (montage.runs.length > 0) {
          const {published, failed} = await publishImageRuns(montage.runs, {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined, idPrefix: 'editorial_run'});
          if (published.length > 0) {
            motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...published.map(item => item.graphic)].sort((a, b) => a.start - b.start)};
            editorialRunWindows = editorialRunRanges(published.map(item => item.run));
            for (const item of published) for (const still of item.run.items) if (/^https:\/\//i.test(still.src)) templateStillUrls.push(still.src);
            warnings.push(`polish_assets:editorial_published:${published.length}`);
            thStillCount = published.reduce((sum, item) => sum + item.run.items.length, 0);
            thStillSec = editorialRunWindows.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
          }
          if (failed.length > 0) warnings.push(`polish_assets:editorial_publish_failed:${failed.length}`);
        }
      } catch (error) {
        log.warn({error}, 'editorial still montage failed; continuing without it');
        warnings.push('polish_assets:editorial_failed');
      }
    }
    // WP38: the honest summary of what the Skill A tools did on this talking-head edit (a tool that did not fire says so; nothing here changes the edit)
    if (thSkillA) {
      warnings.push(...talkingHeadSkillAWarnings({
        cutPlanned: Boolean(voGrammar),
        cuts: voGrammar?.cuts.length ?? 0,
        chapterCards: voGrammar?.chapterCards.length ?? 0,
        accumulate: broll.caption.mode === 'word_by_word_accumulate',
        fx: impactFx ? {flashes: impactFx.fx.flashes.length, satPops: impactFx.fx.satPops.length, punchIns: impactFx.fx.punchIns.length, bwSpans: impactFx.fx.bwSpans.length} : null,
        stills: thStillCount,
        stillSec: thStillSec,
        durationSec: timeline.outputDurationSec,
      }));
    }
    // WP20: filler clip lane: 1-3 s cutaways of the creator's own videos (labeled broll_clip uploads first, other supplied videos second) in engagement windows no strong beat covers, with one centred word at most.
    if (polishPath && userAssetIdByUrl && userAssetIdByUrl.size > 0) {
      const boundVideoIds = new Set((assetBrief?.slots ?? []).filter(slot => slot.status === 'uploaded' && slot.kind === 'broll_clip' && slot.userAssetId).map(slot => slot.userAssetId!));
      const usedUrls = new Set([...broll.overlays.map(overlay => overlay.assetUrl), ...broll.clips.map(clip => clip.assetUrl)]);
      const videos = [...userAssetIdByUrl].map(([url, id]) => ({url, userAssetId: id, mediaKind: mediaKindOfUrl(url)})).filter(item => item.mediaKind === 'video');
      const sources = [...videos.filter(item => boundVideoIds.has(item.userAssetId)), ...videos.filter(item => !boundVideoIds.has(item.userAssetId) && !usedUrls.has(item.url))];
      const fullScreen = [
        ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
        ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
        ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
        ...broll.overlays.filter(overlay => overlay.layout === 'cutaway' || overlay.layout === 'split' || overlay.layout === 'composite').map(overlay => ({start: overlay.start, end: overlay.end})),
      ];
      const filler = planFillerClipLane({
        sources,
        outputDurationSec: timeline.outputDurationSec,
        coveredStarts: [
          ...fullScreen.map(range => range.start),
          ...broll.overlays.filter(overlay => overlay.layout !== 'chip' && overlay.layout !== 'banner').map(overlay => overlay.start),
        ],
        blockedRanges: fullScreen,
        overlayRanges: broll.overlays.map(overlay => ({start: overlay.start, end: overlay.end})),
        pipBlockedRanges: broll.overlays.filter(overlay => overlay.layout === 'pip' || overlay.layout === 'card' || overlay.layout === 'sticker').map(overlay => ({start: overlay.start, end: overlay.end})),
        words: captionWords,
      });
      if (filler.overlays.length > 0) {
        broll.overlays = [...broll.overlays, ...filler.overlays];
        if (filler.motionGraphics.length > 0) broll.motionGraphics = [...(broll.motionGraphics ?? []), ...filler.motionGraphics];
        warnings.push(...fillerWarnings(filler));
      }
    }
    // WP19: a text-plate-only open is flagged when the creator's labeled uploads or KLIPY stickers could cover that window (soft pressure; nothing is removed).
    if (polishPath && motion) {
      const compositionById = new Map((motion.worker?.provenance ?? []).map(item => [item.id, item.compositionId ?? '']));
      const mediaBeats = broll.overlays.filter(overlay => (overlay.provider === 'user' || overlay.provider === 'klipy') && overlay.mediaKind !== 'text').map(overlay => ({start: overlay.start, end: overlay.end}));
      const windows = textOnlyOpensWithMediaAvailable({
        graphics: motion.generatedGraphics.map(graphic => ({start: graphic.start, end: graphic.end, mode: graphic.placement.mode, compositionId: compositionById.get(graphic.id)})),
        mediaBeats,
        mediaUnder: [...broll.clips, ...(broll.mediaContainers ?? []), ...broll.overlays.filter(overlay => overlay.layout === 'cutaway' || overlay.layout === 'split' || overlay.layout === 'composite')].map(item => ({start: item.start, end: item.end})),
      });
      warnings.push(...preferMediaWarnings(windows));
    }
    // WP16: transition DENSITY on polish: a floor of procedural transitions (about one per 3.5 s), rotated, spaced, anchored on labeled-asset slot boundaries first, then media cuts, then sentence starts.
    if (polishPath) {
      const flashCardEnds = (motion?.worker?.provenance ?? []).filter(item => item.compositionId === 'FlashCard').flatMap(item => motion?.generatedGraphics.filter(graphic => graphic.id === item.id).map(graphic => graphic.end) ?? []);
      const chapterCardStarts = voGrammar
        ? (motion?.worker?.provenance ?? []).filter(item => item.compositionId === 'FlashCard').flatMap(item => motion?.generatedGraphics.filter(graphic => graphic.id === item.id).map(graphic => graphic.start) ?? []).filter(start => voGrammar.chapterCards.some(card => Math.abs(card.at - start) < 0.3))
        : [];
      const density = ensurePolishTransitionDensity({
        durationSec: timeline.outputDurationSec,
        existing: (broll.transitions ?? []).map(transition => ({at: transition.at, keyword: transition.keyword})),
        sentenceStarts: sentenceStartsOf(captionWords),
        cutTimes: [
          ...broll.clips.map(clip => clip.start),
          ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => overlay.start),
          ...(broll.mediaContainers ?? []).map(item => item.start),
          // WP17: the END of a flash card is a cut: the next world needs a whip / hard cut right after it, so it is a preferred anchor when the density floor still wants transitions
          ...(motion?.worker?.provenance ?? []).filter(item => item.compositionId === 'FlashCard').flatMap(item => motion?.generatedGraphics.filter(graphic => graphic.id === item.id).map(graphic => graphic.end) ?? []),
        ],
        assetSlotWindows: (assetBrief?.slots ?? []).map(slot => ({start: slot.startSec, end: slot.endSec})).concat(editorialRunWindows),
        // WP22: a flash card is always followed by a cut; a long logo cloud pops mid-run (both get a transition). WP30: a whip lands where each editorial still run starts.
        forcedCuts: [...flashCardEnds, ...imageRunCuts].concat(editorialRunWindows.map(window => window.start).filter(start => start >= 0.5)).concat(chapterCardStarts), // WP33: a PLACED chapter card's start is a cut (its end is already a flashCardEnds cut)
        ...(voGrammar ? {voCutTimes: voGrammar.cuts, preferHardCut: true} : {}), // WP33: the grammar's cut times are preferred anchors; the picker leans to hard cuts
        avoidWindows: zoomTriggers.map(zoom => ({start: zoom.start, end: zoom.end})),
      });
      if (density.added.length > 0) {
        broll.transitions = [...(broll.transitions ?? []), ...density.added.map((item, index) => densityTransitionClip(item, (broll.transitions ?? []).length + index))].sort((a, b) => a.at - b.at);
        warnings.push(`polish_pace:transitions:${density.added.length}`);
      }
    }
    // WP42: Skill B changes layouts with HARD cuts only. A mounted explainer edit carries no soft TransitionClip (no whip / blend / smash on a layout edge, none mid-span either), so ShortVideo's TransitionTrack stays empty.
    if (explainerMount) {
      const cleared = (broll.transitions ?? []).length;
      broll.transitions = [];
      warnings.push(`polish_explainer_mounted:transitions_cleared:${cleared}`);
    }
    // WP53: VISUAL BACKENDS inside the existing toolkits (opt-in POLISH_RISO_TEMPLATES / POLISH_COLLAGE_BROLL / POLISH_ANIDOODLE; all default off = nothing below runs). NOT a skill lane and not a new toolkit id: riso / collage / anidoodle
    // are HOW a counter / emphasis / kinetic_text / cutaway beat is drawn. Planned BEFORE the WP45 templates so the published spans become blocked ranges for CLIP_01..26. Analyze never renders (riso reads its cache, collage stays deferred,
    // anidoodle skips when unconfigured); a failure places nothing. Silent; a published frame-owning beat mutes the captions.
    let visualBackendMute: MuteRange[] = [];
    const visualBackendFlags = {riso: env.POLISH_RISO_TEMPLATES, collage: env.POLISH_COLLAGE_BROLL, anidoodle: env.POLISH_ANIDOODLE};
    if (polishPath && (visualBackendFlags.riso || visualBackendFlags.collage || visualBackendFlags.anidoodle)) {
      if (!motion) {
        warnings.push('visual_backend:skipped:no_motion');
      } else {
        try {
          const vbHookBlocked = broll.hookTitle && broll.hookDurationSec > 0 ? [{start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + broll.hookDurationSec}] : [];
          const vbInk =
            editPalette && (editPalette.groundStyle === 'paper_dot' || /^#fff/i.test(editPalette.ground))
              ? editPalette.inkOnAccent
              : editPalette?.text;
          const visualBackend = await runVisualBackendStage({
            polishSkill: polishSkill.skill,
            words: captionWords,
            durationSec: timeline.outputDurationSec,
            flags: visualBackendFlags,
            accent: editPalette?.accent,
            ground: editPalette?.ground,
            ink: vbInk,
            risoRoot: env.EIAN_RISO_ROOT,
            anidoodleRoot: env.ANIDOODLE_ENGINE_ROOT,
            blockedRanges: [
              ...vbHookBlocked,
              ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
              ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
              ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
              ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
              ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => ({start: span.start, end: span.end})) : []),
              ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => ({start: span.start, end: span.end})) : []),
            ],
            publish: {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined},
          });
          warnings.push(...visualBackend.warnings);
          if (visualBackend.graphics.length > 0) {
            motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...visualBackend.graphics].sort((a, b) => a.start - b.start)};
            visualBackendMute = visualBackend.muteRanges;
            // craft: a number the riso beat shows is never also a count / pop emphasis
            const covered = dropEmphasisCoveredByVisualBackend(broll.semanticEmphasis ?? [], visualBackend.beats.filter(beat => visualBackend.plannedRanges.some(range => range.start === beat.start)));
            if (covered.warnings.length > 0) {
              broll.semanticEmphasis = covered.kept;
              warnings.push(...covered.warnings);
            }
          }
        } catch (error) {
          log.warn({error}, 'visual backends failed; continuing without them');
          warnings.push('visual_backend:failed');
        }
      }
    }
    // WP54: NATIVE CRAFT TEMPLATES clip_35..44 (kinetic type / logo reveal / mesh ground / GATED product templates). Same single flag as WP45 (POLISH_MOTION_TEMPLATES=1; default off = nothing below runs). Not a skill lane and not a
    // toolkit id: sentence cues pick the move, the product gate keeps device / cursor / price templates at ZERO unless the profile is product / sales AND screenshots or a spoken price exist. Runs after the visual backends and BEFORE
    // the WP45 templates so its published full-screen spans block clip_23 and friends. Silent; only PUBLISHED frame-owning beats mute the captions. A failure places nothing.
    let craftTemplateMute: MuteRange[] = [];
    // WP55 phase 2: the person foreground the host draws above the kinetic type (set only when a hero beat really got a matte)
    let kineticForeground: KineticForeground | undefined;
    if (polishPath && env.POLISH_MOTION_TEMPLATES && motion) {
      try {
        const slotUrls = (kinds: string[], also: (slot: NonNullable<typeof assetBrief>['slots'][number]) => boolean = () => true) =>
          (assetBrief?.slots ?? [])
            .filter(slot => slot.status === 'uploaded' && kinds.includes(slot.kind) && slot.userAssetId && also(slot))
            .flatMap(slot => [...(userAssetIdByUrl ?? new Map<string, string>())].filter(([, id]) => id === slot.userAssetId).map(([url]) => url))
            .filter(url => /^https:\/\//i.test(url));
        const craftInk =
          editPalette && (editPalette.groundStyle === 'paper_dot' || /^#fff/i.test(editPalette.ground))
            ? editPalette.inkOnAccent
            : editPalette?.text;
        const craftHookBlocked = broll.hookTitle && broll.hookDurationSec > 0 ? [{start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + broll.hookDurationSec}] : [];
        const fullScreenNow = (motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen').length;
        // WP55 phase 2: REAL kinetic-type inputs. Brand / social data are creator-provided only (explicit brandName, uploaded logo slot label, uploaded stills labelled as the creator's own posts); the subject comes
        // from the measured occupancy box and, only when a hero beat would use it, a range-limited person matte (existing keyed cutout reused first). Every gap is reported, none is invented.
        const kineticBrandName = brandNameFor(input.brandName, assetBrief?.slots ?? []);
        const kineticSocialUrls = [...new Set(slotUrls(['screenshot', 'other'], slot => isSocialSlot(slot)))];
        const kineticSkill = mapPolishSkillToMotionTemplateSkill(polishSkill.skill);
        // WP56: only mark owned when the Director returned ≥1 candidate. Empty [] used to set owned:true and blocked all kinetic type.
        const kineticDirected =
          broll.kineticTypeDirected && broll.kineticTypeDirected.length > 0
            ? {candidates: broll.kineticTypeDirected, owned: true}
            : broll.kineticTypeDirected
              ? {candidates: broll.kineticTypeDirected, owned: false}
              : undefined;
        const kineticBlocked = [
          ...craftHookBlocked,
          ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
          ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
          ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
          ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
          ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => ({start: span.start, end: span.end})) : []),
          ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => ({start: span.start, end: span.end})) : []),
        ];
        const kineticYield = kineticInputsUnderStage(Boolean(subjectStagePayload), {kineticLed: env.POLISH_KINETIC_LED, segmentationConfigured: subjectMatteConfigured(), cutout: resolvedCutout}); // Subject Stage ON: kinetic-led off, no matte, no cutout to reuse
        const kineticLedStyle = kineticYield.kineticLed; // read once: the matte pre-plan below and the real craft plan must use the SAME planner settings
        // 20 s of matted footage (CPU / unknown device), 45 s on an explicit mps / cuda device, minus what the Director's elements already used
        const kineticMatteBudgetSec = Math.max(0, matteBudgetSecForDevice(env.RVM_DEVICE) - personMatteSec);
        const kineticSubject = await resolveKineticSubject({
          planInput: {
            kineticLed: kineticLedStyle,
            matteBudgetSec: kineticMatteBudgetSec,
            skill: kineticSkill,
            durationSec: timeline.outputDurationSec,
            words: captionWords,
            contentType: contentProfile?.contentType ?? null,
            logoSrc: slotUrls(['logo'])[0],
            brandName: kineticBrandName,
            socialImageUrls: kineticSocialUrls,
            existingFullscreenCount: fullScreenNow,
            blockedRanges: kineticBlocked,
            directed: kineticDirected,
          },
          keepSegments: timeline.keepSegments,
          activeSourcePath,
          matteOutputPath: workspace.file('subject-matte.webm'),
          occupancy: {speaker: occupancy.speaker, source: occupancy.source},
          cutout: kineticYield.cutout,
          ...(personCoverage ? {cutoutCoverage: personCoverage} : {}),
          upload: (localPath, extension) => uploadSourceVideo(localPath, extension),
          extract: extractSubjectMatte,
          segmentationConfigured: kineticYield.segmentationConfigured,
        });
        warnings.push(...kineticSubject.warnings);
        kineticForeground = kineticSubject.foreground;
        if (polishPath) warnings.push(`polish_kinetic_led:${env.POLISH_KINETIC_LED ? 'on' : 'off'}`);
        let craft = await runCraftTemplateStage({
          polishSkill: polishSkill.skill,
          words: captionWords,
          durationSec: timeline.outputDurationSec,
          contentType: contentProfile?.contentType ?? null,
          screenshotUrls: [...new Set(slotUrls(['screenshot', 'product']))],
          imageUrls: [...new Set(templateStillUrls)],
          logoSrc: slotUrls(['logo'])[0],
          existingFullscreenCount: fullScreenNow,
          brandName: kineticBrandName,
          socialImageUrls: kineticSocialUrls,
          subjectMatte: kineticSubject.subjectMatte,
          subjectBox: kineticSubject.subjectBox,
          directed: kineticDirected,
          kineticLed: kineticLedStyle,
          matteBudgetSec: kineticMatteBudgetSec,
          accent: kineticLedStyle ? KINETIC_LED_CONFIG.style.accent : editPalette?.accent,
          ground: kineticLedStyle ? KINETIC_LED_CONFIG.style.background : editPalette?.ground,
          ink: kineticLedStyle ? KINETIC_LED_CONFIG.style.primaryText : craftInk,
          blockedRanges: [
            ...craftHookBlocked,
            ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
            ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
            ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
            ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
            ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => ({start: span.start, end: span.end})) : []),
            ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => ({start: span.start, end: span.end})) : []),
          ],
          publish: {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined},
        });
        warnings.push(...craft.warnings);
        // A range-limited person matte is transparent outside the ranges it was built for. A hero beat published OUTSIDE them would draw the type with no presenter in front of it, so it is dropped (reported, never silent).
        const outsideMatte = heroBeatsOutsideCoverage(craft.published, kineticSubject.coverage);
        if (outsideMatte.length > 0) {
          const droppedIds = new Set(outsideMatte.map(item => item.graphic.id));
          craft = {...craft, published: craft.published.filter(item => !droppedIds.has(item.graphic.id)), graphics: craft.graphics.filter(graphic => !droppedIds.has(graphic.id))};
          for (let i = 0; i < outsideMatte.length; i += 1) warnings.push('kinetic_type:environmental:dropped:not_in_matte_ranges');
        }
        if (kineticForeground) {
          // the host foreground only covers hero beats that really PUBLISHED with a real matte (a hero that failed to publish leaves no orphan foreground)
          const live = craft.published
            .filter(item => isMatteBeat(item.beat) && (item.graphic.props as {content?: {occlusion?: string}} | undefined)?.content?.occlusion === 'matte')
            .map(item => ({start: item.beat.start, end: item.beat.end}));
          kineticForeground = live.length > 0 ? {...kineticForeground, spans: live} : undefined;
          if (kineticForeground) warnings.push(`kinetic_type:foreground:${live.length}_spans`);
        }
        if (craft.graphics.length > 0) {
          motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...craft.graphics].sort((a, b) => a.start - b.start)};
          craftTemplateMute = craft.muteRanges;
        }
      } catch (error) {
        log.warn({error}, 'craft templates failed; continuing without them');
        warnings.push('craft_templates:failed');
      }
    }
    // WP45: LAYER-2 MOTION TEMPLATES (opt-in POLISH_MOTION_TEMPLATES=1; default off = nothing below runs). Not a skill lane: sparse toolkit moves (grid morph / slit carousel / bento camera / stacked cards) INSIDE the active
    // polish skill. Skill (L1) -> allowlist -> planMotionTemplateBeats (L2) -> publish as full-screen library graphics. Runs after the lane resolution, the WP42 explainer mount and the editorial stills / faceless runs, so
    // everything already on the frame is a blocked range. Silent (no SFX), mutes the captions only while a PUBLISHED opaque template owns the frame. A failure places nothing.
    let motionTemplateMute: MuteRange[] = [];
    if (polishPath && env.POLISH_MOTION_TEMPLATES) {
      if (!motion) {
        warnings.push('polish_motion_templates:skipped:no_motion');
      } else {
        try {
          const templateHookBlocked = broll.hookTitle && broll.hookDurationSec > 0 ? [{start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + broll.hookDurationSec}] : [];
          for (const overlay of broll.overlays) {
            if (overlay.mediaKind === 'image' && /^https:\/\//i.test(overlay.assetUrl)) templateStillUrls.push(overlay.assetUrl);
          }
          // WP49: toolkit accents / grounds always come from the edit palette of THIS video (never ACME / Mango shell hex).
          const paletteInk =
            editPalette && (editPalette.groundStyle === 'paper_dot' || /^#fff/i.test(editPalette.ground))
              ? editPalette.inkOnAccent
              : editPalette?.text;
          const motionTemplates = await runMotionTemplateStage({
            polishSkill: polishSkill.skill,
            words: captionWords,
            durationSec: timeline.outputDurationSec,
            accent: editPalette?.accent,
            ground: editPalette?.ground,
            ink: paletteInk,
            imageUrls: [...new Set(templateStillUrls)],
            blockedRanges: [
              ...templateHookBlocked,
              ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
              ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
              ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
              ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
              // a mounted Skill B edit / a planned Skill D track owns every non-host layout span: no template over them
              ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => ({start: span.start, end: span.end})) : []),
              ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => ({start: span.start, end: span.end})) : []),
            ],
            publish: {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined},
          });
          warnings.push(...motionTemplates.warnings);
          if (motionTemplates.graphics.length > 0) {
            motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...motionTemplates.graphics].sort((a, b) => a.start - b.start)};
            motionTemplateMute = motionTemplates.muteRanges;
          }
        } catch (error) {
          log.warn({error}, 'motion templates failed; continuing without them');
          warnings.push('polish_motion_templates:failed');
        }
      }
    }
    motionTemplateMute = [...motionTemplateMute, ...craftTemplateMute]; // WP54: published frame-owning craft beats mute the captions through the same merge as the WP45 templates
    // WP43: SKILL C (textual motion graphics, opt-in POLISH_TEXTUAL_MG=1; default off = nothing below runs). Sparse Jitter-class designed-type plates (hook / stat / pivot / CTA) over the picture, published as
    // `TextualMgPlate` library graphics (overlay, transparent ground). It coexists with Skill A and Skill B (it never replaces their captions or tracks); the only caption effect is that the captions are muted while a PUBLISHED
    // plate owns the words (merged into the WP11A mute ranges below). Never planned over a full-frame graphic, the hook title, or a mounted explainer's cutaway media. A failure places nothing.
    let textualMgMute: MuteRange[] = [];
    if (polishPath && env.POLISH_TEXTUAL_MG) {
      if (!motion) {
        warnings.push('polish_textual_mg:skipped:no_motion');
      } else {
        try {
          const hookBlocked = broll.hookTitle && broll.hookDurationSec > 0 ? [{start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + broll.hookDurationSec}] : [];
          const textualMg = await runTextualMgStage({
            words: captionWords,
            durationSec: timeline.outputDurationSec,
            blockedRanges: [
              ...hookBlocked,
              ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
              ...(motion.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
              ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
              ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
            ],
            publish: {upload: input.motionWorkerOptions?.upload, captionBottomFrac: broll.caption.bottomFrac ?? undefined},
          });
          warnings.push(...textualMg.warnings);
          if (textualMg.graphics.length > 0) {
            motion = {...motion, generatedGraphics: [...motion.generatedGraphics, ...textualMg.graphics].sort((a, b) => a.start - b.start)};
            textualMgMute = textualMg.muteRanges;
          }
        } catch (error) {
          log.warn({error}, 'textual MG plates failed; continuing without them');
          warnings.push('polish_textual_mg:failed');
        }
      }
    }
    // WP52: LIVE CRAFT QA GATES (polish only; pure helpers in craftMutualExclusion.ts). Bubble ban, double-stat exclusion, small-image overlap refusal, sticky-end clamp, palette-repeat report.
    if (polishPath) {
      const bubbles = dropBubbleOverlays(broll.overlays);
      if (bubbles.dropped > 0) {
        broll.overlays = bubbles.kept;
        warnings.push(`polish_craft:bubble_banned:${bubbles.dropped}`);
      }
      if (motion) {
        const compositionOf = new Map((motion.worker?.provenance ?? []).map(item => [item.id, item.compositionId]));
        const contentOf = new Map((motion.director?.graphics ?? []).map(directed => [directed.brief.id, directed.brief.content as Record<string, unknown>]));
        const textOf = (id: string): string => {
          const content = contentOf.get(id) ?? {};
          return Object.values(content).flatMap(value => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])).join(' ');
        };
        const craftGraphics = motion.generatedGraphics.map(graphic => ({id: graphic.id, start: graphic.start, end: graphic.end, compositionId: compositionOf.get(graphic.id), text: textOf(graphic.id)}));
        const stat = dedupeStatKinetic(craftGraphics);
        if (stat.dropIds.length > 0) {
          motion = {...motion, generatedGraphics: motion.generatedGraphics.filter(graphic => !stat.dropIds.includes(graphic.id))};
          warnings.push(...stat.warnings);
        }
        const survivors = craftGraphics.filter(graphic => !stat.dropIds.includes(graphic.id));
        const emphasis = dropDoubleStatEmphasis(survivors, broll.semanticEmphasis ?? []);
        if (emphasis.warnings.length > 0) {
          broll.semanticEmphasis = emphasis.kept;
          warnings.push(...emphasis.warnings);
        }
      }
      const fullScreenRanges = [
        ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
        ...broll.overlays.filter(overlay => overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
      ];
      const candidates = broll.overlays.map((overlay, index) => ({overlay, id: `ov_${index}`})).filter(item => item.overlay.provider !== 'user');
      const refused = refuseOverlappingImages(candidates.map(item => ({...item.overlay, id: item.id})), fullScreenRanges);
      if (refused.refusedIds.length > 0) {
        const refusedOverlays = new Set(candidates.filter(item => refused.refusedIds.includes(item.id)).map(item => item.overlay));
        broll.overlays = broll.overlays.filter(overlay => !refusedOverlays.has(overlay));
        warnings.push(...refused.warnings);
      }
      // F: nothing outlives the next plate / layout change, nor its own spoken words by more than a short hold.
      const boundaries = [
        ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => graphic.start),
        ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => span.start) : []),
        ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => span.start) : []),
        ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => overlay.start),
      ];
      const spokenEnd = (text: string, start: number, end: number): number | undefined => {
        const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
        const last = tokens[tokens.length - 1];
        if (!last || tokens.length > 6) return undefined;
        const hit = [...captionWords].reverse().find(word => word.start >= start - 0.5 && word.start <= end && word.text.toLowerCase().replace(/[^a-z0-9]/g, '') === last);
        return hit?.end;
      };
      if (motion) {
        const clamped = clampStickyEnds(motion.generatedGraphics, {
          boundaries,
          spokenEndOf: graphic => {
            const composition = (motion?.worker?.provenance ?? []).find(item => item.id === graphic.id)?.compositionId;
            if (composition !== 'StatHighlight' && composition !== 'BigKineticHeadline') return undefined;
            const content = (motion?.director?.graphics ?? []).find(directed => directed.brief.id === graphic.id)?.brief.content as Record<string, unknown> | undefined;
            return spokenEnd(Object.values(content ?? {}).filter((value): value is string => typeof value === 'string').join(' '), graphic.start, graphic.end);
          },
        });
        if (clamped.warnings.length > 0) {
          motion = {...motion, generatedGraphics: clamped.items};
          warnings.push(...clamped.warnings);
        }
      }
      const emphasisClamped = clampStickyEnds((broll.semanticEmphasis ?? []).map((item, index) => ({...item, id: `em_${index}`})), {boundaries, spokenEndOf: item => spokenEnd(item.text, item.start, item.end)});
      if (emphasisClamped.warnings.length > 0) {
        broll.semanticEmphasis = emphasisClamped.items.map(({id: _id, ...item}) => item);
        warnings.push(...emphasisClamped.warnings);
      }
      warnings.push(...paletteRepeats((motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen').map(graphic => ({id: graphic.id, start: graphic.start, end: graphic.end, style: (motion?.worker?.provenance ?? []).find(item => item.id === graphic.id)?.compositionId ?? 'unknown'}))));
    }
    // WP49: stillness → frame_inset. When the picture sits open (no opaque graphic / cutaway) for too long, retract then restore so the edit stays interactive.
    if (polishPath) {
      const stillnessBlocked = [
        ...(broll.frameInsets ?? []).map(inset => ({start: inset.start, end: inset.end})),
        ...broll.clips.map(clip => ({start: clip.start, end: clip.end})),
        ...(motion?.generatedGraphics ?? []).filter(graphic => graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen').map(graphic => ({start: graphic.start, end: graphic.end})),
        ...broll.overlays.filter(overlay => overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway').map(overlay => ({start: overlay.start, end: overlay.end})),
        ...(broll.mediaContainers ?? []).map(item => ({start: item.start, end: item.end})),
        ...(explainerMount ? explainerMount.layoutTrack.filter(span => span.layout !== 'explainer_a').map(span => ({start: span.start, end: span.end})) : []),
        ...(newsroomLayoutTrack ? newsroomLayoutTrack.filter(span => span.layout !== 'newsroom_host').map(span => ({start: span.start, end: span.end})) : []),
        ...(broll.hookTitle && broll.hookDurationSec > 0 ? [{start: broll.hookStartSec ?? 0, end: (broll.hookStartSec ?? 0) + broll.hookDurationSec}] : []),
      ];
      const stillness = planStillnessFrameInsets({
        durationSec: timeline.outputDurationSec,
        blockedRanges: stillnessBlocked,
        existingInsets: broll.frameInsets ?? [],
        // WP56: prefer paper / Color Director ground as margin; black only on ink grounds
        marginColor:
          editPalette?.groundStyle === 'ink_black' || editPalette?.groundStyle === 'none'
            ? editPalette.ground
            : editPalette?.ground && /^#[0-9a-fA-F]{6}$/.test(editPalette.ground)
              ? editPalette.ground
              : '#FAFAF7',
      });
      warnings.push(...stillness.warnings);
      if (stillness.insets.length > 0) {
        broll.frameInsets = [...(broll.frameInsets ?? []), ...stillness.insets].sort((a, b) => a.start - b.start);
      }
    }
    // WP11A: one text job at a time: the captions are muted while a graphic that owns the spoken words is on screen (polish only).
    const muteRangesWp11a = polishPath && motion
      ? captionMuteRanges({
          graphics: motion.generatedGraphics,
          contentById: new Map((motion.director?.graphics ?? []).map(directed => [directed.brief.id, directed.brief.content])),
          captionWords,
          // WP11B: every other on-screen text that repeats spoken words mutes the captions too (kinetic text, emphasis pops, chip / lockup overlays).
          textItems: [
            ...(broll.motionGraphics ?? []).map(item => ({start: item.start, end: item.end, text: item.text})),
            ...(broll.semanticEmphasis ?? []).map(item => ({start: item.start, end: item.end, text: item.text})),
            ...broll.overlays.map(item => ({start: item.start, end: item.end, text: item.overlayText ?? ''})),
          ],
        })
      : [];
    const muteRanges = textualMgMute.length > 0 || motionTemplateMute.length > 0 || visualBackendMute.length > 0 ? mergeMuteRanges([...muteRangesWp11a, ...textualMgMute, ...motionTemplateMute, ...visualBackendMute]) : muteRangesWp11a;
    if (muteRanges.length > 0) warnings.push(`polish_captions:muted_for_graphics:${muteRanges.length}`);
    // WP12D + WP27: local SFX hits on polish explain; optional music bed from POLISH_MUSIC_BED_URL (licensed URL only — never scraped).
    let audioDesign = broll.audioDesign;
    if (polishPath && motion) {
      const framedWindows = (broll.mediaContainers ?? [])
        .filter(container => (container as {canvasStyle?: string}).canvasStyle === 'blur_self' || container.mode === 'rounded_window')
        .map(container => ({start: container.start}));
      const scheduled = schedulePolishSfxHits({
        // WP43: Skill C plates carry no SFX this cycle (no hit tied to the snaps). WP45: motion-template beats are silent too.
        graphics: motion.generatedGraphics.filter(graphic => !graphic.id.startsWith(TEXTUAL_MG_GRAPHIC_ID_PREFIX)).filter(graphic => !graphic.id.startsWith(MOTION_TEMPLATE_GRAPHIC_ID_PREFIX)).map(graphic => ({
          start: graphic.start,
          end: graphic.end,
          placementMode: graphic.placement.mode,
          // WP14F: pass recipeId from plate props so vernacular peaks (whoosh/pop/hit) fire with the entrance.
          recipeId: typeof graphic.props?.recipeId === 'string' ? graphic.props.recipeId : undefined,
        })),
        transitions: (broll.transitions ?? []).map(transition => ({at: transition.at, keyword: transition.keyword})),
        framedWindows,
        existing: audioDesign?.hits,
      });
      if (scheduled.hits.length > 0) {
        audioDesign = {
          ducking: audioDesign?.ducking ?? true,
          sfx: audioDesign?.sfx ?? [],
          hits: scheduled.hits,
          ...(audioDesign?.musicMood ? {musicMood: audioDesign.musicMood} : {}),
          ...(audioDesign?.musicUrl ? {musicUrl: audioDesign.musicUrl, musicGain: audioDesign.musicGain, duckedGain: audioDesign.duckedGain} : {}),
        };
        if (scheduled.added > 0) warnings.push(`polish_sfx:hits:${scheduled.hits.length}`);
      }
    }
    // Bed attaches on polish even when motion graphics are off. Licensed URL wins; generated fills only when empty.
    if (polishPath) {
      const bedUrl = (env.POLISH_MUSIC_BED_URL ?? '').trim();
      // Await the specialist here (before the blueprint is built). Times out fail-open without killing the paid child.
      const musicPlan = broll.musicPending ? await awaitMusicPlan(broll.musicPending) : null;
      const resolved = resolveMusicBed({
        licensed: bedUrl ? {url: bedUrl} : audioDesign?.musicUrl ? {url: audioDesign.musicUrl} : null,
        generated: musicPlan?.url
          ? {url: musicPlan.url, bpm: musicPlan.bpm, key: musicPlan.musicalKey, seed: musicPlan.seed, cacheKey: musicPlan.cacheKey, integratedLufs: musicPlan.integratedLufs, costUsd: musicPlan.costUsd}
          : null,
        source: resolveBedSource(),
      });
      if (resolved) {
        let voLufs: number | undefined;
        let duck: ReturnType<typeof buildDuckEnvelope> | null = null;
        if (resolved.source === 'generated') {
          const preset = resolveDuckPreset();
          if (preset === 'talking') {
            const measured = await measureVoLufs({audioPath: audio.path, words: captionWords, segments: timeline.keepSegments, agentsDir: musicAgentsDir()});
            if (measured === null) {
              log.warn({assumed: VO_LUFS_ASSUMED}, 'music.vo_lufs_assumed');
              warnings.push('music:vo_lufs_assumed');
            }
            voLufs = measured ?? VO_LUFS_ASSUMED;
          }
          duck = buildDuckEnvelope({words: captionWords, durationSec: timeline.outputDurationSec, preset, voLufs, bedLufs: resolved.integratedLufs});
        }
        audioDesign = toAudioDesign({existing: audioDesign, resolved, duck, mood: musicPlan?.mood, voLufs, ...playbackFromPlan(musicPlan)});
        warnings.push(resolved.source === 'licensed' ? 'polish_music:bed:env' : 'music:bed:generated');
      }
    }
    // Human SFX library (remotion/public/sfx-library). Empty or absent catalog: this block does nothing and the blueprint is unchanged.
    if (audioDesign?.hits?.length) {
      const catalog = loadSfxCatalog();
      if (catalog.entries.length > 0) {
        const voLufs = audioDesign.voLufs ?? VO_LUFS_ASSUMED;
        const applied = applyCatalogToHits(audioDesign.hits, {
          entries: catalog.entries,
          videoId: musicVideoId,
          voLufs,
          offsetLu: sfxVoiceOffsetLu(),
          wordOnsetsSec: captionWords.map(word => word.start),
        });
        audioDesign = {...audioDesign, hits: applied.hits};
        log.info({videoId: musicVideoId, ...applied.stats, voLufsAssumed: audioDesign.voLufs === undefined}, 'sfx.catalog_applied');
      }
    }
    const blueprint: TimelineBlueprint = {
      schemaVersion: visualDirectorV2 || northStar ? 2 : 1,
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
      hookAnchor,
      visualOverlays: broll.overlays,
      transitions: broll.transitions,
      motionGraphics: broll.motionGraphics ?? [],
      mediaContainers: broll.mediaContainers ?? [],
      frameInsets: broll.frameInsets ?? [],
      semanticEmphasis: broll.semanticEmphasis ?? [],
      ...(motion ? {generatedGraphics: motion.generatedGraphics} : {}),
      ...(muteRanges.length > 0 ? {captionMuteRanges: muteRanges} : {}),
      ...(gradeBeats.length > 0 ? {gradeBeats} : {}),
      ...(impactFx && !impactFxIsEmpty(impactFx.fx) ? {impactFx: impactFx.fx} : {}),
      ...(explainerMount ? {explainerLayoutTrack: explainerMount.layoutTrack, explainerClaimBeats: explainerMount.claimBeats} : {}),
      ...(newsroomLayoutTrack ? {newsroomLayoutTrack} : {}),
      ...(editPalette
        ? {
            editPalette: {
              id: editPalette.id,
              accent: editPalette.accent,
              ground: editPalette.ground,
              groundDot: editPalette.groundDot,
              groundStyle: editPalette.groundStyle,
              text: editPalette.text,
              inkOnAccent: editPalette.inkOnAccent,
              reason: editPalette.reason,
            },
          }
        : {}),
      ...(finalized.behindSubjectTexts.length ? {behindSubjectTexts: finalized.behindSubjectTexts} : {}),
      ...(openingSpec ? {openingTreatment: openingSpec} : {}),
      speakerCutout: resolvedCutout,
      // WP55 phase 2: the cut-aware person foreground drawn above kinetic environmental type (separate from speakerCutout: a range-limited matte must not drive the full-length depth / behind-subject tracks)
      ...(kineticForeground ? {subjectForeground: {videoUrl: kineticForeground.videoUrl, spans: kineticForeground.spans}} : {}),
      // SUBJECT STAGE (only when POLISH_SUBJECT_STAGE ran with a usable matte; absent otherwise)
      ...(subjectStagePayload ? {subjectStage: subjectStagePayload} : {}),
      captionDirection: broll.caption,
      ...(legibility ? {legibility} : {}),
      ...(mvpLike && broll.evidence ? {evidence: broll.evidence} : {}),
      // WP8I: also on cuts / polish (the shipping profiles): without it the Lambda render path has no audio expectation and a silent render of a source with audio would pass the output check.
      ...(mvpLike || speechCutsOn ? {sourceHasAudio: originalProbe.hasAudio} : {}),
      audioDesign,
      ...designFields.fields,
      colorGradeLut: normalizeLutId(input.colorGradeLut) || '',
      suggestedLutIds: broll.suggestedLutIds ?? [],
      preferredLutId: normalizeLutId(broll.preferredLutId) || '',
      editThesis: broll.editThesis,
      cta: broll.cta,
      ...(assetBrief ? {assetBrief, editReadiness: computeEditReadiness(assetBrief)} : {}),
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
            layoutCostUsd +
            (contentProfile?.costUsd ?? 0) +
            (motion ? motion.geminiCostUsd + motion.claudeCostUsd : 0),
          5,
        ),
        warnings,
        editOutcomes,
        perStageCostUsd: broll.directorReport?.perStageCostUsd,
        perStageLatencyMs: broll.directorReport?.perStageLatencyMs,
        ...(motion
          ? {
              generatedGraphicCount: motion.generatedGraphics.length,
              costBreakdownUsd: {
                transcription: round(transcription.estimatedCostUsd, 6),
                gemini: round(broll.estimatedCostUsd + layoutCostUsd + (contentProfile?.costUsd ?? 0) + motion.geminiCostUsd, 6),
                geminiMotionDirector: round(motion.geminiCostUsd, 6),
                claude: round(motion.claudeCostUsd, 6),
              },
            }
          : {}),
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

    // WP7G: replayable cuts dump (words, cuts, counts, caption texts) so a real run becomes an offline fixture. Cuts profile, or CUTS_DEBUG=1.
    if (speechCutsOn || env.CUTS_DEBUG) {
      const dumped = writeCutsDebugDump({
        blueprintId: blueprint.blueprintId,
        editProfile: input.editProfile ?? 'legacy',
        sourceDurationSec: activeDurationSec,
        words: activeWords,
        trimExclusions: trim.trimExclusions,
        ...cutsDebugCounts,
        captionWords,
        warnings,
        ...(cutsAiDebug ? {aiKeepPlan: cutsAiDebug} : {}),
      });
      if (dumped) log.info({cutsDebugDump: dumped}, 'cuts debug dump written');
    }

    observe(() => ({type: 'blueprint', blueprint}));
    // Phase 2.1 D: keep the final blueprint on disk for free re-renders. A write failure never fails analyze.
    try {
      const savedPath = await saveBlueprintForReplay({
        videoId: musicVideoId,
        sourceVideoPath: local ? resolveLocalMediaPath(input.videoUrl) : null,
        voLufs: blueprint.audioDesign?.voLufs ?? null,
        savedAt: new Date().toISOString(),
        blueprint,
      });
      log.info({videoId: musicVideoId, path: savedPath}, 'music.blueprint_saved');
    } catch (error) {
      log.warn({videoId: musicVideoId, reason: error instanceof Error ? error.message.slice(0, 300) : 'save'}, 'music.blueprint_save_failed');
    }
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
