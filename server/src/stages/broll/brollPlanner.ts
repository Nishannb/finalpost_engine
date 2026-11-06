/**
 * Stage C — director + stock lookup into output-time clips and overlays.
 *
 * Fails soft: a Gemini outage or empty stock set degrades to keyword fallback
 * plus text graphics, never to a failed analysis. The talking-head burn still
 * ships with a hook title even when stock footage is missing.
 * Video assets come from Pexels and/or Pixabay (whichever keys are configured).
 */

import {env} from '../../config/env.ts';
import {jobFlag} from '../../lib/effectiveFlags.ts';
import {EditLedger} from '../../lib/editLedger.ts';
import {
  LEDGER_ID,
  ledgerIdOf,
  momentEditType,
  proposeDirection,
  recordAllowlistRejections,
  recordEngineFills,
  recordPlannerOutcome,
  remapTrace,
  type DirectionIds,
} from './planLedger.ts';
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
import {EDIT_LOOKS, editLookWarnings, FALLBACK_LOOK_ID, polishCaptionTemplate, type EditLookDecision} from '../directorV2/editLooks.ts';
import {applyEditLookToDirection, ensureLookMinimumBeats} from './lookDirection.ts';
import {applyPolishDensityFill} from './polishDensityFill.ts';
import {libraryCoverStarts} from './engagementCadence.ts';
import {isNeonCyanHex} from '../../lib/contrast.ts';
import {hookWindowFromDirection, occupiedFromDirection} from './engagementMixer.ts';
import {detectExplainPlateGaps, type ExplainPlateGap} from './explainPlateGaps.ts';
import {visualBeatTimes} from './engagementCadence.ts';
import type {PlateAnchor} from '../motionDirector/transcriptLibrarySeed.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {runDirectorV2} from '../directorV2/runDirectorV2.ts';
import type {DirectorRunReport} from '../../types/blueprint.ts';
import type {StockAsset} from './stockTypes.ts';
import {stockAssetKeyOf, stockConfigured, findBRollAsset, findPhotoAsset, listBRollAssets} from './stockSearch.ts';
import {applyEditorialGate, cutawayMinGapSec} from './editorialGate.ts';
import {resolveDepthOverlays} from './depthOverlayPlanner.ts';
import {resolveInsetReveals} from './insetRevealPlanner.ts';
import {
  filterVisualDirection,
  isLayoutAllowed,
  lockCaptionTemplate,
  visualToolkitsRequested,
} from '../../lib/editToolkits.ts';
import {ensureRequestedEditStyles} from './ensureRequestedEdits.ts';
import {carryProvenance, stampProvenance} from '../../lib/provenance.ts';
import {applyNorthStarPass} from '../northStar/applyNorthStar.ts';
import {fullFrameStillPolicy, SOLID_STILL_REFUSED, solidStillWarnings, stripFullFrameStillClips} from './solidStill.ts';
import {assetsOfferedToDirector, enforceUserBrollContract, pickTaggedUserAsset, stillsForSlideshow, uniqueAssetsById} from './userBrollContract.ts';
import {pickRankedAsset} from '../northStar/assetRerank.ts';
import {chooseSemanticallyRelevantAsset} from '../northStar/semanticAssetGate.ts';
import {listBeatsFromTranscript} from './listBeats.ts';
import {formatVisualContext} from '../directorV2/visualContext.ts';
import {resolveLayoutPriority, type LayoutCandidate} from './layoutPriority.ts';
import {cutTransitionKeyword, mergeDirectedTransitions} from './transitionPlan.ts';
import {scheduleCutaways, type ScheduleDecision} from './cutawaySchedule.ts';
import type {DirectorParseRejection} from '../../lib/cutawayOutcomes.ts';
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
import {observe} from '../../lib/runObserver.ts';
import {OccupancyReplayError} from '../layout/occupancyReplay.ts';

const log = stageLogger('stage-c-broll');

const MIN_GAP_SEC = 1.5;
const HOOK_GUARD_SEC = 3.5;
/**
 * Speech alignment may move a moment onto the word it names (alignTimestampToSpeech allows 6 s). A placement
 * further than this from where the Director asked is a different spoken moment, so it is refused, not moved.
 */
