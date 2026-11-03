/**
 * Generated motion graphics stage for analyzeVideo (opt-in):
 * Gemini directs briefs over the finished edit → Claude implements them →
 * validated modules in R2 → blueprint `generatedGraphics[]`.
 */

import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {noteBillingFailure} from '../../lib/billingGuard.ts';
import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import type {EditLedger} from '../../lib/editLedger.ts';
import type {ContentProfile} from '../contentProfile/contentProfile.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {GeneratedGraphic} from '../../types/blueprint.ts';
import type {MotionWorkerOptions} from '../../motionWorker/worker.ts';
import {buildLabeledAssetBrief} from '../broll/labeledAssetBrief.ts';
import {withShortFormLook} from '../../lib/shortFormLook.ts';
import {buildGeneratedGraphics, occupiedByExistingEdits, type GeneratedGraphicsOutcome} from './buildGeneratedGraphics.ts';
import {addLibrarySeeds} from './libraryFallback.ts';
import {mergeOutcomes, runClaudeExplainPlates} from './claudePlates.ts';
import {raisePolishProfileCap} from './polishProfileCap.ts';
import {behindSubjectColors, type RegionStats} from '../openingPlan/colorRoles.ts';
import {decideTextTreatment, type BehindSubjectEntry} from '../textTreatment/textTreatment.ts';
import {directMotionGraphics, type MotionDirectorResult, type TimedWord} from './motionDirector.ts';

const log = stageLogger('motion-graphics-stage');

export type MotionGraphicsStageInput = {
  transcript: string;
  words: TimedWord[];
  outputDurationSec: number;
  languageCode: string;
  edit: Parameters<typeof occupiedByExistingEdits>[0];
  speakerBox?: {x: number; y: number; w: number; h: number};
  /** WP3N: set instead of `speakerBox` when the speaker was not detected (mvp). */
  speakerUnknown?: boolean;
  framePath?: string;
  captionBottomFrac?: number;
  /** Caption position, so the Director keeps PiP/overlay boxes out of the caption band. */
  captionPosition?: 'bottom' | 'lower_third' | 'center' | 'top';
  artifactsDir?: string;
  /** Decided before the edit: caps and steers the graphics, and supplies the per-video theme. */
  contentProfile?: ContentProfile | null;
  /** Records the motion stage's proposals, refusals and worker outcomes. */
  ledger?: EditLedger;
  /** Opt-in (Phase 34): the whole video for the motion Director (see MotionDirectorInput.videoPart). */
  videoPart?: {mimeType: string; data: string; bytes?: number};
  /**
   * Opt-in (Phase 34): worker overrides. `upload` lets a caller keep compiled modules local instead of publishing them to R2; `maxRepairAttempts`
   * and `generator` let a caller bound or meter the Claude calls. Absent: the worker's defaults (R2 upload, 2 repairs), exactly as before.
   */
  /**
   * True only when a real foreground matte exists (an alpha video of the speaker that passed the renderer's usability gate). Default false: a
   * `behind_subject` text request is then delivered as a layered panel and the downgrade is recorded.
   */
  subjectMatteUsable?: boolean;
  /** Opt-in (Phase 35): the generated-graphics theme from the Director's validated colour roles. Wins over the content profile's theme. */
  themeOverride?: Record<string, unknown>;
  /**
   * Measures the footage behind a frame-relative box over an output-time span. Required for behind-subject text: with no measurement there are no proven text
   * colours, so such a request is delivered as a layered panel instead.
   */
  measureText?: (box: {x: number; y: number; w: number; h: number}, span: {start: number; end: number}) => Promise<RegionStats>;
  /** Text and panel colours (the Director's validated roles) used to pick behind-subject text colours. */
  textRoles?: {primary_text: string; panel: string};
  workerOptions?: Pick<MotionWorkerOptions, 'upload' | 'maxRepairAttempts' | 'generator'>;
  /** WP8D: deliver briefs that fit a `@finalpost/motion` composition from the library (no Claude call); the Claude generator stays the fallback. Set for the polish profile. */
  preferLibrary?: boolean;
  /** WP8E: false = the Claude generator is never called (library hits only; a miss is dropped with `motion_graphic:library_miss_no_claude`). Default true. */
  claudeAllowed?: boolean;
  /** WP8J: the Edit Look chosen for this edit (from the `edit_look:<id>` warning), so the library seed respects its graphic cap and tags. Absent: the seed's own cap. */
  lookId?: string | null;
  /** WP8N: the legibility pass's own copy-grounding rule, handed in by analyzeVideo so library-only mode can drop Director briefs with unspoken words BEFORE counting library hits (they would be removed later anyway). */
  isCopyGrounded?: (content: Record<string, unknown>) => boolean;
  /** WP9A: explain-plate path (polish, no creator B-roll): seed one library plate per engagement window. */
  explainPlates?: boolean;
  /** WP9B: required plates from the polish plan (explain-plate path). */
  plateAnchors?: import('./transcriptLibrarySeed.ts').PlateAnchor[];
  /** WP33: chapter cards planned by the VO cut grammar (explain-plate path only): each becomes a short white FlashCard on a spoken word. Absent / empty: nothing changes. */
  chapterCards?: ReadonlyArray<{at: number; duration: number; text: string; wordIndex: number}>;
};

