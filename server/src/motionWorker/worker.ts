/**
 * Claude motion-graphics worker.
 *
 *   MotionGraphicBrief → Claude writes TSX → contract check + typecheck +
 *   compile → one-frame render (real Remotion, production loader) →
 *   (bounded repair) → upload the compiled module to R2 →
 *   {id, module: {url, sha256}, placement, props}
 *
 * The worker never decides whether a graphic is needed, when it plays, where
 * it goes or what B-roll is used: those come from the Director. The caller
 * attaches start/end with toGeneratedGraphic() to get a blueprint
 * `generatedGraphics[]` entry for the existing GeneratedGraphicTrack.
 */

import {checkMotionAesthetic} from '../lib/motionAestheticGate.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import {logger} from '../lib/logger.ts';
import {uploadPublicFile} from '../storage/r2.ts';
import type {GeneratedGraphic, GeneratedGraphicPlacement} from '../types/blueprint.ts';
import {assetProps, DEFAULT_CANVAS, parseBrief, placementFor, type Canvas, type MotionGraphicBrief} from './brief.ts';
import {checkSource, compileGraphicSource, CompileError, MOTION_MODULE_PREFIX, type CompiledModule} from './contract.ts';
import {buildGenerationPrompt, buildRepairPrompt, buildSystemPrompt, type ValidationReport} from './prompt.ts';
import {remotionRuntimeCheck, type RuntimeChecker} from './runtimeCheck.ts';
import {typecheckGraphic} from './typecheck.ts';

/** Repairs after the first generation; at most 1 + MAX_REPAIR_ATTEMPTS model calls per graphic. */
export const MAX_REPAIR_ATTEMPTS = 2;

export const DEFAULT_MOTION_WORKER_MODEL = 'claude-sonnet-5-5';

/**
 * USD per million tokens (Anthropic list prices). Cache writes cost 1.25× input
 * for the 5-minute TTL and 2× for 1 hour; cache reads have a per-model rate.
 */
const PRICES: Record<string, {input: number; output: number; cacheRead: number}> = {
  'claude-sonnet-5-5': {input: 2, output: 10, cacheRead: 0.2},
  'claude-opus-5-5': {input: 4, output: 20, cacheRead: 0.2},
  'claude-haiku-4-5': {input: 1, output: 5, cacheRead: 0.1},
};

/** Anthropic usage, normalized. `inputTokens` is the uncached remainder only. */
export type GenerationUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Breakdown of cacheCreationInputTokens by TTL (absent = treat all as 5-minute). */
  cacheCreation5mInputTokens?: number;
  cacheCreation1hInputTokens?: number;
};

/** Whether this call wrote the cached prefix, read it, or neither. */
export function cacheStatus(usage: GenerationUsage): 'read' | 'write' | 'none' {
  return usage.cacheReadInputTokens > 0 ? 'read' : usage.cacheCreationInputTokens > 0 ? 'write' : 'none';
}

export type GenerateRequest = {system: string; user: string};
export type GenerateResponse = {text: string; stopReason: string | null; model: string; usage: GenerationUsage};
/** One model call. Injectable so tests and other transports can stand in for the API. */
export type MotionGraphicGenerator = (request: GenerateRequest) => Promise<GenerateResponse>;

/** Uploads a compiled module and returns its public URL. */
export type ModuleUploader = (code: string, sha256: string) => Promise<string>;

export type AttemptRecord = {
  attempt: number;
  kind: 'generate' | 'repair';
  ok: boolean;
  report: ValidationReport;
  stopReason: string | null;
  model: string;
  usage: GenerationUsage;
  costUsd: number;
  ms: number;
  /** One-frame render of this attempt, when it got that far. */
  runtime?: {ok: boolean; frame: number; ms: number; stillPath: string | null};
};

/** Estimated API cost of one call. */
export function estimateClaudeCostUsd(model: string, usage: GenerationUsage): number {
  const key = Object.keys(PRICES).find(name => model.startsWith(name));
  if (!key) {
    throw new Error(`no price table for model "${model}"`);
  }
  const price = PRICES[key]!;
  const write1h = usage.cacheCreation1hInputTokens ?? 0;
  const write5m = usage.cacheCreation5mInputTokens ?? usage.cacheCreationInputTokens - write1h;
  const usd =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadInputTokens * price.cacheRead +
    write5m * price.input * 1.25 +
    write1h * price.input * 2;
  return Number((usd / 1e6).toFixed(6));
}