export const MAX_RETIME_SEC = 7;

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
  /** Edit-decision ledger for this plan (proposal → disposition per edit). */
  ledger?: EditLedger;
  /** What the Director was shown (VISUAL_CONTEXT_V2 only). */
  visualContext?: import('../directorV2/visualContext.ts').VisualContext;
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
  /** WP55 phase 2: the live Director's kinetic-type elements (undefined unless the family was offered; an empty array = the Director chose none). */
  kineticTypeDirected?: import('./kineticTypeStory.ts').DirectedKineticTypeInput[];
  transitions: TransitionClip[];
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  frameInsets: FrameInset[];
  /** WP13B: grade-flip face beats (output seconds). */
  gradeBeats?: Array<{start: number; end: number}>;
  semanticEmphasis: SemanticEmphasis[];
  zooms: DirectedZoom[];
  warnings: string[];
  /** WP9B: library plates the motion stage must place (explain-plate path); a split with no creator media is one of these. */
  plateAnchors?: PlateAnchor[];
  /** WP9D: engagement windows still without a leave-the-face cover once the predicted library plates and anchors are counted (predicted; the motion stage re-detects against what it really placed). */
  explainPlateGaps?: ExplainPlateGap[];
  estimatedCostUsd: number;
  editThesis?: string;
  editThesisParts?: import('../directorV2/types.ts').EditThesis;
  directorReport?: DirectorRunReport;
  /** Opt-in (Phase 35): the Director's opening plan + colour direction, as returned. */
  openingRaw?: {openingPlan: unknown; colorDirection: unknown; videoObservations: unknown};
  cta?: import('../../types/blueprint.ts').BlueprintCta;
  audioDesign?: import('../../types/blueprint.ts').AudioDesign;
  /** In-flight generated bed. Awaited when the blueprint is finalized. */
  musicPending?: Promise<import('../music/musicSpecialist.ts').MusicPlan | null>;
  northStarDesign?: import('../../types/blueprint.ts').DesignTokens;
  northStarHookAnchor?: import('../../types/blueprint.ts').VisualAnchor;
  assembler?: import('../../lib/assembler/types.ts').AssemblerReport;
  /** Director items the parser discarded before planning (observation only; see lib/cutawayOutcomes.ts). */
  parseRejections?: DirectorParseRejection[];
  /** Parts of the direction the deterministic fallback supplied. */
  fallbackSubstitutions?: string[];
  /** WP3B (mvp profile only): facts for the offline scorer. */
  evidence?: import('../../types/blueprint.ts').ScorerEvidence;
  /** Opt-in (Phase 36I): per-field provenance of the Director's answer, captured before any fallback. */
  directorProvenance?: import('./directorProvenance.ts').DirectorProvenance;
  /** Why the whole direction is the deterministic fallback, when it is. */
  directorFallbackReason?: string;
  /** CUTAWAY_SCHEDULING=beat_preserving only: every scheduling decision, with planned and final windows. */
  cutawaySchedule?: ScheduleDecision[];
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
  /** WP8B: the Director works inside one Edit Look (stages/directorV2/editLooks.ts). Director v2 only; set for the polish profile. Off: nothing changes. */
  editLooks?: boolean;
  /** WP55 phase 2: offer KINETIC_TYPE_STORYTELLING to the Director (prompt block). Polish + POLISH_MOTION_TEMPLATES only; set by analyzeVideo. */
  kineticType?: {prompt: string};
  /** WP8C: the planning matte gate (lib/matteGate.ts). When given it replaces "an alpha video already exists" as the Director's matte-available signal (the alpha video is only extracted after planning). */
  matteUsable?: boolean;
  /** WP8P: content-profile facts for the Edit Look density bias (polish only; absent elsewhere). */
  lookBias?: {contentType?: string; density?: string; structure?: string; mood?: string};
  /** Stable per source video (not the blueprint id). Seeds the generated bed and picks the pool bed. */
  videoId?: string;
  /** WP8X: the library motion stage runs after this plan (polish with generated graphics on), so the cadence fill predicts its full-screen seeds and leaves those windows to them. */
  expectLibraryGraphics?: boolean;
  northStar?: boolean;
  /**
   * WP1, default off: creator-supplied B-roll only. No stock search or placement (even under north-star, which is then ignored), a placement uses an asset only by its exact
   * stable id (no keyword-score, first-clip or leftover substitution), a still never pulls other stills into a slideshow, assets without a real description are not offered
   * to the Director, and a backstop removes any placement that still violates this. See stages/broll/userBrollContract.ts. Absent: behaviour unchanged.
   */
  userBrollOnly?: boolean;
  /** Opt-in (Phase 34): the whole video as an inline video part for the v1 Director's single planning call. */
  directorVideo?: {mimeType: string; data: string; bytes?: number};
  /** Opt-in (Phase 35, needs directorVideo): ask the Director for the opening plan and colour direction. */
  openingDirection?: boolean;
  /** Opt-in (Phase 36I): record per-field provenance of the Director's answer. */
  captureProvenance?: boolean;
  sourcePath?: string;
  workspace?: {file: (name: string) => string};
  requestedEdits?: string[] | null;
  captionTemplate?: import('../../types/blueprint.ts').CaptionTemplateId | null;
  /** Content-profile block for the v1 visual director (decided before planning). */
  contentProfileBlock?: string;
  /** When the single speaker box was measured, on the output timeline (OCCUPANCY_CONTEXT_V2 only). */
  occupancyAtSec?: number | null;
  /** Observed-frame context for the v1 Director (VISUAL_CONTEXT_V2). Absent: legacy behaviour. */
  visualContext?: import('../directorV2/visualContext.ts').VisualContext;
  /** Art-direction colours offered to the inset planner ahead of the caption colours. */
  themeColorHints?: string[];
  noRepair?: boolean;
}): Promise<VisualPlan> {
  const warnings: string[] = [];
  const uniqueSupplied = input.userBrollOnly ? uniqueAssetsById(input.userBrollAssets ?? []) : {assets: input.userBrollAssets ?? [], duplicates: [] as string[]};
  const suppliedUserAssets = uniqueSupplied.assets;
  if (uniqueSupplied.duplicates.length > 0) {
    warnings.push(`user_broll_duplicate_ids:${uniqueSupplied.duplicates.length}`);
  }
  const userBrollAssets = assetsOfferedToDirector(suppliedUserAssets, {userBrollOnly: input.userBrollOnly});
  if (input.userBrollOnly && userBrollAssets.length < suppliedUserAssets.length) {
    warnings.push(`user_broll_withheld_undescribed:${suppliedUserAssets.length - userBrollAssets.length}`);
  }
  if (input.userBrollOnly && input.northStar) {
    warnings.push('user_broll_only:north_star_ignored');
  }
  const hookDurationSec = Math.min(
    Math.max(2.6, jobFlag('hookDurationSec', env.HOOK_DURATION_SEC)),
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
      hookDurationSec: jobFlag('hookTitlePolicy', env.HOOK_TITLE_POLICY) === 'optional' && !fallback.hookTitle ? 0 : hookDurationSec,
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
  const northStar = Boolean(input.northStar) && !input.userBrollOnly;
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
  let musicPending: Promise<import('../music/musicSpecialist.ts').MusicPlan | null> | undefined;
  let assembler: import('../../lib/assembler/types.ts').AssemblerReport | undefined;
  let lookDecision: EditLookDecision | undefined; // WP8B/WP8H: set only when Director v2 produced a plan under an Edit Look

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
        speakerCutoutAvailable: input.matteUsable ?? Boolean(input.speakerCutout?.videoUrl),
        speakerCutoutNote: input.matteUsable === true
          ? 'available. The speaker is measured and the background is keyable; the alpha video is extracted from your plan.'
          : input.matteUsable === false
            ? 'not available (no usable matte). Do not emit cutout or depth_overlay.'
            : input.speakerCutout?.videoUrl
              ? 'available. Alpha video exists for the speaker mask.'
              : 'not available. Do not emit cutout or depth_overlay.',
        requestedEdits: input.requestedEdits ?? null,
        noRepair: input.noRepair,
        activeSourceDurationSec: input.sourceDurationSec,
        editLooks: input.editLooks,
        matteUsable: input.matteUsable,
        lookBias: input.lookBias,
        videoId: input.videoId,
        kineticType: input.kineticType,
      });
      direction = v2.direction;
      editThesis = v2.plan?.editThesis ?? '';
      editThesisParts = v2.plan?.editThesisParts;
      northStarPack = v2.pack;
      northStarStory = v2.story;
      directorReport = v2.report;
      cta = v2.plan?.cta;
      audioDesign = v2.plan?.sound;
      musicPending = v2.musicPending;
      assembler = v2.report.assembler;
      estimatedCostUsd += direction.estimatedCostUsd;
      warnings.push(`director_v2:${v2.report.source}`);
      lookDecision = v2.plan?.editLook;
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
        contentProfileBlock: input.contentProfileBlock,
        visualContextBlock: input.visualContext ? formatVisualContext(input.visualContext) : undefined,
        occupancyAtSec: input.occupancyAtSec,
        videoPart: input.directorVideo,
        openingDirection: input.openingDirection,
        captureProvenance: input.captureProvenance,
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
    if (error instanceof OccupancyReplayError) {
      throw error; // replay is fail-closed: never degrade into the keyword fallback
    }
    const code = isEngineError(error) ? error.code : 'broll_failed';
    log.warn({error}, 'visual director failed; using keyword fallback');
    warnings.push(`director_${code}`);
  }

  let plateAnchors: PlateAnchor[] = [];
  let explainPlateGaps: ExplainPlateGap[] = [];
  // WP8B/WP8G/WP8H: Edit Looks (polish only, Director v2 requested).
  //  - a plan under a look: its warnings; a non-minimal look gets a floor of beats (one zoom pair) when the plan carries no zoom;
  //  - NO plan (Director v2 fell back, or threw): the deterministic fallback direction is run through `minimal_captions` (zoom + captions only), so the toolkit sprinkle the fallback carries
  //    never reaches the edit, and the fallback is reported as the look.
  if (input.editLooks && (input.directorV2 || northStar)) {
    const minimal = EDIT_LOOKS.find(entry => entry.id === FALLBACK_LOOK_ID)!;
    if (lookDecision) {
      warnings.push(...editLookWarnings(lookDecision));
      const chosen = EDIT_LOOKS.find(entry => entry.id === lookDecision!.id);
      if (chosen && chosen.id !== FALLBACK_LOOK_ID) {
        const stubs = fallbackVisualDirection({transcript: input.transcript, sourceDurationSec: input.timeline.outputDurationSec, momentCount: 3}).zooms;
        const floor = ensureLookMinimumBeats(direction, chosen, stubs);
        direction = floor.direction;
        if (floor.addedZooms > 0) warnings.push(`edit_look_min_beats:zoom:${floor.addedZooms}`);
        // WP8P: polish density. The lean toolkits the Director omitted are filled from the speaker's own words (grounded by construction), bounded by the look's caps and the beat target.
        const fillWords = input.captionWords ?? input.words ?? [];
        // WP8X: the seeds the motion stage will add (pure prediction from the same words; full-screen graphics and topic pills) cover their windows; a cutaway is only emitted when it can resolve
        // (creator B-roll supplied, or stock allowed). Otherwise the cover falls back to a card / lockup, and a missed cutaway frees its window for a seed.
        // WP9A: with no creator B-roll the library plates ARE the cutaway substitute (explain-plate seed density, one per engagement window); the motion stage seeds with the same flag.
        const explainPlates = Boolean(input.expectLibraryGraphics) && userBrollAssets.length === 0;
        const predicted = input.expectLibraryGraphics ? libraryCoverStarts(seedLibraryGraphics({words: fillWords, outputDurationSec: input.timeline.outputDurationSec, lookId: chosen.id, explainPlates, occupied: occupiedFromDirection(direction, hookDurationSec, {withoutHook: explainPlates}).map(item => ({...item, what: 'planned'})), ...(explainPlates ? {hookWindow: hookWindowFromDirection(direction, hookDurationSec)} : {})}), fillWords) : [];
        if (explainPlates && predicted.length > 0) warnings.push('explain_plates:library_default');
        const density = applyPolishDensityFill({direction, look: chosen, words: fillWords, outputDurationSec: input.timeline.outputDurationSec, requested: input.requestedEdits?.length ? new Set(input.requestedEdits) : null, matteUsable: input.matteUsable ?? Boolean(input.speakerCutout?.videoUrl), coveredBy: predicted, cutawayResolvable: userBrollAssets.length > 0 || !input.userBrollOnly, explainPlates, sectionMarkers: true});
        if (predicted.length > 0) warnings.push(`engagement_library_cover_expected:${predicted.length}`);
        direction = density.direction;
        plateAnchors = density.plateAnchors;
        if (explainPlates) {
          explainPlateGaps = detectExplainPlateGaps({durationSec: input.timeline.outputDurationSec, words: fillWords, coverStarts: visualBeatTimes(density.direction, [...predicted, ...density.plateAnchors.map(anchor => anchor.startSec)]), notBeforeSec: hookDurationSec});
          if (explainPlateGaps.length > 0) warnings.push(`explain_plates:gaps_predicted:${explainPlateGaps.length}`);
        }
        warnings.push(...density.warnings);
      }
    } else {
      const enforced = applyEditLookToDirection(direction, minimal, {matteUsable: input.matteUsable});
      direction = enforced.direction;
      warnings.push(...editLookWarnings({id: FALLBACK_LOOK_ID, requested: '', fellBack: true, dropped: enforced.dropped}));
    }
  }

  observe(() => ({type: 'director_result', path: input.directorV2 || northStar ? 'v2' : 'v1', source: direction.source, hookTitle: direction.hookTitle, moments: direction.moments.length, warnings: [...warnings]}));
  const allowedEdits = input.requestedEdits?.length
    ? new Set(input.requestedEdits)
    : null;
  // Director times are source times for v1 (remapped below) and output times for v2.
  const timedFromDirector = Boolean(input.directorV2 || northStar);
  const ledger = new EditLedger();
  ledger.noteStageContext('visual_director', {
    profile: Boolean(input.contentProfileBlock),
    theme: Boolean(input.contentProfileBlock?.includes('art direction')),
  });
  const proposalContext = {
    toOutput: (sec: number) => (timedFromDirector ? sec : input.timeline.mapSourceToOutputClamped(sec)),
    hookDurationSec,
    maskAvailable: Boolean(input.speakerCutout?.videoUrl),
    cutoutAvailable: Boolean(input.speakerCutout?.videoUrl),
  };
  const ids: DirectionIds = proposeDirection(ledger, direction, proposalContext);
  const hookLedgerId = ids.get(direction);
  const proposedDirection = direction;
  if (!input.directorV2 && !northStar) {
    direction = filterVisualDirection(direction, allowedEdits);
    recordAllowlistRejections(ledger, ids, proposedDirection, direction);
  }
  const filled = ensureRequestedEditStyles({
    direction,
    allowed: allowedEdits,
    words: input.captionWords ?? input.words ?? [],
    durationSec: input.timeline.outputDurationSec,
    userBrollId: userBrollAssets[0]?.id ?? null,
  });
  direction = filled.direction;
  recordEngineFills(ledger, ids, direction, proposalContext);
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
    frameInsets: direction.frameInsets,
    semanticEmphasis: direction.semanticEmphasis,
  });
  // WP8H: polish with no caller template: clean outline typography, not the game-HUD / boxed looks the rotation or the Director may pick. The caller's own template (below) always wins.
  if (input.editLooks && !input.captionTemplate) {
    const pick = polishCaptionTemplate(direction.caption.template);
    if (pick.replaced) {
      warnings.push(`polish_caption_default:${pick.template}:replaced_${direction.caption.template ?? 'none'}`);
      direction = {...direction, caption: {...direction.caption, template: pick.template as typeof direction.caption.template, boxColor: null, animation: 'highlight'}};
    }
  }
  // WP10H: polish with designed plates keeps the karaoke animation but not its neon blue-green highlight; a warm, readable amber replaces it (a caller template / explicit colour roles still win later).
  if (input.editLooks && !input.captionTemplate && direction.caption.highlightColor && isNeonCyanHex(direction.caption.highlightColor)) {
    warnings.push(`polish_caption_highlight_not_cyan:${direction.caption.highlightColor}`);
    direction = {...direction, caption: {...direction.caption, highlightColor: POLISH_HIGHLIGHT_FALLBACK}};
  }
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
    !input.userBrollOnly &&
    (northStar ||
      (userBrollAssets.length === 0 &&
        (allowedEdits == null ||
          allowedEdits.has('cutaway') ||
          allowedEdits.has('depth_overlay'))));
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
  // Each moment copy carries its ledger id (a symbol key survives spreads and never serialises).
  const speechAligned = direction.moments.map(moment => ({
    ...moment,
    [LEDGER_ID]: ids.get(moment),
  }));
  void words;
  /** Placed clip/overlay object → ledger id, so later filters can attribute their drops. */
  const placedIds = new Map<object, string>();
  const dropPlaced = (item: object, stage: 'plan_assembly' | 'editorial_gate', reason: string, conflict?: object) => {
    const id = placedIds.get(item) ?? ledgerIdOf(item);
    if (id) {
      const conflictId = conflict ? placedIds.get(conflict) : undefined;
      ledger.drop(id, stage, reason, conflictId ? {conflictsWith: [conflictId]} : {});
    }
  };

  /** Why stock lookup is off, for the ledger (observation only). */
  const stockDisabledCause = allowStock
    ? undefined
    : input.userBrollOnly
      ? 'stock_disabled:user_broll_only'
      : userBrollAssets.length > 0
      ? 'stock_disabled:user_assets_supplied'
      : 'stock_disabled:edit_allowlist';
  /** Resolved cutaway clips by object: ledger id and the time the Director asked for (used by the scheduler). */
  const clipMeta = new Map<object, {momentId?: string; directedStart: number}>();
  let splitCount = 0;
  const spaced = spacedMoments(speechAligned, input.sourceDurationSec, (dropped, reason, previous) => {
    const id = ledgerIdOf(dropped);
    const previousId = ledgerIdOf(previous);
    if (id) {
      ledger.reject(id, 'moment_planner', reason, previousId ? {conflictsWith: [previousId]} : {});
    }
  });
  for (const moment of spaced) {
    const momentId = ledgerIdOf(moment);
    let missReason: string | undefined;
    let missCause: string | undefined;
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
          // v2 Directors time everything on the output timeline, so align against output-time words.
          words: (timedFromDirector ? input.captionWords : undefined) ?? input.words ?? [],
          alreadyOutput: timedFromDirector,
          northStar,
          allowStock,
          userBrollOnly: input.userBrollOnly,
          workspace: input.workspace,
          onNorthStarCost: cost => {
            estimatedCostUsd += cost;
          },
          stockDisabledCause,
          onMiss: (reason, cause) => {
            missReason = reason;
            missCause = cause;
          },
        },
      );
      if (!placed) {
        warnings.push(missReason?.startsWith('placement_') ? `moment_refused:${moment.searchKeyword}:${missReason}` : `no_match:${moment.searchKeyword}`);
        if (momentId) {
          ledger.reject(momentId, 'moment_planner', missReason ?? 'no_asset_match', missCause ? {cause: missCause} : {});
        }
        continue;
      }
      if (placed.clip) {
        clips.push(placed.clip);
        clipMeta.set(placed.clip, {momentId, directedStart: timedFromDirector ? moment.timestamp : input.timeline.mapSourceToOutputClamped(moment.timestamp)});
        if (momentId) {
          placedIds.set(placed.clip, momentId);
          ledger.accept(momentId, 'moment_planner', {from: ledger.get(momentId)!.proposed, to: {start: placed.clip.start, end: placed.clip.end}});
        }
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
        if (momentId) {
          placedIds.set(overlay, momentId);
          ledger.accept(momentId, 'moment_planner', {from: ledger.get(momentId)!.proposed, to: {start: overlay.start, end: overlay.end}});
        }
        if (overlay.layout === 'split') {
          splitCount += 1;
        }
      }
    } catch (error) {
      log.warn({error, keyword: moment.searchKeyword}, 'asset lookup failed');
      warnings.push(`stock_failed:${moment.searchKeyword}`);
      if (momentId) {
        ledger.reject(momentId, 'moment_planner', 'stock_lookup_failed', {cause: `stock_search_error:${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`});
      }
    }
  }

  // Leftover user assets are director-owned. Engine does not auto-place them.

  const keptOverlays = dropOverlappingOverlays(overlays, clips, (overlay, reason, conflict) => dropPlaced(overlay, 'plan_assembly', reason, conflict));
  const splitWindows = keptOverlays.filter(overlay => overlay.layout === 'split');
  let cutawaySchedule: ScheduleDecision[] | undefined;
  let scheduleAdjusted = 0;
  const spacedClips =
    jobFlag('cutawayScheduling', env.CUTAWAY_SCHEDULING) === 'beat_preserving'
      ? (() => {
          const byId = new Map<string, BRollClip>();
          const decisions = scheduleCutaways(
            clips.map((clip, index) => {
              const meta = clipMeta.get(clip);
              const id = meta?.momentId ?? `clip_${index}`;
              byId.set(id, clip);
              return {id, start: clip.start, end: clip.end, directedStart: meta?.directedStart ?? clip.start, assetDurationSec: clip.provider === 'user' ? clip.durationSec : undefined};
            }),
            {minGapSec: Math.max(MIN_GAP_SEC, cutawayMinGapSec(listBeatsFromTranscript(input.transcript).length >= 2)), minClipSec: 1.6, maxRetimeSec: MAX_RETIME_SEC, maxDelayPastDirectedSec: 2.5, outputDurationSec: input.timeline.outputDurationSec, tailGuardSec: 0, fitExtensionMaxSec: 1.0},
          );
          cutawaySchedule = decisions;
          const kept: BRollClip[] = [];
          for (const decision of decisions) {
            const clip = byId.get(decision.id)!;
            if (decision.drop || !decision.final) {
              const previousClip = decision.drop ? byId.get(decision.drop.previousClipId) : undefined;
              const id = placedIds.get(clip) ?? ledgerIdOf(clip);
              const previousId = previousClip ? placedIds.get(previousClip) : undefined;
              if (id) {
                ledger.drop(id, 'plan_assembly', decision.drop?.reason ?? 'cutaway_schedule_dropped', {cause: decision.drop ? `${decision.drop.cause}: ${decision.drop.detail}` : undefined, ...(previousId ? {conflictsWith: [previousId]} : {})});
              }
              continue;
            }
            if (decision.adjustments.length > 0) {
              scheduleAdjusted += 1;
              const id = placedIds.get(clip) ?? ledgerIdOf(clip);
              clip.start = decision.final.start;
              clip.end = decision.final.end;
              if (id) {
                ledger.accept(id, 'plan_assembly', {from: decision.resolved, to: decision.final, reason: `cutaway_schedule:${decision.adjustments.map(item => item.code).join(',')}`});
              }
            }
            kept.push(clip);
          }
          return kept;
        })()
      : dropOverlappingClips(clips, (clip, reason, conflict) => dropPlaced(clip, 'plan_assembly', reason, conflict));
  const keptClips = spacedClips.filter(clip => {
    const split = splitWindows.find(window => clip.start < window.end && clip.end > window.start);
    if (split) {
      dropPlaced(clip, 'plan_assembly', 'cutaway_overlaps_split', split);
    }
    return !split;
  });
  if (keptClips.length < clips.length || keptOverlays.length < overlays.length) {
    warnings.push('overlapping_clips_dropped');
  }
  if (scheduleAdjusted > 0) {
    warnings.push(`cutaway_schedule_adjusted:${scheduleAdjusted}`);
  }

  const engineTransitions = planTransitions({
    clips: keptClips,
    overlays: keptOverlays,
    procedural: Boolean(input.editLooks), // WP13B: polish changes the picture with a whip / hard cut, not a light leak
  });
  for (const transition of engineTransitions) {
    placedIds.set(
      transition,
      ledger.propose({
        type: 'transition',
        stage: 'plan_assembly',
        start: transition.at,
        end: transition.at + transition.duration,
        label: transition.keyword,
        reason: 'engine_derived: transition planned next to a cutaway or split',
      }),
    );
  }
  // Director transitions (v2) are validated and merged; a Director transition replaces the engine one at the same cut.
  const transitionMerge = mergeDirectedTransitions({
    engine: engineTransitions,
    directed: direction.transitions,
    outputDurationSec: input.timeline.outputDurationSec,
  });
  for (const outcome of transitionMerge.directed) {
    const id = ids.get(outcome.source);
    if (!id) {
      continue;
    }
    if (outcome.rejected) {
      ledger.reject(id, 'plan_assembly', outcome.rejected);
    } else if (outcome.clip) {
      placedIds.set(outcome.clip, id);
      ledger.accept(id, 'plan_assembly', {to: {start: outcome.clip.at, end: outcome.clip.at + outcome.clip.duration}, ...(outcome.note ? {reason: outcome.note} : {})});
    }
  }
  for (const {engine, by} of transitionMerge.superseded) {
    const id = placedIds.get(engine);
    if (id) {
      ledger.drop(id, 'plan_assembly', 'superseded_by_director_transition', placedIds.get(by) ? {conflictsWith: [placedIds.get(by)!]} : {});
    }
  }
  const transitions = transitionMerge.transitions;

  const cutawayListMode = listBeatsFromTranscript(input.transcript).length >= 2; // the same expression the gate call used inline
  const gated = applyEditorialGate({
    clips: keptClips,
    overlays: keptOverlays,
    transitions,
    zooms: direction.zooms,
    outputDurationSec: input.timeline.outputDurationSec,
    listMode: cutawayListMode,
    relax: northStar,
    onDrop: (item, reason, conflict) => {
      const id = placedIds.get(item) ?? ids.get(item);
      if (id) {
        const conflictId = conflict ? placedIds.get(conflict) : undefined;
        ledger.drop(id, 'editorial_gate', reason, conflictId ? {conflictsWith: [conflictId]} : {});
      }
    },
  });
  warnings.push(...gated.warnings);
  const acceptFromGate = (item: object, span: {start: number; end: number}) => {
    const id = placedIds.get(item) ?? ids.get(item);
    if (id && ledger.get(id)?.events.at(-1)?.decision !== 'dropped') {
      ledger.accept(id, 'editorial_gate', {to: span});
    }
  };
  for (const item of [...gated.clips, ...gated.overlays]) {
    acceptFromGate(item, item);
  }
  for (const zoom of gated.zooms) {
    // analyzeVideo resolves zooms later; the id rides on the object so that stage can attribute its outcome.
    const zoomId = ids.get(zoom);
    if (zoomId) {
      (zoom as {[LEDGER_ID]?: string})[LEDGER_ID] = zoomId;
    }
    acceptFromGate(zoom, {start: proposalContext.toOutput(zoom.timestamp), end: proposalContext.toOutput(zoom.timestamp + zoom.durationSec)});
  }
  for (const transition of gated.transitions) {
    acceptFromGate(transition, {start: transition.at, end: transition.at + transition.duration});
  }

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
          userBrollOnly: input.userBrollOnly,
          alreadyOutput: timedFromDirector,
        })
      : {clips: [] as DepthOverlayClip[], warnings: [] as string[]};
  warnings.push(...depthResolved.warnings);
  recordPlannerOutcome(ledger, ids, direction.depthOverlays ?? [], depthResolved.clips, {
    stage: 'depth_planner',
    plannerIds: (item, index) => [item.assetId || item.userBrollId || `depth_${index}`, `depth_stock_${index}`],
    warnings: depthResolved.warnings,
    toOutput: proposalContext.toOutput,
    startOf: item => item.start,
  });

  const caption = lockCaptionTemplate(
    direction.caption ?? defaultCaptionDirection(input.transcript),
    input.captionTemplate,
  );
  const themeColors = [...(input.themeColorHints ?? []), caption.highlightColor, caption.boxColor, caption.textColor].filter(
    (value): value is string => Boolean(value && /^#([0-9a-f]{6})$/i.test(value)),
  );

  // Frame insets and media containers are remapped HERE, once, so every later stage sees output-time spans.
  // (They used to reach the inset planner in Director time while it treated them as output time.)
  const outToLedgerId = new Map<object, string>();
  const tracked = <T extends {start: number; end: number}>() => {
    const base = remapTrace<T>(ledger, ids);
    return {
      drop: base.drop,
      keep: (item: T, out: T) => {
        base.keep(item, out);
        const id = ids.get(item);
        if (id) {
          outToLedgerId.set(out, id);
        }
      },
    };
  };
  const mediaContainersOut = remapMediaContainers(direction.mediaContainers ?? [], input.timeline, timedFromDirector, tracked<MediaContainerMoment>());
  const frameInsetsOut = remapFrameInsets(direction.frameInsets ?? [], input.timeline, timedFromDirector, tracked<FrameInset>());

  const insetResolved =
    !allowedEdits || allowedEdits.has('inset_reveal')
      ? resolveInsetReveals({
          directed: direction.insetReveals,
          timeline: input.timeline,
          clips: gated.clips,
          overlays: overlaysOut,
          depthOverlays: depthResolved.clips,
          // Cutaway / split / frame-inset / container overlaps are decided by resolveLayoutPriority below, not by order.
          priorityManaged: true,
          frameInsets: frameInsetsOut,
          mediaContainers: mediaContainersOut,
          words: input.captionWords ?? input.words,
          sentences: northStarPack?.sentences,
          themeColors,
          alreadyOutput: timedFromDirector,
        })
      : {clips: [] as InsetRevealClip[], warnings: [] as string[]};
  warnings.push(...insetResolved.warnings);
  recordPlannerOutcome(ledger, ids, direction.insetReveals ?? [], insetResolved.clips, {
    stage: 'inset_planner',
    plannerIds: (_item, index) => [`inset_${index}`],
    warnings: insetResolved.warnings,
    toOutput: proposalContext.toOutput,
    startOf: item => item.start,
  });

  // --- Explicit priority between whole-frame edits (see layoutPriority.ts) -------------------------------
  const directedStartOf = (id: string | undefined, fallback: number) => (id ? ledger.get(id)?.proposed.start : undefined) ?? fallback;
  const insetIdFor = (clip: InsetRevealClip) => {
    const nearest = (direction.insetReveals ?? [])
      .map(item => ({id: ids.get(item), start: proposalContext.toOutput(item.start)}))
      .filter(entry => entry.id)
      .sort((a, b) => Math.abs(a.start - clip.start) - Math.abs(b.start - clip.start))[0];
    return nearest && Math.abs(nearest.start - clip.start) <= 1.5 ? nearest.id : undefined;
  };
  const candidates: Array<LayoutCandidate<{kind: 'clip'; clip: BRollClip} | {kind: 'overlay'; overlay: VisualOverlay} | {kind: 'frame'; inset: FrameInset} | {kind: 'container'; container: MediaContainerMoment} | {kind: 'reveal'; reveal: InsetRevealClip}>> = [];
  const idOfItem = (item: (typeof candidates)[number]['item']): string | undefined =>
    item.kind === 'clip' ? placedIds.get(item.clip) : item.kind === 'overlay' ? placedIds.get(item.overlay) : item.kind === 'frame' ? outToLedgerId.get(item.inset) : item.kind === 'container' ? outToLedgerId.get(item.container) : insetIdFor(item.reveal);
  for (const clip of gated.clips) {
    candidates.push({item: {kind: 'clip', clip}, kind: 'cutaway', userSupplied: clip.provider === 'user', start: clip.start, end: clip.end, directedStart: directedStartOf(placedIds.get(clip), clip.start)});
  }
  for (const overlay of overlaysOut) {
    if (overlay.layout === 'split' || overlay.layout === 'cutout' || overlay.layout === 'composite' || overlay.layout === 'cutaway') {
      candidates.push({item: {kind: 'overlay', overlay}, kind: overlay.layout === 'cutaway' ? 'cutaway' : overlay.layout, userSupplied: overlay.provider === 'user', start: overlay.start, end: overlay.end, directedStart: directedStartOf(placedIds.get(overlay), overlay.start)});
    }
  }
  for (const inset of frameInsetsOut) {
    candidates.push({item: {kind: 'frame', inset}, kind: 'frame_inset', start: inset.start, end: inset.end, directedStart: directedStartOf(outToLedgerId.get(inset), inset.start)});
  }
  for (const container of mediaContainersOut) {
    candidates.push({item: {kind: 'container', container}, kind: 'media_container', start: container.start, end: container.end, directedStart: directedStartOf(outToLedgerId.get(container), container.start)});
  }
  for (const reveal of insetResolved.clips) {
    candidates.push({item: {kind: 'reveal', reveal}, kind: 'inset_reveal', start: reveal.start, end: reveal.end, directedStart: directedStartOf(insetIdFor(reveal), reveal.start)});
  }
  const losses = resolveLayoutPriority(candidates);
  const lostClips = new Set<BRollClip>();
  const lostOverlays = new Set<VisualOverlay>();
  const lostFrames = new Set<FrameInset>();
  const lostContainers = new Set<MediaContainerMoment>();
  const lostReveals = new Set<InsetRevealClip>();
  for (const loss of losses) {
    const lostId = idOfItem(loss.item);
    const winnerId = idOfItem(loss.winner);
    if (lostId) {
      ledger.drop(lostId, 'plan_assembly', loss.reason, winnerId ? {conflictsWith: [winnerId]} : {});
    }
    warnings.push(`layout_priority:${loss.kind}_dropped:${loss.reason}`);
    const lost = loss.item;
    if (lost.kind === 'clip') lostClips.add(lost.clip);
    else if (lost.kind === 'overlay') lostOverlays.add(lost.overlay);
    else if (lost.kind === 'frame') lostFrames.add(lost.inset);
    else if (lost.kind === 'container') lostContainers.add(lost.container);
    else lostReveals.add(lost.reveal);
  }
  let clipsFinal = gated.clips.filter(clip => !lostClips.has(clip));
  const overlaysFinal = overlaysOut.filter(overlay => !lostOverlays.has(overlay));
  const frameInsetsFinal = frameInsetsOut.filter(inset => !lostFrames.has(inset));
  const mediaContainersFinal = mediaContainersOut.filter(container => !lostContainers.has(container));
  const insetRevealsFinal = insetResolved.clips.filter(reveal => !lostReveals.has(reveal));
  // A transition belongs to a cut; when its cut lost on priority the transition goes with it.
  const transitionsFinal = gated.transitions.filter(transition => {
    const nearVisual =
      clipsFinal.some(clip => Math.abs(clip.start - transition.at) < 0.6) ||
      overlaysFinal.some(overlay => (overlay.layout === 'split' || overlay.layout === 'composite' || overlay.layout === 'cutaway') && Math.abs(overlay.start - transition.at) < 0.6);
    if (!nearVisual && (lostClips.size > 0 || lostOverlays.size > 0)) {
      const id = placedIds.get(transition);
      if (id) {
        ledger.drop(id, 'plan_assembly', 'transition_cut_removed_by_layout_priority');
      }
      return false;
    }
    return true;
  });

  const hookTitle = direction.hookTitle?.trim() || '';
  // optional policy + no title: there is no hook element, so it has no time window either (nothing downstream may reserve one).
  const noHook = jobFlag('hookTitlePolicy', env.HOOK_TITLE_POLICY) === 'optional' && !hookTitle;
  const hookStartSec = noHook ? 0 : round(
    Math.max(0, direction.hookStartSec ?? 0),
  );
  const hookHoldSec = noHook ? 0 : round(
    Math.max(
      0,
      (direction.hookEndSec ?? hookStartSec) - hookStartSec || hookDurationSec,
    ),
  );

  if (hookLedgerId && hookTitle) {
    ledger.accept(hookLedgerId, 'plan_assembly', {to: {start: hookStartSec, end: hookStartSec + hookHoldSec}});
  }

  // WP29 backstop: a `brollClips` entry is a VIDEO. A user still (solid or not) that reached the clip list by any branch is dropped (stills go through media cards / ImageRun), with a warning.
  const stillGate = stripFullFrameStillClips(clipsFinal, new Set(suppliedUserAssets.filter(asset => asset.solidLike).map(asset => asset.url)));
  if (stillGate.dropped.length > 0) {
    warnings.push(...solidStillWarnings(stillGate.dropped));
    clipsFinal = stillGate.clips;
  }

  // WP1 backstop: under the creator-B-roll-only contract nothing that is not a supplied creator asset may reach the blueprint, whatever branch produced it.
  let clipsOut = clipsFinal;
  let overlaysOut2 = overlaysFinal;
  let depthOut = depthResolved.clips;
  if (input.userBrollOnly) {
    const enforced = enforceUserBrollContract({clips: clipsFinal, overlays: overlaysFinal, depthOverlays: depthResolved.clips, suppliedUrls: suppliedUserAssets.map(asset => asset.url)});
    clipsOut = enforced.clips;
    overlaysOut2 = enforced.overlays;
    depthOut = enforced.depthOverlays;
    if (enforced.dropped.length > 0) {
      warnings.push(`user_broll_contract_dropped:${enforced.dropped.length}`);
    }
  }

  const plan: VisualPlan = {
    hookTitle,
    hookSubtitle: '',
    hookStyle: direction.hookStyle,
    hookDurationSec: hookHoldSec,
    hookStartSec,
    caption,
    suggestedLutIds: direction.suggestedLutIds ?? [],
    preferredLutId: direction.preferredLutId ?? '',
    clips: clipsOut.sort((a, b) => a.start - b.start),
    overlays: overlaysOut2,
    depthOverlays: depthOut,
    insetReveals: insetRevealsFinal,
    ...(direction.kineticType ? {kineticTypeDirected: direction.kineticType} : {}),
    transitions: jobFlag('generatedTransitions', env.GENERATED_TRANSITIONS_ENABLED) ? transitionsFinal.map(transition => (transition.assetUrl ? transition : {...transition, renderGenerated: true})) : transitionsFinal,
    motionGraphics: remapMotionGraphics(
      direction.motionGraphics ?? [],
      input.timeline,
      timedFromDirector,
      remapTrace<MotionGraphic>(ledger, ids),
    ),
    mediaContainers: mediaContainersFinal,
    frameInsets: frameInsetsFinal,
    ...((direction.gradeBeats ?? []).length > 0 ? {gradeBeats: direction.gradeBeats} : {}),
    semanticEmphasis: remapSemanticEmphasis(
      direction.semanticEmphasis ?? [],
      input.timeline,
      timedFromDirector,
      remapTrace<SemanticEmphasis>(ledger, ids),
    ),
    zooms: gated.zooms,
    warnings,
    ...(plateAnchors.length > 0 ? {plateAnchors} : {}),
    ...(explainPlateGaps.length > 0 ? {explainPlateGaps} : {}),
    ledger,
    ...(proposedDirection.parseRejections?.length ? {parseRejections: proposedDirection.parseRejections} : {}),
    ...(proposedDirection.fallbackSubstitutions?.length ? {fallbackSubstitutions: proposedDirection.fallbackSubstitutions} : {}),
    ...(proposedDirection.fallbackReason ? {directorFallbackReason: proposedDirection.fallbackReason} : {}),
    ...(proposedDirection.openingRaw ? {openingRaw: proposedDirection.openingRaw} : {}),
    ...(proposedDirection.directorProvenance ? {directorProvenance: proposedDirection.directorProvenance} : {}),
    ...(cutawaySchedule ? {cutawaySchedule} : {}),
    // WP3B: recording only, and only under the creator-B-roll-only (mvp) contract: the gap the gate enforced and the hook policy in effect.
    ...(input.userBrollOnly
      ? {evidence: {version: 1 as const, plannerMinGapSec: cutawayMinGapSec(cutawayListMode), plannerMinGapAppliesTo: 'cutaway_clips' as const, hookTitlePolicy: jobFlag('hookTitlePolicy', env.HOOK_TITLE_POLICY)}}
      : {}),
    ...(input.visualContext || northStarPack?.visualContext ? {visualContext: input.visualContext ?? northStarPack?.visualContext} : {}),
    estimatedCostUsd,
    editThesis,
    editThesisParts,
    directorReport,
    cta,
    audioDesign,
    ...(musicPending ? {musicPending} : {}),
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
    frameInsets: plan.frameInsets,
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
    /** Director v2 / north-star: moment timestamps and `words` are already OUTPUT-timeline seconds. */
    alreadyOutput?: boolean;
    northStar?: boolean;
    allowStock?: boolean;
    /** WP1: exact-id creator assets only. */
    userBrollOnly?: boolean;
    workspace?: {file: (name: string) => string};
    onNorthStarCost?: (cost: number) => void;
    /** Observation only: why a moment produced nothing, with a finer cause where known. */
    onMiss?: (reason: string, cause?: string) => void;
    /** Why `allowStock` is false (observation only). */
    stockDisabledCause?: string;
  },
): Promise<{clip?: BRollClip; overlay?: VisualOverlay} | null> {
  const miss = (reason: string, cause?: string): null => {
    ctx.onMiss?.(reason, cause);
    return null;
  };
  const stockCause = (): string => {
    const parts = [
      ...(ctx.allowStock ? [] : [ctx.stockDisabledCause ?? 'stock_disabled:not_allowed']),
      ...(stockConfigured() ? [] : ['stock_unconfigured']),
    ];
    return parts.join('+');
  };
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
  const toOut = (sec: number) => (ctx.alreadyOutput ? clamp(sec, 0, ctx.timeline.outputDurationSec) : ctx.timeline.mapSourceToOutputClamped(sec));
  let start = toOut(hold.start);
  const minHold =
    moment.treatment === 'slideshow'
      ? 3.6
      : moment.layout === 'split'
        ? 3.8
        : textLayout
          ? 2.4
          : 1.6;
  let end = clamp(
    toOut(hold.end),
    start + minHold,
    ctx.timeline.outputDurationSec,
  );
  if (end - start < 0.9) {
    return miss('hold_window_too_short');
  }
  const guard = textLayout ? 0.7 : HOOK_GUARD_SEC;
  if (start < guard && ctx.timeline.outputDurationSec > guard + 2) {
    if (moment.layout !== 'cutaway') {
      return miss('inside_hook_guard');
    }
    start = guard;
    end = clamp(Math.max(end, start + minHold), start + minHold, ctx.timeline.outputDurationSec);
  }

  const directedOutputSec = toOut(moment.timestamp);
  if (Math.abs(start - directedOutputSec) > MAX_RETIME_SEC) {
    return miss(`placement_${round(start)}s_is_${round(Math.abs(start - directedOutputSec))}s_from_directed_${round(directedOutputSec)}s_limit_${MAX_RETIME_SEC}s`);
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
        if (fullFrameStillPolicy({url: userAsset.url, kind: userAsset.kind, solidLike: userAsset.solidLike}) === 'refuse_solid') return miss(`placement_${SOLID_STILL_REFUSED}`, `${userAsset.id}:solid_or_near_solid_still_as_split`);
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
                  moment.speakerSide ?? pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
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
            moment.speakerSide ?? pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
          ),
        };
      }
      // WP29: a user STILL is never a full-frame `brollClips` world. Solid / near-solid color is refused outright; a real still becomes a framed media card.
      const stillPolicy = fullFrameStillPolicy({url: userAsset.url, kind: userAsset.kind, solidLike: userAsset.solidLike});
      if (stillPolicy === 'refuse_solid') return miss(`placement_${SOLID_STILL_REFUSED}`, `${userAsset.id}:solid_or_near_solid_still_as_cutaway`);
      ctx.usedUserIds.add(userAsset.id);
      if (stillPolicy === 'media_card') {
        return {overlay: toDesignedCard(moment, userAsset, start, end, 0)};
      }
      return {
        clip: toUserClip(moment, userAsset, start, end),
      };
    }

    if (!ctx.allowStock || !stockConfigured()) {
      return miss('stock_disabled_or_unconfigured', stockCause());
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
              moment.speakerSide ?? pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
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
            moment.speakerSide ?? pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
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
        return miss('no_stock_photos');
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
        moment.speakerSide ?? pickSpeakerSide(moment.searchKeyword, ctx.splitCount),
      );
      return {
        overlay: photos.length >= 2 ? withSlides(overlay, slidesFromStock(photos)) : overlay,
      };
    }
    return miss('no_stock_video', 'stock_search_ran_no_result');
  }

  if (moment.layout === 'cutout' || moment.layout === 'composite') {
    const userAsset = pickUserBrollForMoment(moment, ctx);
    if (userAsset) {
      if (fullFrameStillPolicy({url: userAsset.url, kind: userAsset.kind, solidLike: userAsset.solidLike}) === 'refuse_solid') return miss(`placement_${SOLID_STILL_REFUSED}`, `${userAsset.id}:solid_or_near_solid_still_as_${moment.layout}`);
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
      return miss('stock_disabled_or_unconfigured', stockCause());
    }
    const queries = momentQueries(
      moment.searchKeyword,
      ctx.subject,
      [...(moment.queries ?? []), ...ctx.visualQueries.slice(0, 4)],
    );
    const wantSlides = moment.treatment === 'slideshow' || end - start >= 3.6;
    const photos = await collectPhotos(queries, ctx.usedPhotoKeys, wantSlides ? 4 : 1);
    if (photos.length === 0) {
      return miss('no_stock_photos');
    }
    for (const photo of photos) {
      ctx.usedPhotoKeys.add(stockAssetKeyOf(photo));
    }
    const overlay = toOverlay(moment, photos[0]!, start, end, 'image', 'card');
    return {
      overlay: photos.length >= 2 ? withSlides(overlay, slidesFromStock(photos)) : overlay,
    };
  }

  return miss('unsupported_layout');
}

