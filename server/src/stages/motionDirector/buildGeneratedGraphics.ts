/**
 * Director briefs → Claude worker → blueprint `generatedGraphics[]`.
 *
 * Each directed brief goes through the motion worker (generate → validate →
 * one-frame render → bounded repair → R2). Timing comes from the Director; a
 * graphic that cannot be produced is dropped with a warning, never re-placed.
 * Every Claude call lands in the cost ledger.
 */

import {stageLogger} from '../../lib/logger.ts';
import {
  cacheStatus,
  generateMotionGraphic,
  MotionWorkerError,
  publishGraphicSource,
  toGeneratedGraphic,
  type AttemptRecord,
  type MotionGraphicResult,
  type MotionWorkerOptions,
} from '../../motionWorker/worker.ts';
import type {GeneratedGraphic, TimelineBlueprint} from '../../types/blueprint.ts';
import type {DirectedGraphic, Interval} from './motionDirector.ts';
import {isStepperContent, libraryGraphicSource, resolveLibraryGraphic} from './libraryRegistry.ts';

const log = stageLogger('motion-graphics');

export type ClaudeCallRecord = {
  graphicId: string;
  attempt: number;
  model: string;
  /** Uncached input only. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cache: 'read' | 'write' | 'none';
  costUsd: number;
  ok: boolean;
  /** Validation failures that triggered the next repair (empty when ok). */
  failures: string[];
};

export type GeneratedGraphicsOutcome = {
  generatedGraphics: GeneratedGraphic[];
  results: MotionGraphicResult[];
  /** `kind`/`provider` are additive classification (see classifyWorkerFailure); `reason` is unchanged. */
  failures: Array<{id: string; reason: string; kind?: WorkerFailureKind; provider?: 'anthropic' | 'unknown'}>;
  ledger: ClaudeCallRecord[];
  claudeCostUsd: number;
  /** WP8D: where each delivered graphic came from. `library` = a `@finalpost/motion` composition (no Claude call); `claude` = the generator. */
  provenance: Array<{id: string; source: 'library' | 'claude'; compositionId?: string}>;
};

export type WorkerFailureKind = 'provider_error' | 'model_refused' | 'generated_code_invalid' | 'render_check_failed' | 'library_miss';

/** WP8E: the library could not satisfy a brief and the Claude generator is not allowed (library-only mode). Not a provider failure: no call was made. */
export class LibraryMissError extends Error {
  readonly briefId: string;
  constructor(briefId: string) {
    super('library_miss_no_claude');
    this.briefId = briefId;
  }
}

/**
 * Why a graphic failed, from the worker's own error: a thrown provider error (the Claude call itself), a refusal, code that failed the safety/type/compile
 * checks (or had no code block), or code that compiled but failed the one-frame real render.
 */
export function classifyWorkerFailure(error: unknown): {kind: WorkerFailureKind; provider: 'anthropic' | 'unknown'} {
  if (error instanceof LibraryMissError) {
    return {kind: 'library_miss', provider: 'unknown'};
  }
  if (error instanceof MotionWorkerError) {
    const last = error.attempts.at(-1);
    if (!last) {
      return {kind: 'model_refused', provider: 'anthropic'};
    }
    const compiledOk = last.report.safety.length === 0 && last.report.typecheck.length === 0 && last.report.compile.length === 0 && !last.report.extraction;
    return {kind: compiledOk && (last.report.runtime?.length ?? 0) > 0 ? 'render_check_failed' : 'generated_code_invalid', provider: 'anthropic'};
  }
  // The Anthropic SDK's errors carry a numeric `status` (HTTP errors) or an `API…` class name (connection errors). Matched structurally so this file stays free of SDK imports.
  const shaped = error as {status?: unknown; constructor?: {name?: string}} | null;
  const fromClaude = typeof shaped?.status === 'number' || /^API/.test(shaped?.constructor?.name ?? '');
  return {kind: 'provider_error', provider: fromClaude ? 'anthropic' : 'unknown'};
}

export const ledgerFor = (graphicId: string, attempts: AttemptRecord[]): ClaudeCallRecord[] =>
  attempts.map(attempt => ({
    graphicId,
    attempt: attempt.attempt,
    model: attempt.model,
    inputTokens: attempt.usage.inputTokens,
    outputTokens: attempt.usage.outputTokens,
    cacheCreationInputTokens: attempt.usage.cacheCreationInputTokens,
    cacheReadInputTokens: attempt.usage.cacheReadInputTokens,
    cache: cacheStatus(attempt.usage),
    costUsd: attempt.costUsd,
    ok: attempt.ok,
    failures: [
      ...(attempt.report.extraction ? [attempt.report.extraction] : []),
      ...attempt.report.safety,
      ...attempt.report.typecheck,
      ...attempt.report.compile,
      ...(attempt.report.runtime ?? []),
    ].map(line => line.split('\n')[0]!.slice(0, 200)),
  }));