export type MotionGraphicResult = {
  id: string;
  module: {url: string; sha256: string};
  placement: GeneratedGraphicPlacement;
  /** Graphic props for the blueprint entry (the editor adds width/height/fps/theme/safeArea). */
  props: {content: Record<string, unknown>; assets?: Record<string, {src: string}>};
  brief: {purpose: string; visualIntent: string};
  source: string;
  bytes: number;
  gzipBytes: number;
  model: string | null;
  attempts: AttemptRecord[];
  usage: GenerationUsage;
  costUsd: number;
  /** Still from the passing one-frame render. */
  previewPath: string | null;
  warnings: string[];
};

export type MotionWorkerOptions = {
  generator?: MotionGraphicGenerator;
  upload?: ModuleUploader;
  canvas?: Canvas;
  maxRepairAttempts?: number;
  /** One-frame render before publishing (default: real Remotion). `false` skips it (unit tests only). */
  runtimeCheck?: RuntimeChecker | false;
  /** Where the video's captions sit, so the runtime render docks them like the burn will. */
  captionBottomFrac?: number;
  /** Directory for per-attempt stills (default: OS temp). */
  artifactsDir?: string;
};

export class MotionWorkerError extends Error {
  readonly briefId: string;
  readonly attempts: AttemptRecord[];
  readonly lastSource: string | null;
  constructor(message: string, briefId: string, attempts: AttemptRecord[], lastSource: string | null) {
    super(message);
    this.briefId = briefId;
    this.attempts = attempts;
    this.lastSource = lastSource;
  }
}

// ---------------------------------------------------------------------------
// Claude call

export type AnthropicGeneratorOptions = {
  client?: Pick<Anthropic, 'messages'>;
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Native prompt caching of the system prompt (default: MOTION_WORKER_PROMPT_CACHE, on). */
  promptCache?: boolean;
};