function pickUserBrollForMoment(
  moment: DirectedMoment,
  ctx: {
    usedUserIds: Set<string>;
    userBrollById: Map<string, UserBrollAsset>;
    allowStock?: boolean;
    userBrollOnly?: boolean;
  },
): UserBrollAsset | null {
  if (ctx.userBrollOnly) {
    return pickTaggedUserAsset(moment.userBrollId, ctx.userBrollById); // WP1: exact id or nothing
  }
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
  const leftoverPhotos = leftovers.filter(asset => isStillUserAsset(asset) && fullFrameStillPolicy({url: asset.url, kind: asset.kind, solidLike: asset.solidLike}) !== 'refuse_solid'); // WP29: flat-color stills are never auto-placed
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
  ctx: {usedUserIds: Set<string>; userBrollById: Map<string, UserBrollAsset>; userBrollOnly?: boolean},
  seed: UserBrollAsset,
): UserBrollAsset[] {
  return stillsForSlideshow(seed, ctx.userBrollById, ctx.usedUserIds, {userBrollOnly: ctx.userBrollOnly});
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

function spacedMoments<M extends DirectedMoment>(
  moments: M[],
  durationSec: number,
  onDrop?: (moment: M, reason: string, previous: M) => void,
): M[] {
  const sorted = [...moments].sort((a, b) => a.timestamp - b.timestamp);
  const out: M[] = [];
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
          onDrop?.(moment, 'speech_locked_moment_within_2.6s_of_previous', previous);
          continue;
        }
        out.push({...moment, timestamp});
        continue;
      }
      const keep =
        moment.layout === 'lockup' && moment.textStyle === 'stack';
      const nudged = previous.timestamp + 5.2;
      if (!keep || nudged > durationSec - 2.8) {
        onDrop?.(moment, 'moment_within_5s_of_previous', previous);
        continue;
      }
      out.push({...moment, timestamp: nudged});
      continue;
    }
    out.push({...moment, timestamp});
  }
  return out;
}