export async function buildGeneratedGraphics(
  directed: DirectedGraphic[],
  options: MotionWorkerOptions & {concurrency?: number; theme?: Record<string, unknown>; preferLibrary?: boolean; claudeAllowed?: boolean} = {},
): Promise<GeneratedGraphicsOutcome> {
  const outcomes: Array<{item: DirectedGraphic; result?: MotionGraphicResult; error?: unknown; library?: string}> = directed.map(item => ({item}));
  const run = async (outcome: (typeof outcomes)[number]) => {
    // WP8D (opt-in, polish): a brief that fits a library composition is delivered from the library, validated and uploaded by the same worker checks, with NO Claude call. A miss, or a library
    // module that fails validation, falls through to the Claude path below (which the caller has already gated by MOTION_GRAPHICS_ENABLED and the Claude bound).
    if (options.preferLibrary) {
      const brief = outcome.item.brief;
      // WP29: a polish brief that is a numbered stepper is refused outright (it would otherwise fall through to a Claude-authored stepper): web-UI look, not video design.
      if (isStepperContent(brief.content)) {
        outcome.error = new Error(`polish:process_steps_refused:${brief.id}`);
        return;
      }
      const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: brief.content, textTreatment: brief.textTreatment, polish: true});
      if (hit) {
        try {
          outcome.result = await publishGraphicSource(brief, libraryGraphicSource(hit), {
            upload: options.upload,
            runtimeCheck: options.runtimeCheck,
            captionBottomFrac: options.captionBottomFrac,
            artifactsDir: options.artifactsDir,
          });
          outcome.library = hit.compositionId;
          return;
        } catch (error) {
          log.warn({id: brief.id, composition: hit.compositionId, error}, 'library graphic failed validation; falling back to the generator');
        }
      }
    }
    // WP8E: library-only mode: the generator is never reached, so no Claude client is built and no call is made.
    if (options.claudeAllowed === false) {
      outcome.error = new LibraryMissError(outcome.item.brief.id);
      return;
    }
    try {
      outcome.result = await generateMotionGraphic(outcome.item.brief, options);
    } catch (error) {
      outcome.error = error;
    }
  };
  // The first graphic runs alone so its call writes the prompt cache; the rest
  // then start in parallel and read it instead of each writing their own copy.
  if (outcomes.length > 0) {
    await run(outcomes[0]!);
  }
  let next = 1;
  const workers = Array.from({length: Math.min(options.concurrency ?? 3, outcomes.length - 1)}, async () => {
    while (next < outcomes.length) {
      await run(outcomes[next++]!);
    }
  });
  await Promise.all(workers);

  const generatedGraphics: GeneratedGraphic[] = [];
  const results: MotionGraphicResult[] = [];
  const failures: GeneratedGraphicsOutcome['failures'] = [];
  const ledger: ClaudeCallRecord[] = [];
  const provenance: GeneratedGraphicsOutcome['provenance'] = [];
  for (const {item, result, error, library} of outcomes) {
    if (result) {
      results.push(result);
      provenance.push(library ? {id: result.id, source: 'library', compositionId: library} : {id: result.id, source: 'claude'});
      const graphic = toGeneratedGraphic(result, {start: item.start, end: item.end});
      // props.theme overrides the renderer's default theme for this graphic only.
      generatedGraphics.push(options.theme ? {...graphic, props: {...graphic.props, theme: options.theme}} : graphic);
      ledger.push(...ledgerFor(result.id, result.attempts));
    } else {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({id: item.brief.id, reason, ...classifyWorkerFailure(error)});
      if (error instanceof MotionWorkerError) {
        ledger.push(...ledgerFor(item.brief.id, error.attempts));
      }
      log.warn({id: item.brief.id, reason}, 'motion graphic dropped');
    }
  }
  const claudeCostUsd = Number(ledger.reduce((sum, call) => sum + call.costUsd, 0).toFixed(6));
  return {generatedGraphics: generatedGraphics.sort((a, b) => a.start - b.start), results, failures, ledger, claudeCostUsd, provenance};
}

/**
 * Intervals the existing edit already owns. Generated graphics never share
 * them: B-roll, base-layout changes, the hook title and existing text
 * graphics take priority.
 */
export function occupiedByExistingEdits(
  blueprint: Pick<
    TimelineBlueprint,
    'brollClips' | 'visualOverlays' | 'motionGraphics' | 'mediaContainers' | 'hookTitle' | 'hookStartSec' | 'hookDurationSec'
  > &
    Partial<Pick<TimelineBlueprint, 'insetReveals' | 'depthOverlays' | 'semanticEmphasis' | 'frameInsets'>>,
): Interval[] {
  const intervals: Interval[] = [];
  const add = (items: Array<{start: number; end: number}> | undefined, what: (item: never) => string) => {
    for (const item of items ?? []) {
      if (item.end > item.start) {
        intervals.push({start: item.start, end: item.end, what: what(item as never)});
      }
    }
  };
  add(blueprint.brollClips, () => 'B-roll cutaway');
  add(blueprint.visualOverlays, (overlay: {layout: string}) => `B-roll/overlay (${overlay.layout})`);
  add(blueprint.insetReveals, () => 'inset reveal');
  add(blueprint.depthOverlays, () => 'depth overlay');
  add(blueprint.mediaContainers, () => 'media container');
  add(blueprint.motionGraphics, () => 'kinetic text graphic');
  add(blueprint.semanticEmphasis, () => 'emphasis text');
  add(blueprint.frameInsets, () => 'frame inset');
  if (blueprint.hookTitle?.trim()) {
    const start = blueprint.hookStartSec ?? 0;
    intervals.push({start, end: start + Math.max(1.2, blueprint.hookDurationSec || 3), what: 'hook title'});
  }
  return intervals.sort((a, b) => a.start - b.start);
}