export type MotionGraphicsStageResult = {
  generatedGraphics: GeneratedGraphic[];
  director: MotionDirectorResult | null;
  worker: GeneratedGraphicsOutcome | null;
  geminiCostUsd: number;
  claudeCostUsd: number;
  warnings: string[];
  /** Set only when the motion Director call itself failed (the stage still continues without graphics). Additive: nothing outside strict runs reads it. */
  directorFailure?: {reason: string};
  /** Text drawn between the footage and the speaker's matte (only ever non-empty when `subjectMatteUsable`). */
  behindSubjectTexts: BehindSubjectEntry[];
  /** One line per requested text treatment: how it was delivered, including honest downgrades. */
  /** WP10A: the open / thumbnail plate was delivered over the hook window: the caller drops the standard hook title (the plate IS the opening). */
  suppressHookTitle?: boolean;
  textTreatments: Array<{id: string; kind: string; delivered: 'behind_subject_track' | 'toolkit'; downgradedFrom?: 'behind_subject'; note: string}>;
};

/** Same estimate as Remotion's captionBandFor (two caption lines ≈ 13% of the frame), as fractions. */
function captionBandFraction(position: MotionGraphicsStageInput['captionPosition'], bottomFrac: number) {
  if (position === 'top') {
    return {top: 0.12, bottom: 0.25};
  }
  if (position === 'center') {
    return {top: 0.435, bottom: 0.565};
  }
  return {top: Math.max(0, 1 - bottomFrac - 0.13), bottom: 1 - bottomFrac};
}

/** WP8G: a short, safe reason for a failed motion Director: `edit_request_limit` for the Gemini attempt cap (the error's `details.reason`), else the engine error code, else `error`. Never a prompt, key or provider body. */
export function motionDirectorFailureReason(error: unknown): string {
  // The Gemini attempt cap throws an EngineError carrying `details.reason`; read structurally so this stage does not import the budget module.
  if ((error as {details?: {reason?: unknown}} | null)?.details?.reason === 'edit_request_limit') return 'edit_request_limit';
  const code = (error as {code?: unknown} | null)?.code;
  return typeof code === 'string' && /^[a-z_]{2,40}$/.test(code) ? code : 'error';
}

