/**
 * Strict AI-direction outcomes for the motion-graphics stage.
 *
 * The pipeline degrades on purpose: a graphic that cannot be produced is dropped and the run continues. For an experiment that measures the AI-directed
 * edit that is the wrong default, so a strict run (`strictAiDirection`) classifies every graphic the motion Director asked for:
 *
 *   success   the Director ran and every requested graphic reached the final blueprint, and the ledger agrees.
 *   degraded  only graphics the CALLER explicitly listed as optional (`strictOptionalGraphicIds`) are missing, and only for a placement reason (see EXCUSABLE).
 *   failed    anything else: the run throws `ai_direction_failed` with provider, stage, reason and graphic id for every omission. No blueprint is returned.
 *
 * Nothing in the Director's brief, the edit plan or the ledger says a graphic is optional (briefs have no such field), so absent an explicit caller list
 * EVERY requested graphic is required: the strict mode fails closed. This is a documented limitation, not an inference. Provider failures, code that fails
 * validation/compilation, and failed render checks are never excusable, even for an optional graphic: they show the AI path itself is broken.
 *
 * Non-strict runs never call any of this.
 */

import {EngineError} from '../lib/errors.ts';
import {judgeProvenance, type ProvenanceField} from '../stages/broll/directorProvenance.ts';
import type {EditLedger} from '../lib/editLedger.ts';
import type {MotionGraphicsStageResult} from '../stages/motionDirector/index.ts';

export type StrictFailureKind =
  | 'director_failed'
  /** The Director's request lost on placement or caps (overlap, caption band, maximum, too short). Excusable for an explicitly optional graphic. */
  | 'refused'
  /** The Director's request was malformed (bad JSON, bad anchor, invalid brief, duplicate id). Never excusable. */
  | 'director_invalid'
  | 'provider_error'
  | 'model_refused'
  | 'generated_code_invalid'
  | 'render_check_failed'
  /** WP8E: library-only mode (polish, no Claude bound): the library could not satisfy the brief and no Claude call is allowed. Never excusable. */
  | 'library_miss'
  | 'conflict_dropped'
  | 'ledger_mismatch';

/** Placement/plan reasons an explicitly optional graphic may be missing for. Everything else is a failure whatever the caller listed. */
export const EXCUSABLE: ReadonlySet<StrictFailureKind> = new Set(['refused', 'conflict_dropped']);

export type StrictOmission = {
  /** The graphic's brief id; `*` when the whole motion Director failed before any graphic existed. */
  graphicId: string;
  stage: 'motion_director' | 'motion_worker' | 'conflict_validator' | 'ledger';
  provider: 'gemini' | 'anthropic' | 'engine' | 'unknown';
  kind: StrictFailureKind;
  reason: string;
  optional: boolean;
};

export type StrictAssessment = {
  status: 'success' | 'degraded' | 'failed';
  requested: string[];
  delivered: string[];
  /** Missing graphics a caller explicitly allowed to be missing. */
  degraded: StrictOmission[];
  failures: StrictOmission[];
};

/** Refusal reasons produced by `assembleDirectedGraphics` for placement and caps; every other reason means the Director's request itself was malformed. */
const PLACEMENT_REFUSAL = /^(overlaps |over the maximum|too short|.* box overlaps the caption band)/;

const clip = (text: string) => text.replace(/\s+/g, ' ').slice(0, 240);

/**
 * Assess the stage result, and (when given) the final blueprint's graphics and the ledger. Call it once after the stage (`final` absent) and once after
 * the conflict validator (`final` present). Pure: no I/O.
 */