export function anthropicGenerator(options: AnthropicGeneratorOptions = {}): MotionGraphicGenerator {
  const client = options.client ?? new Anthropic();
  const model = options.model || process.env.MOTION_WORKER_MODEL || DEFAULT_MOTION_WORKER_MODEL;
  estimateClaudeCostUsd(model, {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}); // fail fast on an unpriced model
  const effort = options.effort || (process.env.MOTION_WORKER_EFFORT as typeof options.effort) || undefined;
  const promptCache = options.promptCache ?? !/^(0|false|off|no)$/i.test(process.env.MOTION_WORKER_PROMPT_CACHE ?? '');
  return async ({system, user}) => {
    const message = await client.messages
      .stream({
        model,
        max_tokens: options.maxTokens ?? 32_000,
        // The system prompt (role, rules, toolkit README, examples) is byte-identical for every
        // graphic and repair; one breakpoint at its end caches it (5-minute TTL). The user turn
        // (brief, content, previous file, errors) varies and is never cached.
        system: promptCache ? [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}] : system,
        messages: [{role: 'user', content: user}],
        ...(effort ? {output_config: {effort}} : {}),
      })
      .finalMessage();
    // Never let a silent model substitution through: costs and comparisons depend on it.
    if (!message.model.startsWith(model)) {
      throw new Error(`requested model ${model} but the API answered with ${message.model}`);
    }
    const text = message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n');
    const creation = message.usage.cache_creation;
    return {
      text,
      stopReason: message.stop_reason,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
        ...(creation
          ? {cacheCreation5mInputTokens: creation.ephemeral_5m_input_tokens, cacheCreation1hInputTokens: creation.ephemeral_1h_input_tokens}
          : {}),
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Validation

/** The TSX file from a reply: the last ```tsx/ts/jsx block, else a bare file. */
export function extractSource(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:tsx|typescript|ts|jsx|javascript|js)?[^\S\n]*\n([\s\S]*?)```/g)].map(match => match[1]!);
  const source = blocks.length > 0 ? blocks[blocks.length - 1]! : /^\s*(import|export)\b/.test(text) ? text : null;
  return source && source.trim() ? `${source.trim()}\n` : null;
}

/** Worker-level rule on top of the shared contract: graphics are built from the toolkit. */
function workerRules(source: string): string[] {
  return /from\s+['"]@finalpost\/motion['"]/.test(source)
    ? []
    : ['must import from "@finalpost/motion" (build the graphic from the toolkit)'];
}

type RuntimeContext = {
  checker: RuntimeChecker;
  brief: MotionGraphicBrief;
  captionBottomFrac?: number;
  stillPath?: string;
};

/**
 * Contract check + typecheck, then compile, then (with `runtime`) a one-frame
 * render through the production loader. Later stages run only when the earlier
 * ones pass, so every reported error is real.
 */
export async function validateGraphicSource(
  source: string,
  runtime?: RuntimeContext,
): Promise<{report: ValidationReport; compiled: CompiledModule | null; runtime?: AttemptRecord['runtime']}> {
  const report: ValidationReport = {
    safety: [...checkSource(source), ...workerRules(source), ...checkMotionAesthetic(source).reasons],
    typecheck: typecheckGraphic(source),
    compile: [],
    runtime: [],
  };
  if (report.safety.length > 0 || report.typecheck.length > 0) {
    return {report, compiled: null};
  }
  let compiled: CompiledModule;
  try {
    compiled = await compileGraphicSource(source);
  } catch (error) {
    report.compile = error instanceof CompileError ? error.messages : [String(error)];
    return {report, compiled: null};
  }
  if (!runtime) {
    return {report, compiled};
  }
  const {brief} = runtime;
  const assets = assetProps(brief);
  const result = await runtime.checker({
    id: brief.id,
    code: compiled.code,
    sha256: compiled.sha256,
    placement: placementFor(brief),
    props: Object.keys(assets).length > 0 ? {content: brief.content, assets} : {content: brief.content},
    durationSeconds: brief.durationSeconds,
    captionBottomFrac: runtime.captionBottomFrac,
    stillPath: runtime.stillPath,
  });
  report.runtime = result.ok ? [] : result.errors.map(error => `frame ${result.frame}: ${error}`);
  return {
    report,
    compiled: result.ok ? compiled : null,
    runtime: {ok: result.ok, frame: result.frame, ms: result.ms, stillPath: result.stillPath},
  };
}

const isClean = (report: ValidationReport) =>
  !report.extraction &&
  report.safety.length + report.typecheck.length + report.compile.length + (report.runtime?.length ?? 0) === 0;

// ---------------------------------------------------------------------------
// Upload

export const uploadModuleToR2: ModuleUploader = async (code, sha256) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mg-module-'));
  const file = path.join(dir, `${sha256}.js`);
  try {
    await fs.writeFile(file, code);
    const {publicUrl} = await uploadPublicFile(file, `${MOTION_MODULE_PREFIX}${sha256}.js`, 'text/javascript; charset=utf-8');
    return publicUrl;
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
};

// ---------------------------------------------------------------------------
// Worker

const zeroUsage = (): GenerationUsage => ({inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0});

function addUsage(total: GenerationUsage, usage: GenerationUsage): GenerationUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + usage.cacheReadInputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens + usage.cacheCreationInputTokens,
    cacheCreation5mInputTokens: (total.cacheCreation5mInputTokens ?? 0) + (usage.cacheCreation5mInputTokens ?? 0),
    cacheCreation1hInputTokens: (total.cacheCreation1hInputTokens ?? 0) + (usage.cacheCreation1hInputTokens ?? 0),
  };
}

function briefWarnings(brief: MotionGraphicBrief): string[] {
  return brief.assets.some(asset => asset.type === 'video')
    ? ['video assets are not supported in generated graphics and were not passed to the component']
    : [];
}

async function publish(
  brief: MotionGraphicBrief,
  source: string,
  compiled: CompiledModule,
  upload: ModuleUploader,
  extra: Pick<MotionGraphicResult, 'model' | 'attempts' | 'usage' | 'costUsd' | 'previewPath'>,
): Promise<MotionGraphicResult> {
  const url = await upload(compiled.code, compiled.sha256);
  const assets = assetProps(brief);
  return {
    id: brief.id,
    module: {url, sha256: compiled.sha256},
    placement: placementFor(brief),
    props: Object.keys(assets).length > 0 ? {content: brief.content, assets} : {content: brief.content},
    brief: {purpose: brief.goal, visualIntent: brief.visualDescription},
    source,
    bytes: compiled.bytes,
    gzipBytes: compiled.gzipBytes,
    warnings: briefWarnings(brief),
    ...extra,
  };
}

/**
 * Brief → Claude-generated, validated, uploaded graphic. Throws MotionWorkerError
 * (with every attempt's report) when no valid file is produced within
 * 1 + maxRepairAttempts calls, or immediately on a refusal.
 */
export async function generateMotionGraphic(
  briefInput: unknown,
  options: MotionWorkerOptions = {},
): Promise<MotionGraphicResult> {
  const brief = parseBrief(briefInput);
  const canvas = options.canvas ?? DEFAULT_CANVAS;
  const generator = options.generator ?? anthropicGenerator();
  const upload = options.upload ?? uploadModuleToR2;
  const maxAttempts = 1 + (options.maxRepairAttempts ?? MAX_REPAIR_ATTEMPTS);
  const log = logger.child({stage: 'motion-worker', graphicId: brief.id});
  const system = buildSystemPrompt();
  const checker = options.runtimeCheck === false ? null : options.runtimeCheck ?? remotionRuntimeCheck;
  const stillFor = (attempt: number) =>
    path.join(options.artifactsDir ?? os.tmpdir(), `${brief.id}.attempt${attempt}.png`);

  const attempts: AttemptRecord[] = [];
  let usage = zeroUsage();
  let model: string | null = null;
  let source: string | null = null;
  let report: ValidationReport | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    const user =
      attempt === 1 || !report
        ? buildGenerationPrompt(brief, canvas)
        : buildRepairPrompt(brief, canvas, source, report, attempt - 1, maxAttempts);
    const response = await generator({system, user});
    usage = addUsage(usage, response.usage);
    model = response.model;
    if (response.stopReason === 'refusal') {
      throw new MotionWorkerError('model refused the brief', brief.id, attempts, source);
    }

    const extracted = extractSource(response.text);
    let compiled: CompiledModule | null = null;
    let runtime: AttemptRecord['runtime'];
    if (extracted === null) {
      report = {
        safety: [],
        typecheck: [],
        compile: [],
        runtime: [],
        extraction: response.stopReason === 'max_tokens' ? 'reply was cut off before the code block finished' : 'no ```tsx code block in the reply',
      };
    } else {
      source = extracted;
      ({report, compiled, runtime} = await validateGraphicSource(
        source,
        checker ? {checker, brief, captionBottomFrac: options.captionBottomFrac, stillPath: stillFor(attempt)} : undefined,
      ));
    }

    const ok = compiled !== null && isClean(report);
    const costUsd = estimateClaudeCostUsd(response.model, response.usage);
    const record: AttemptRecord = {
      attempt,
      kind: attempt === 1 ? 'generate' : 'repair',
      ok,
      report,
      stopReason: response.stopReason,
      model: response.model,
      usage: response.usage,
      costUsd,
      ms: Date.now() - started,
      ...(runtime ? {runtime} : {}),
    };
    attempts.push(record);
    // One line per Claude call: the cost ledger.
    log.info(
      {
        attempt,
        ok,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
        cacheReadInputTokens: response.usage.cacheReadInputTokens,
        cache: cacheStatus(response.usage),
        costUsd,
        ms: record.ms,
        safety: report.safety.length,
        typecheck: report.typecheck.length,
        compile: report.compile.length,
        runtime: runtime ? (runtime.ok ? 'ok' : 'failed') : 'skipped',
        extraction: report.extraction,
      },
      ok ? 'motion graphic validated' : 'motion graphic failed validation',
    );

    if (ok && source && compiled) {
      const totalCost = attempts.reduce((sum, item) => sum + item.costUsd, 0);
      const result = await publish(brief, source, compiled, upload, {
        model,
        attempts,
        usage,
        costUsd: Number(totalCost.toFixed(6)),
        previewPath: runtime?.stillPath ?? null,
      });
      log.info({url: result.module.url, bytes: result.bytes, attempts: attempts.length}, 'motion graphic uploaded');
      return result;
    }
  }

  throw new MotionWorkerError(
    `motion graphic "${brief.id}" still invalid after ${maxAttempts} attempts`,
    brief.id,
    attempts,
    source,
  );
}