export async function runMotionGraphicsStage(input: MotionGraphicsStageInput): Promise<MotionGraphicsStageResult> {
  const warnings: string[] = [];
  // WP8J: library-only mode (polish, no Claude allowed): a failed or library-less motion Director no longer ends the stage; pure transcript seeds take its place (below).
  // WP9E: on the polish explain-plate path the library seeds (+ plate anchors) ALWAYS run, whether or not Claude is allowed; Claude only ever fills what they left uncovered (below).
  const seedMode = Boolean(input.preferLibrary) && (input.claudeAllowed === false || Boolean(input.explainPlates));
  let directorFailure: {reason: string} | undefined;
  let director: MotionDirectorResult;
  // WP8W: polish (preferLibrary) does not let a sparse content profile (cap 1) starve the motion stage; density none / cap 0 is still honoured.
  const raised = input.preferLibrary ? raisePolishProfileCap(input.contentProfile, input.outputDurationSec) : {profile: input.contentProfile};
  const contentProfile = raised.profile;
  if (raised.warning) warnings.push(raised.warning);
  try {
    director = await directMotionGraphics({
      transcript: input.transcript,
      words: input.words,
      outputDurationSec: input.outputDurationSec,
      languageCode: input.languageCode,
      occupied: occupiedByExistingEdits(input.edit),
      speakerBox: input.speakerBox,
      ...(input.speakerUnknown ? {speakerUnknown: true} : {}),
      framePath: input.framePath && existsSync(input.framePath) ? input.framePath : undefined,
      captionBand: captionBandFraction(input.captionPosition, input.captionBottomFrac ?? 0.16),
      contentProfile: contentProfile ?? undefined,
      videoPart: input.videoPart,
      libraryBriefs: input.preferLibrary, // WP8H: ask for content keys the library resolves (polish only)
    });
  } catch (error) {
    log.warn({error}, 'motion graphics director failed; continuing without generated graphics');
    // WP8G: the bare `motion_director_failed` stays (verdict rules match it exactly); the reason follows as a second warning.
    if (seedMode) {
      directorFailure = {reason: error instanceof Error ? error.message : String(error)};
      warnings.push('motion_director_failed', `motion_director_failed:${motionDirectorFailureReason(error)}`);
      director = {graphics: [], refusals: [], notes: 'motion Director failed; library seed', costUsd: 0, model: 'library_seed', latencyMs: 0, raw: null};
    } else {
    return {generatedGraphics: [], director: null, worker: null, geminiCostUsd: 0, claudeCostUsd: 0, warnings: ['motion_director_failed', `motion_director_failed:${motionDirectorFailureReason(error)}`], behindSubjectTexts: [], textTreatments: [], directorFailure: {reason: error instanceof Error ? error.message : String(error)}};
    }
  }
  let openPlateId: string | undefined;
  // WP8J: seed 1-2 library graphics from the transcript when the Director gave the library nothing to draw. No Gemini call, no Claude call; the same assembly guards as a Director brief.
  if (seedMode) {
    const seeded = addLibrarySeeds(director, {
      words: input.words,
      outputDurationSec: input.outputDurationSec,
      occupied: occupiedByExistingEdits(input.edit),
      captionBand: captionBandFraction(input.captionPosition, input.captionBottomFrac ?? 0.16),
      contentProfile: contentProfile ?? undefined,
      lookId: input.lookId,
      speakerBox: input.speakerBox,
      speakerUnknown: input.speakerUnknown,
      explainPlates: input.explainPlates,
      plateAnchors: input.plateAnchors,
      chapterCards: input.chapterCards, // WP33
      // WP17: the labeled-asset slot windows (the same pure brief the app shows) so a flash card is not dropped into the middle of a window the creator's upload will fill
      assetSlotWindows: input.explainPlates ? buildLabeledAssetBrief({words: input.words, outputDurationSec: input.outputDurationSec}).slots.map(slot => ({start: slot.startSec, end: slot.endSec})) : undefined,
      isCopyGrounded: input.isCopyGrounded, // WP8N: the grounding rule the legibility pass applies later (passed in by analyzeVideo)
    });
    director = seeded.director;
    openPlateId = seeded.openPlateId;
    warnings.push(...seeded.warnings);
  }
  // Text treatments: each request is delivered by the toolkit (via Claude) or, with a real matte, by the behind-subject track. No Claude call is made for the latter.
  const behindSubjectTexts: BehindSubjectEntry[] = [];
  const textTreatments: MotionGraphicsStageResult['textTreatments'] = [];
  const toolkitGraphics: typeof director.graphics = [];
  const trackIds = new Set<string>();
  for (const graphic of director.graphics) {
    const requested = graphic.brief.textTreatment;
    if (!requested) {
      toolkitGraphics.push(graphic);
      continue;
    }
    let behindColors: ReturnType<typeof behindSubjectColors> = null;
    if (requested.kind === 'behind_subject' && input.subjectMatteUsable === true && input.measureText) {
      const widthFrac = requested.widthFrac ?? 0.9;
      const centerY = requested.centerY ?? 0.3;
      try {
        const stats = await input.measureText({x: (1 - widthFrac) / 2, y: centerY - 0.1, w: widthFrac, h: 0.2}, {start: graphic.start, end: graphic.end});
        behindColors = behindSubjectColors(stats, input.textRoles ?? {primary_text: '#FFFFFF', panel: '#0B0F19'});
      } catch (error) {
        // No measurement, no proven colours: the request is delivered as a panel (see decideTextTreatment), never in a guessed colour.
        log.warn({error, id: graphic.brief.id}, 'could not measure the footage behind behind-subject text');
      }
    }
    const decision = decideTextTreatment(requested, {matteUsable: input.subjectMatteUsable === true, speakerBox: input.speakerBox, ...(input.speakerUnknown ? {speakerUnknown: true} : {}), start: graphic.start, end: graphic.end, reason: graphic.reason, behindColors});
    if (decision.route === 'behind_subject_track') {
      behindSubjectTexts.push(decision.entry);
      trackIds.add(graphic.brief.id);
      textTreatments.push({id: graphic.brief.id, kind: requested.kind, delivered: 'behind_subject_track', note: decision.note});
    } else {
      toolkitGraphics.push({...graphic, brief: {...graphic.brief, textTreatment: decision.treatment}});
      textTreatments.push({id: graphic.brief.id, kind: requested.kind, delivered: 'toolkit', ...(decision.downgradedFrom ? {downgradedFrom: decision.downgradedFrom} : {}), note: decision.note});
      if (decision.downgradedFrom) {
        warnings.push(`text_treatment_downgraded:${graphic.brief.id}:behind_subject`);
      }
    }
  }
  warnings.push(...director.refusals.map(refusal => `motion_refused:${refusal.id}:${refusal.reason.slice(0, 80)}`));
  const ledger = input.ledger;
  const proposedIds = new Map<string, string>();
  if (ledger) {
    ledger.noteStageContext('motion_director', {profile: Boolean(input.contentProfile), theme: Boolean(input.contentProfile)});
    for (const refusal of director.refusals) {
      const id = ledger.propose({type: 'generated_graphic', stage: 'motion_director', start: refusal.start ?? 0, end: refusal.end ?? refusal.start ?? 0, label: refusal.id});
      ledger.reject(id, 'motion_director', refusal.reason);
    }
    for (const graphic of director.graphics) {
      proposedIds.set(
        graphic.brief.id,
        ledger.propose({type: 'generated_graphic', stage: 'motion_director', start: graphic.start, end: graphic.end, label: graphic.brief.id, reason: graphic.reason}),
      );
    }
  }

  // With a Director dump dir, per-graphic sources and runtime stills land next to the dump.
  const dumpDir = process.env.DIRECTOR_DUMP_DIR?.trim();
  const artifactsDir = input.artifactsDir ?? (dumpDir ? path.join(dumpDir, 'motion-graphics') : undefined);
  // WP12A: the polish explain path draws its plates in a curated short-form look (renderer: looks.ts); other paths keep the theme as is.
  const baseTheme = input.themeOverride ?? input.contentProfile?.theme;
  const platesTheme = input.explainPlates ? withShortFormLook(baseTheme as Record<string, unknown> | undefined) : baseTheme;
  const mainWorker =
    toolkitGraphics.length > 0
      ? await buildGeneratedGraphics(toolkitGraphics, {captionBottomFrac: input.captionBottomFrac, artifactsDir, theme: platesTheme, preferLibrary: input.preferLibrary, claudeAllowed: input.claudeAllowed, ...(input.workerOptions ?? {})})
      : null;
  // WP9D: windows the library (and everything else) left without a leave-the-face cover may get a Claude-custom plate (bounded, grounded, after the library). Library-only: reported, not hidden.
  let worker = mainWorker;
  if (input.explainPlates) {
    // Gaps are recomputed from what was actually DELIVERED (library seeds and Director graphics that built), not from what was proposed.
    const delivered = new Set((mainWorker?.generatedGraphics ?? []).map(graphic => graphic.id));
    const plates = await runClaudeExplainPlates({
      director: {graphics: director.graphics.filter(graphic => delivered.has(graphic.brief.id))},
      edit: input.edit,
      words: input.words,
      outputDurationSec: input.outputDurationSec,
      captionBand: captionBandFraction(input.captionPosition, input.captionBottomFrac ?? 0.16),
      contentProfile: contentProfile ?? undefined,
      lookId: input.lookId,
      claudeAllowed: input.claudeAllowed,
      buildOptions: {captionBottomFrac: input.captionBottomFrac, artifactsDir, theme: platesTheme, ...(input.workerOptions ?? {})},
    });
    warnings.push(...plates.warnings);
    worker = mergeOutcomes(mainWorker, plates.outcome);
  }
  if (artifactsDir && worker) {
    await fs.mkdir(artifactsDir, {recursive: true});
    await Promise.all(worker.results.map(result => fs.writeFile(path.join(artifactsDir, `${result.id}.tsx`), result.source)));
  }
  warnings.push(...(worker?.failures ?? []).map(failure => `motion_dropped:${failure.id}`));
  warnings.push(...(worker?.failures ?? []).filter(failure => failure.kind === 'library_miss').map(failure => `motion_graphic:library_miss_no_claude:${failure.id}`));
  // WP8D: provenance per delivered graphic: motion_graphic:library:<composition> (no Claude call) or motion_graphic:claude.
  warnings.push(...(worker?.provenance ?? []).map(item => (item.source === 'library' ? `motion_graphic:library:${item.compositionId}` : 'motion_graphic:claude')));
  // WP10A: the open plate only replaces the hook once it was actually delivered.
  const suppressHookTitle = Boolean(openPlateId && (worker?.generatedGraphics ?? []).some(graphic => graphic.id === openPlateId));
  if (suppressHookTitle) warnings.push('polish_open:hook_replaced_by_plate');
  else if (openPlateId) warnings.push('polish_open:thumbnail_plate_not_delivered');
  // A Claude billing failure (credit balance too low) is a terminal blocker for a strict run, not a graphic that merely failed to compile.
  for (const failure of worker?.failures ?? []) {
    // The Anthropic SDK starts its error message with the HTTP status ("402 {...}"), so a 402 is caught even when its wording is unfamiliar.
    const status = /^(\d{3}) /.exec(failure.reason)?.[1];
    noteBillingFailure('anthropic', status ? Number(status) : undefined, failure.reason);
  }
  if (ledger) {
    ledger.noteStageContext('motion_worker', {profile: Boolean(input.contentProfile), theme: Boolean(input.contentProfile)});
    for (const failure of worker?.failures ?? []) {
      const id = proposedIds.get(failure.id);
      if (id) {
        ledger.drop(id, 'motion_worker', `worker_failed:${failure.reason.slice(0, 120)}`);
      }
    }
    for (const id of trackIds) {
      const ledgerId = proposedIds.get(id);
      if (ledgerId) {
        ledger.accept(ledgerId, 'motion_director', {reason: 'text_behind_subject'});
      }
    }
    for (const graphic of worker?.generatedGraphics ?? []) {
      const id = proposedIds.get(graphic.id);
      if (id) {
        ledger.accept(id, 'motion_worker', {to: {start: graphic.start, end: graphic.end}});
      }
    }
  }

  dumpDirectorTrace('05-motion-graphics', {
    director: {model: director.model, costUsd: director.costUsd, latencyMs: director.latencyMs, raw: director.raw, refusals: director.refusals, ...(input.videoPart ? {videoInput: {mimeType: input.videoPart.mimeType, bytes: input.videoPart.bytes ?? null}, promptTokens: director.promptTokens, candidateTokens: director.candidateTokens} : {})},
    briefs: director.graphics,
    textTreatments,
    behindSubjectTexts,
    generatedGraphics: worker?.generatedGraphics ?? [],
    failures: worker?.failures ?? [],
    claudeLedger: worker?.ledger ?? [],
    claudeCostUsd: worker?.claudeCostUsd ?? 0,
    previews: Object.fromEntries((worker?.results ?? []).map(result => [result.id, result.previewPath])),
  });

  return {
    generatedGraphics: worker?.generatedGraphics ?? [],
    director,
    worker,
    geminiCostUsd: director.costUsd,
    claudeCostUsd: worker?.claudeCostUsd ?? 0,
    warnings,
    behindSubjectTexts,
    textTreatments,
    ...(suppressHookTitle ? {suppressHookTitle} : {}),
    ...(directorFailure ? {directorFailure} : {}),
  };
}