export function assessStrictMotion(
  stage: Pick<MotionGraphicsStageResult, 'director' | 'worker' | 'directorFailure' | 'behindSubjectTexts' | 'textTreatments'>,
  options: {
    optionalIds?: readonly string[];
    final?: {generatedGraphicIds: ReadonlySet<string>; behindSubjectTexts: ReadonlyArray<{text: string}>};
    ledger?: EditLedger;
  } = {},
): StrictAssessment {
  const optionalIds = new Set(options.optionalIds ?? []);
  const omissions: StrictOmission[] = [];
  const add = (omission: Omit<StrictOmission, 'optional'>) => omissions.push({...omission, optional: optionalIds.has(omission.graphicId) && EXCUSABLE.has(omission.kind)});

  // WP8J: a failed Director stays a failure even when library seeds filled in for it (`directorFailure` is set only on failure).
  if (!stage.director || stage.directorFailure) {
    add({graphicId: '*', stage: 'motion_director', provider: 'gemini', kind: 'director_failed', reason: clip(stage.directorFailure?.reason ?? 'motion Director did not return a plan')});
    return {status: 'failed', requested: [], delivered: [], degraded: [], failures: omissions};
  }

  const requested = [...stage.director.graphics.map(graphic => graphic.brief.id), ...stage.director.refusals.map(refusal => refusal.id)];
  for (const refusal of stage.director.refusals) {
    add({graphicId: refusal.id, stage: 'motion_director', provider: 'engine', kind: PLACEMENT_REFUSAL.test(refusal.reason) ? 'refused' : 'director_invalid', reason: clip(refusal.reason)});
  }
  const failedById = new Map((stage.worker?.failures ?? []).map(failure => [failure.id, failure]));
  const trackTexts = new Set(stage.textTreatments.filter(item => item.delivered === 'behind_subject_track').map(item => item.id));
  const delivered: string[] = [];
  for (const graphic of stage.director.graphics) {
    const id = graphic.brief.id;
    const failure = failedById.get(id);
    if (failure) {
      const provider = failure.provider === 'anthropic' ? 'anthropic' : 'unknown';
      add({graphicId: id, stage: 'motion_worker', provider, kind: failure.kind ?? 'provider_error', reason: clip(failure.reason)});
      continue;
    }
    if (trackTexts.has(id)) {
      // Drawn by the behind-subject track, not by Claude. It must survive the conflict validator too (checked below once `final` is known).
      if (options.final && !options.final.behindSubjectTexts.some(item => item.text === graphic.brief.textTreatment?.text)) {
        add({graphicId: id, stage: 'conflict_validator', provider: 'engine', kind: 'conflict_dropped', reason: 'behind-subject text did not survive the conflict validator'});
        continue;
      }
      delivered.push(id);
      continue;
    }
    const built = stage.worker?.generatedGraphics.some(item => item.id === id);
    if (!built) {
      add({graphicId: id, stage: 'motion_worker', provider: 'unknown', kind: 'ledger_mismatch', reason: 'the Director requested this graphic but the worker reported neither a result nor a failure'});
      continue;
    }
    if (options.final && !options.final.generatedGraphicIds.has(id)) {
      const entry = options.ledger?.entries().find(item => item.type === 'generated_graphic' && item.label === id);
      const drop = [...(entry?.events ?? [])].reverse().find(event => event.decision === 'dropped');
      add({graphicId: id, stage: 'conflict_validator', provider: 'engine', kind: 'conflict_dropped', reason: clip(drop?.reason ?? 'dropped by the conflict validator')});
      continue;
    }
    if (options.final && options.ledger) {
      // The ledger must say the same thing as the blueprint: a delivered graphic has a surviving ledger entry.
      const entry = options.ledger.entries().find(item => item.type === 'generated_graphic' && item.label === id);
      if (!entry || entry.final === null) {
        add({graphicId: id, stage: 'ledger', provider: 'engine', kind: 'ledger_mismatch', reason: entry ? 'the blueprint carries the graphic but the ledger records it as not surviving' : 'the blueprint carries the graphic but the ledger has no entry for it'});
        continue;
      }
    }
    delivered.push(id);
  }

  const failures = omissions.filter(item => !item.optional);
  const degraded = omissions.filter(item => item.optional);
  return {status: failures.length > 0 ? 'failed' : degraded.length > 0 ? 'degraded' : 'success', requested, delivered, degraded, failures};
}

/**
 * Throws `ai_direction_failed` for a failed assessment; returns the assessment otherwise (the caller records a degraded one in the blueprint warnings).
 * The message never reads like a completed edit and names the first failure's provider, stage, reason and graphic; `details` carries them all.
 */