function dropOverlappingClips(
  clips: BRollClip[],
  onDrop?: (clip: BRollClip, reason: string, conflict: BRollClip) => void,
): BRollClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const out: BRollClip[] = [];
  for (const clip of sorted) {
    const previous = out.at(-1);
    if (previous && clip.start < previous.end + MIN_GAP_SEC) {
      onDrop?.(clip, `clip_within_${MIN_GAP_SEC}s_of_previous_clip`, previous);
      continue;
    }
    out.push(clip);
  }
  return out;
}

function dropOverlappingOverlays(
  overlays: VisualOverlay[],
  clips: BRollClip[],
  onDrop?: (overlay: VisualOverlay, reason: string, conflict?: BRollClip | VisualOverlay) => void,
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
      onDrop?.(overlay, 'overlay_overlaps_cutaway', clips.find(clip => overlay.start < clip.end && overlay.end > clip.start));
      continue;
    }
    const hitsKept = out.find(
      previous => overlay.start < previous.end + MIN_GAP_SEC && overlay.end > previous.start - MIN_GAP_SEC,
    );
    if (hitsKept && overlay.layout !== 'pip' && overlay.layout !== 'sticker') {
      onDrop?.(overlay, `overlay_within_${MIN_GAP_SEC}s_of_previous_overlay`, hitsKept);
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
  procedural?: boolean;
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
    keyword: input.procedural ? cutTransitionKeyword(index) : TRANSITION_QUERIES[index % TRANSITION_QUERIES.length]!,
    assetUrl: '',
    blend: index % 2 === 0 ? 'screen' : 'lighten',
    provider: 'generated',
    providerId: 0,
    width: 1080,
    height: 1920,
    credit: '',
    creditUrl: '',
    ...(input.procedural ? {renderGenerated: true} : {}),
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

type RemapTrace<T> = {
  drop: (item: T, reason: string) => void;
  keep: (item: T, out: T) => void;
};

/** Shared tail of the remap functions: report drops and cap overflow, return the capped outputs. */
function finishRemap<T>(pairs: Array<{src: T; out: T | null; reason: string}>, cap: number, trace?: RemapTrace<T>): T[] {
  const kept: Array<{src: T; out: T}> = [];
  for (const pair of pairs) {
    if (pair.out) {
      // The remap rebuilt the edit with a spread, which drops design-value provenance: carry it from the Director's edit.
      carryProvenance(pair.src as object, pair.out as object);
      kept.push({src: pair.src, out: pair.out});
    } else {
      trace?.drop(pair.src, pair.reason);
    }
  }
  // The cap keeps the EARLIEST edits in the video, whatever order the Director listed them in
  // (it used to keep the first N in array order, so the surviving set depended on the response's ordering).
  kept.sort((a, b) => {
    const x = a.out as unknown as {start: number; end: number};
    const y = b.out as unknown as {start: number; end: number};
    return x.start - y.start || x.end - y.end;
  });
  kept.forEach((pair, index) => {
    if (index < cap) {
      trace?.keep(pair.src, pair.out);
    } else {
      trace?.drop(pair.src, `over_cap_${cap}`);
    }
  });
  return kept.slice(0, cap).map(pair => pair.out);
}

function remapMotionGraphics(
  graphics: MotionGraphic[],
  timeline: Timeline,
  alreadyOutput = false,
  trace?: RemapTrace<MotionGraphic>,
): MotionGraphic[] {
  const pairs = graphics.map((graphic): {src: MotionGraphic; out: MotionGraphic | null; reason: string} => {
      const start = alreadyOutput
        ? clamp(graphic.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(graphic.start);
      const end = alreadyOutput
        ? clamp(graphic.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(graphic.end);
      if (end - start < 1.8 || start < 0.55) {
        return {src: graphic, out: null, reason: 'shorter_than_1.8s_or_inside_first_0.55s'};
      }
      return {
        src: graphic,
        reason: '',
        out: {
        ...graphic,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 2.2, end))),
      },
      };
    });
  return finishRemap(pairs, 6, trace);
}