/**
 * Validate + upload an existing source without calling Claude (re-publishing a
 * previously generated file, fixtures). Same checks as the worker.
 */
export async function publishGraphicSource(
  briefInput: unknown,
  source: string,
  options: Pick<MotionWorkerOptions, 'upload' | 'runtimeCheck' | 'captionBottomFrac' | 'artifactsDir'> = {},
): Promise<MotionGraphicResult> {
  const brief = parseBrief(briefInput);
  const checker = options.runtimeCheck === false ? null : options.runtimeCheck ?? remotionRuntimeCheck;
  const stillPath = path.join(options.artifactsDir ?? os.tmpdir(), `${brief.id}.publish.png`);
  const {report, compiled, runtime} = await validateGraphicSource(
    source,
    checker ? {checker, brief, captionBottomFrac: options.captionBottomFrac, stillPath} : undefined,
  );
  if (!compiled || !isClean(report)) {
    const problems = [...report.safety, ...report.typecheck, ...report.compile, ...(report.runtime ?? [])];
    throw new Error(`graphic "${brief.id}" failed validation:\n  - ${problems.join('\n  - ')}`);
  }
  return publish(brief, source, compiled, options.upload ?? uploadModuleToR2, {
    model: null,
    attempts: [],
    usage: zeroUsage(),
    costUsd: 0,
    previewPath: runtime?.stillPath ?? null,
  });
}

/** The blueprint entry for the existing GeneratedGraphicTrack. Timing comes from the Director. */
export function toGeneratedGraphic(result: MotionGraphicResult, timing: {start: number; end: number}): GeneratedGraphic {
  return {
    id: result.id,
    start: timing.start,
    end: timing.end,
    placement: result.placement,
    module: result.module,
    props: result.props,
    brief: result.brief,
  };
}