export function enforceStrictMotion(strict: boolean | undefined, assessment: StrictAssessment, atStage: string): StrictAssessment {
  if (!strict || assessment.status !== 'failed') {
    return assessment;
  }
  const first = assessment.failures[0]!;
  const more = assessment.failures.length > 1 ? ` (+${assessment.failures.length - 1} more)` : '';
  throw new EngineError(
    'ai_direction_failed',
    `AI-directed run FAILED at "${atStage}": ${first.kind} for graphic "${first.graphicId}" (${first.provider}, ${first.stage}): ${first.reason}${more}. No blueprint was produced and no deterministic substitute was used.`,
    {outcome: 'failed', stage: atStage, provider: first.provider, failures: assessment.failures, requested: assessment.requested, delivered: assessment.delivered},
  );
}

/** Blueprint warning lines for a degraded (still successful) strict run. */
export function strictDegradedWarnings(assessment: StrictAssessment): string[] {
  return assessment.degraded.map(item => `strict_degraded:${item.graphicId}:${item.kind}:${item.reason.slice(0, 80)}`);
}

/**
 * Phase 36C: strict-run failures that are CERTAIN once the Director has answered, raised before the paid motion stage (motion Director + Claude graphics).
 * The experiment verdict fails each of these anyway (`deterministic_substitution`, `opening_missing`), so stopping here changes no outcome, only the spend.
 * A no-op outside a strict run.
 */
export function assertStrictDirectorDeliverables(
  strict: boolean | undefined,
  input: {openingRequested: boolean; openingPlanPresent: boolean; fallbackSubstitutions?: readonly string[]},
): void {
  if (!strict) {
    return;
  }
  if (input.fallbackSubstitutions && input.fallbackSubstitutions.length > 0) {
    throw new EngineError(
      'ai_direction_failed',
      `AI-directed run FAILED before the motion stage: deterministic_substitution (parts supplied by the deterministic fallback, not the Director: ${input.fallbackSubstitutions.join(', ')}). No paid motion or graphic call was made.`,
      {outcome: 'failed', stage: 'director_deliverables', reason: 'deterministic_substitution', fallbackSubstitutions: [...input.fallbackSubstitutions]},
    );
  }
  if (input.openingRequested && !input.openingPlanPresent) {
    throw new EngineError(
      'ai_direction_failed',
      'AI-directed run FAILED before the motion stage: opening_missing (the Director returned no opening plan). No paid motion or graphic call was made.',
      {outcome: 'failed', stage: 'director_deliverables', reason: 'opening_missing'},
    );
  }
}

/** Same idea for an opening plan that the (local, deterministic) resolver rejects: known before any Claude call. A no-op outside a strict run. */
export function assertStrictOpeningAccepted(strict: boolean | undefined, report: {accepted: boolean; rejection?: string}): void {
  if (strict && !report.accepted) {
    throw new EngineError(
      'ai_direction_failed',
      `AI-directed run FAILED before the motion stage: opening_rejected (${report.rejection ?? 'unknown'}). No paid motion or graphic call was made.`,
      {outcome: 'failed', stage: 'opening_resolution', reason: 'opening_rejected', rejection: report.rejection ?? null},
    );
  }
}

/**
 * Phase 36I: provenance-based strict check (opt-in via `enabled`; a no-op otherwise). Unlike `assertStrictDirectorDeliverables`, which sees only what survives the
 * planner's merge (zooms and moments), this reads provenance captured from the raw Director answer, so fallback-made motion graphics or semantic emphasis cannot pass.
 * Missing provenance while enabled fails closed.
 */
export function assertStrictProvenance(enabled: boolean, provenance: unknown, input: {openingRequested: boolean}): void {
  if (!enabled) {
    return;
  }
  const required: ProvenanceField[] = input.openingRequested ? ['openingPlan'] : [];
  const violations = judgeProvenance(provenance, {requiredFromDirector: required});
  if (violations.length > 0) {
    throw new EngineError(
      'ai_direction_failed',
      `AI-directed run FAILED before the motion stage: fallback_provenance (${violations.map(item => `${item.field}: ${item.reason}`).join('; ')}). No paid motion or graphic call was made.`,
      {outcome: 'failed', stage: 'director_provenance', reason: 'fallback_provenance', fields: violations.map(item => ({field: item.field, origin: item.origin}))},
    );
  }
}
