/**
 * Phase 5.23: the EDITING PIPELINE that owns a job. Two independent pipelines live in this engine:
 *
 *   kinetic_v2     the Kinetic typography pipeline (style `kinetic_typography`, request alias `kinetic_v2`). Inside it, POLISH_KINETIC_ENGINE chooses the engine version
 *                  (the V2 engine or the template Kinetic-Led path), exactly as before.
 *   subject_stage  the Subject Stage pipeline (style `subject_stage`): its own deterministic planner, whole-run person matte, renderer layers and text.
 *
 * Exactly one pipeline (or none) owns a job, resolved ONCE in `analyzeVideo` and enforced there:
 *   - a styled job: the pipeline is the style's (`EDIT_STYLES[style].pipeline`), passed down by the analysis runner. A feature flag can never add the other pipeline.
 *   - an unstyled job (no selection): the env flags decide as they always have, but at most ONE pipeline: when the env enables both, Kinetic V2 owns the job
 *     (the order the pipeline already ran them in) and Subject Stage is off for the run, even if the engine later produces nothing.
 *   - an unknown value fails fast with a clear error (never a silent fallback to some other pipeline).
 *
 * Pure: no env, no I/O.
 */
import type {EffectiveFlags} from './effectiveFlags.ts';

export const EDITING_PIPELINE_IDS = ['kinetic_v2', 'subject_stage'] as const;
export type EditingPipelineId = (typeof EDITING_PIPELINE_IDS)[number];
/** What the analysis runner passes for a styled job: the style's pipeline, or 'none' for a style without one (Clean Cut, Explainer, Basic Captions). */
export type EditingPipelineSelection = EditingPipelineId | 'none';

export type EditingPipeline = {
  /** the owning pipeline; null = neither runs */
  id: EditingPipelineId | null;
  /** `selected`: from the job's style (authoritative); `env`: an unstyled job, from the server flags (the pre-5.23 behaviour) */
  source: 'selected' | 'env';
};

export class EditingPipelineError extends Error {
  readonly code = 'invalid_editing_pipeline';
  readonly value: string;
  constructor(value: string) {
    super(`Unknown editing pipeline "${value}" (expected one of: ${EDITING_PIPELINE_IDS.join(', ')}, none)`);
    this.value = value;
  }
}

export const isEditingPipelineId = (value: unknown): value is EditingPipelineId => typeof value === 'string' && (EDITING_PIPELINE_IDS as readonly string[]).includes(value);

/**
 * Resolve the owner once. `selected` undefined = an unstyled job. Throws `EditingPipelineError` on any other value than a pipeline id or 'none'.
 * The env rule reproduces the pre-5.23 gates: the Kinetic V2 engine block needs polish + kineticEngine + kineticLed; the Subject Stage gate needs polish + subjectStage.
 */
export function resolveEditingPipeline(input: {selected?: unknown; polishPath: boolean; flags: Pick<EffectiveFlags, 'kineticEngine' | 'kineticLed' | 'subjectStage'>}): EditingPipeline {
  if (input.selected !== undefined) {
    if (input.selected === 'none') return {id: null, source: 'selected'};
    if (!isEditingPipelineId(input.selected)) throw new EditingPipelineError(String(input.selected).slice(0, 60));
    return {id: input.selected, source: 'selected'};
  }
  if (input.polishPath && input.flags.kineticEngine && input.flags.kineticLed) return {id: 'kinetic_v2', source: 'env'};
  if (input.polishPath && input.flags.subjectStage) return {id: 'subject_stage', source: 'env'};
  return {id: null, source: 'env'};
}

/**
 * The flag values the owner forces for the rest of the job, so the OTHER pipeline cannot start from a flag (the single enforcement point: both pipeline blocks in analyzeVideo read
 * these flags, and the Subject Stage gate also asks `pipelineOwns`):
 *   kinetic_v2     -> subjectStage off
 *   anything else  -> kineticEngine off (the V2 engine block needs it; it is read nowhere else in analyzeVideo)
 *   subject_stage  -> kineticEngine off; when SELECTED also kineticLed off (no V2 engine, no template Kinetic-Led). An env-owned (unstyled) Subject Stage keeps kineticLed as
 *                     it was: the template Kinetic-Led path then yields to an ACTIVE stage through kineticInputsUnderStage exactly as before 5.23 (that path is not the V2 engine).
 *   none           -> subjectStage off; Kinetic V2 needs kineticLed, which no pipeline-less style turns on (left as is so those styles stay byte-identical)
 * Returns only the fields to change (empty = nothing changes).
 */
export function pipelineFlagOverrides(pipeline: EditingPipeline, flags: Pick<EffectiveFlags, 'kineticEngine' | 'kineticLed' | 'subjectStage'>): Partial<Pick<EffectiveFlags, 'kineticEngine' | 'kineticLed' | 'subjectStage'>> {
  const out: Partial<Pick<EffectiveFlags, 'kineticEngine' | 'kineticLed' | 'subjectStage'>> = {};
  if (pipeline.id !== 'subject_stage' && flags.subjectStage) out.subjectStage = false;
  if (pipeline.id !== 'kinetic_v2' && flags.kineticEngine) out.kineticEngine = false;
  if (pipeline.id === 'subject_stage' && pipeline.source === 'selected' && flags.kineticLed) out.kineticLed = false;
  return out;
}

/** May this pipeline's stage run in the job? The single question both pipeline blocks in analyzeVideo ask. */
export const pipelineOwns = (pipeline: EditingPipeline, id: EditingPipelineId): boolean => pipeline.id === id;

/** The job diagnostic (a blueprint warning), so the path that really ran can be checked: `editing_pipeline:<id|none>:<source>`. Null for an unstyled job with no pipeline (warnings unchanged). */
export function editingPipelineWarning(pipeline: EditingPipeline): string | null {
  if (pipeline.id === null && pipeline.source === 'env') return null;
  return `editing_pipeline:${pipeline.id ?? 'none'}:${pipeline.source}`;
}