function remapMediaContainers(
  containers: MediaContainerMoment[],
  timeline: Timeline,
  alreadyOutput = false,
  trace?: RemapTrace<MediaContainerMoment>,
): MediaContainerMoment[] {
  const pairs = containers.map((container): {src: MediaContainerMoment; out: MediaContainerMoment | null; reason: string} => {
      const start = alreadyOutput
        ? clamp(container.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(container.start);
      const end = alreadyOutput
        ? clamp(container.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(container.end);
      if (end - start < 2.4 || start < HOOK_GUARD_SEC) {
        return {src: container, out: null, reason: 'shorter_than_2.4s_or_inside_hook_guard'};
      }
      return {
        src: container,
        reason: '',
        out: {
        ...container,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 2.4, end))),
      },
      };
    });
  return finishRemap(pairs, 3, trace);
}

function remapFrameInsets(
  insets: FrameInset[],
  timeline: Timeline,
  alreadyOutput = false,
  trace?: RemapTrace<FrameInset>,
): FrameInset[] {
  const pairs = insets.map((inset): {src: FrameInset; out: FrameInset | null; reason: string} => {
      const start = alreadyOutput
        ? clamp(inset.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(inset.start);
      const end = alreadyOutput
        ? clamp(inset.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(inset.end);
      if (end - start < 3.2 || start < HOOK_GUARD_SEC) {
        return {src: inset, out: null, reason: 'shorter_than_3.2s_or_inside_hook_guard'};
      }
      const rebuilt: FrameInset = {
        ...inset,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + 3.8, end))),
        scale: Math.min(0.94, Math.max(0.7, inset.scale || 0.86)),
        marginColor: inset.marginColor || '#000000',
      };
      if (!inset.marginColor) {
        // No colour reached the remap: the #000000 below is this stage's constant, not anything the Director chose.
        stampProvenance(rebuilt, {marginColor: 'default'});
      }
      return {src: inset, reason: '', out: rebuilt};
    });
  return finishRemap(pairs, 2, trace);
}

function remapSemanticEmphasis(
  emphasis: SemanticEmphasis[],
  timeline: Timeline,
  alreadyOutput = false,
  trace?: RemapTrace<SemanticEmphasis>,
): SemanticEmphasis[] {
  const pairs = emphasis.map((item): {src: SemanticEmphasis; out: SemanticEmphasis | null; reason: string} => {
      const start = alreadyOutput
        ? clamp(item.start, 0, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(item.start);
      const end = alreadyOutput
        ? clamp(item.end, start, timeline.outputDurationSec)
        : timeline.mapSourceToOutputClamped(item.end);
      if (end - start < 0.9 || start < 0.55) {
        return {src: item, out: null, reason: 'shorter_than_0.9s_or_inside_first_0.55s'};
      }
      const minHold = item.treatment === 'count' ? 2.1 : 1.2;
      return {
        src: item,
        reason: '',
        out: {
        ...item,
        start: round(start),
        end: round(Math.min(timeline.outputDurationSec, Math.max(start + minHold, end))),
      },
      };
    });
  return finishRemap(pairs, 5, trace);
}

/** WP10H: the caption highlight that replaces a neon blue-green one on the polish path. */
export const POLISH_HIGHLIGHT_FALLBACK = '#F5B942';
