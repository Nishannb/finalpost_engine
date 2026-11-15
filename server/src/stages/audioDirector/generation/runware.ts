/**
 * Phase 1.5 Runware adapter for the AI Music Director: request -> provider task, provider response -> outcome, with generation DISABLED.
 *
 * Nothing here is invented. Every endpoint, task field, model id and response field comes from the project's existing Runware integration
 * (agents/music_specialist/runware.py, models.py, prompts.py, spend.py); generation/runwareParity.test.ts reads those files and fails on drift.
 * What each contract is verified by:
 *   BGM  `runware:ace-step@v1.5-base`: ONE live smoke on 2026-11-03 (60 s, 100 steps, CFG 10, WAV, includeCost $0.0075; models.py).
 *   SFX  `mirelo:1@1`, `bytedance:seed-audio@1.0`: project source only. Never called live (docs/ai-music-director/AI_MUSIC_DIRECTOR_READINESS_AUDIT.md
 *        "Generated SFX is a dead end"); the response format, duration range and output format are NOT verified. Live SFX generation therefore stays
 *        refused here even when generation is enabled, until those are verified against Runware's documentation or a supervised smoke.
 *
 * Disabled by default and by construction in Phase 1.5:
 *   - AUDIO_DIRECTOR_GENERATION must be "1" to even ask for a transport (default off), and
 *   - there is no live transport in this phase: createTransport() returns DisabledTransport or throws. Tests inject mock transports.
 * The API key is never read here.
 */

import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

import {canonicalJson} from '../eventSheet/hash.ts';
import {bgmGenerationState, callIdOf, claimBgmGeneration, resolveBgmGeneration, type BgmLedgerOptions, type ConsumedBy} from './bgmLedger.ts';
import {liveBgmDurationSec} from './durationPolicy.ts';
import {sfxCacheKey, type SfxCacheStore} from './sfxCache.ts';
import {claimSfxGeneration, resolveSfxGeneration, type SfxLedgerOptions} from './sfxLedger.ts';
import type {BgmGenerationRequest, SfxGenerationRequest, StoryRole} from './requests.ts';
import {sfxCapUsd, type VerifiedSfxContract} from './sfxContract.ts';

// --- Contract, mirrored from agents/music_specialist (parity-tested) -------------------------------------------------------------
export const RUNWARE_ENDPOINT = 'https://api.runware.ai/v1';
export const BGM_MODEL = 'runware:ace-step@v1.5-base';
export const BGM_DURATION_SEC = 60;
export const BGM_STEPS = 100;
export const BGM_CFG = 10;
export const BGM_COST_USD = 0.0075;
/** Mirrors agents/music_specialist/models.py SFX_COST_USD (parity-tested). NOT used to price TypeScript SFX: see SFX_PRICE. */
export const SFX_COST_USD = 0.0005;
export const MODEL_MIRELO = 'mirelo:1@1';
export const MODEL_SEED = 'bytedance:seed-audio@1.0';
/** The project's SFX task asks for 2 s (runware.py sfx_task); the requested length is reached by the deterministic trim (wav.ts). */
export const SFX_TASK_DURATION_SEC = 2;
/**
 * SFX-1: Mirelo SFX 1.5 (`mirelo:1@1`) request limits from Runware's model schema (docs/models/mirelo-sfx-1-5/schema.json, read 2026-11-13):
 * `duration` 1..10 s; `outputFormat` MP3 (default) | WAV | FLAC | OGG. Never called live from this project.
 */
export const MIRELO_DURATION_SEC = Object.freeze({min: 1, max: 10});
/**
 * SFX-1: the SFX price is NOT established. Runware's Mirelo schema gives $0.00025 per second, its overview says "starts at $0.01/s" (40x apart).
 * No figure is chosen: an SFX job has no numeric estimate, and a live transport refuses SFX on price grounds (in addition to the unverified contract).
 * Actual cost is only ever the provider-reported `cost` (includeCost: true).
 */
export const SFX_PRICE: Readonly<{usdPerSecond: null; evidence: string}> = Object.freeze({
  usdPerSecond: null,
  evidence: 'Runware Mirelo schema x-pricing $0.00025/s vs overview "starts at $0.01/s": conflicting; unresolved',
});
export const PROMPT_VERSION = 4;
export const TIME_SIGNATURE = 4;
export const MAX_CAPTION_TAGS = 12;
export const NEGATIVE_PROMPT = 'vocals, singing, voice, choir, lyrics, spoken word, rap, fade in, fade out, silence, applause, crowd noise, lead, solo, busy arpeggio, vocal chops, loud drums';
export const SUPPORT_TAGS = ['background underscore', 'minimal', 'sparse arrangement', 'no lead melody', 'supportive'] as const;
/** Structure tags the project already sends ACE-Step (briefRules.json arc.lyrics). No other tag is used. */
export const LYRIC_TAGS = Object.freeze({intro: '[intro]', build: '[build-up]', drop: '[drop]', inst: '[inst]'});

export type ContractVerification = 'live_smoke_2026_11_03' | 'project_source_never_called_live';
export const CONTRACT_VERIFICATION: Readonly<{bgm: ContractVerification; sfx: ContractVerification}> = Object.freeze({bgm: 'live_smoke_2026_11_03', sfx: 'project_source_never_called_live'});

// --- Errors and flags ------------------------------------------------------------------------------------------------------------
export type GenerationErrorCode =
  | 'generation_disabled'
  | 'live_transport_not_implemented'
  | 'sfx_contract_unverified'
  | 'duration_not_verified'
  | 'cost_cap_exceeded'
  | 'sfx_price_unknown'
  | 'sfx_already_generated'
  | 'sfx_ledger_required'
  | 'transport_error'
  | 'download_failed'
  | 'still_processing_after_polls'
  | 'response_not_object'
  | 'provider_error'
  | 'provider_item_error'
  | 'no_data'
  | 'no_audio_url'
  | 'bgm_already_generated'
  | 'bgm_ledger_required';

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  constructor(code: GenerationErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** Default OFF. Only "1" enables, and in Phase 1.5 enabling still yields no live transport. */
export const generationFlagEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => (env.AUDIO_DIRECTOR_GENERATION ?? '').trim() === '1';

export type RunwareTransport = {
  readonly live: boolean;
  /** POST one task array to the provider endpoint; resolves to the parsed JSON body. */
  post(tasks: readonly Record<string, unknown>[]): Promise<unknown>;
  /** Fetch a provider audio URL to a local file. */
  download(url: string, dest: string): Promise<void>;
};

export class DisabledTransport implements RunwareTransport {
  readonly live = false;
  async post(): Promise<unknown> {
    throw new GenerationError('generation_disabled', 'AI Music Director generation is disabled (AUDIO_DIRECTOR_GENERATION is off)');
  }
  async download(): Promise<void> {
    throw new GenerationError('generation_disabled', 'AI Music Director generation is disabled (AUDIO_DIRECTOR_GENERATION is off)');
  }
}

/** Phase 1.5: never a live transport. Off -> DisabledTransport; on -> refused, because no live transport ships in this phase. */
export function createTransport(env: NodeJS.ProcessEnv = process.env): RunwareTransport {
  if (!generationFlagEnabled(env)) return new DisabledTransport();
  throw new GenerationError('live_transport_not_implemented', 'Phase 1.5 ships no live Runware transport; generation runs only with an injected (mock) transport');
}

// --- Deterministic identity ------------------------------------------------------------------------------------------------------
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Stable seed in 0..2147483647, the same construction as prompts.py derive_seed (sha256, first 8 bytes big-endian, mod 2^31). */
export function deriveSeed(videoId: string, requestId: string, promptVersion: number = PROMPT_VERSION): number {
  const digest = createHash('sha256').update(`${videoId}|${requestId}|${promptVersion}`, 'utf8').digest();
  return Number(digest.readBigUInt64BE(0) % 2147483648n);
}

/** A well-formed v4-style UUID derived from the request (not random), so a re-run of the same request sends the same task id. */
export function deterministicTaskUuid(requestId: string, attempt: number): string {
  const hex = sha256(`${requestId}|attempt:${attempt}`).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// --- Request -> provider task ----------------------------------------------------------------------------------------------------
/** At most MAX_CAPTION_TAGS tags, highest priority first; the same order and drop rule as prompts.py caption_for. */
export function bgmCaption(request: BgmGenerationRequest): string {
  const tags = [
    request.identity.genre,
    ...request.identity.moodWords,
    ...request.identity.instruments,
    ...SUPPORT_TAGS,
    'no vocals',
    `${request.tempo.bpm} bpm`,
    'instrumental',
    ...request.identity.texture,
  ];
  return tags.slice(0, MAX_CAPTION_TAGS).join(', ');
}

const ROLE_TAG: Readonly<Record<StoryRole, string>> = Object.freeze({
  intro: LYRIC_TAGS.intro,
  establish: LYRIC_TAGS.inst,
  build: LYRIC_TAGS.build,
  peak: LYRIC_TAGS.drop,
  settle: LYRIC_TAGS.inst,
  pause: LYRIC_TAGS.inst,
  resolve: LYRIC_TAGS.inst,
  outro: LYRIC_TAGS.inst,
});

/**
 * The story progression as ACE-Step structure tags (settings.lyrics), using only the tags the project already sends. Consecutive equal tags merge.
 * This asks for the bed's SHAPE (intro, build, drop, settle); it does not make the generated sections land at exact seconds. Exact timing stays with
 * the compiler (sections, stop-downs, fades).
 */
export function bgmStructure(request: BgmGenerationRequest): string {
  const tags = request.progression.map(segment => ROLE_TAG[segment.role]);
  if (request.intro !== 'immediate' && tags[0] !== LYRIC_TAGS.intro) tags.unshift(LYRIC_TAGS.intro);
  const merged = tags.filter((value, index) => index === 0 || value !== tags[index - 1]);
  if (merged.length === 1) merged.push(LYRIC_TAGS.inst);
  return merged.join('\n\n');
}

/**
 * settings.lyrics exactly as sent in the one recorded live smoke (2026-11-03): agents/music_specialist/prompts.py LYRICS, the only value that existed
 * before briefRules.json arcs ([build-up], [drop]) were added on 2026-11-04 (commit 6ec6d6f). Only [intro] and [inst] have live evidence.
 */
export const VERIFIED_SMOKE_LYRICS = '[intro]\n\n[inst]\n\n[inst]';

/** 'story' (Phase 1.5 default): lyrics from the progression. 'verified_smoke': the smoke's exact lyrics; the progression stays local metadata. */
export type BgmStructureMode = 'story' | 'verified_smoke';

export type ProviderTask = Record<string, unknown> & {taskType: 'audioInference'; taskUUID: string; model: string; positivePrompt: string};

export function buildBgmTask(request: BgmGenerationRequest, attempt = 0, opts: {structure?: BgmStructureMode} = {}): {task: ProviderTask; seed: number} {
  if (request.window.durationSec > BGM_DURATION_SEC) {
    throw new GenerationError('duration_not_verified', `the edit needs ${request.window.durationSec}s of music; only ${BGM_DURATION_SEC}s is verified with ${BGM_MODEL} (a loop body or longer duration needs Runware documentation or a supervised smoke)`);
  }
  // Phase 1.7.1: the duration comes from the policy with the VERIFIED table only ({60, 60}); the ending margin is inactive. Always 60 today.
  const duration = liveBgmDurationSec(request.window.durationSec);
  if (duration !== BGM_DURATION_SEC) throw new GenerationError('duration_not_verified', `policy produced ${duration}s; only ${BGM_DURATION_SEC}s is verified`);
  const seed = deriveSeed(request.videoId, request.requestId);
  const negative = [NEGATIVE_PROMPT, ...request.identity.avoid].join(', ');
  return {
    seed,
    task: {
      taskType: 'audioInference',
      taskUUID: deterministicTaskUuid(request.requestId, attempt),
      model: BGM_MODEL,
      positivePrompt: bgmCaption(request),
      negativePrompt: negative,
      duration,
      steps: BGM_STEPS,
      CFGScale: BGM_CFG,
      seed,
      outputFormat: 'WAV',
      outputType: 'URL',
      includeCost: true,
      numberResults: 1,
      deliveryMethod: 'sync',
      settings: {bpm: request.tempo.bpm, keyScale: request.key, timeSignature: TIME_SIGNATURE, vocalLanguage: 'unknown', lyrics: opts.structure === 'verified_smoke' ? VERIFIED_SMOKE_LYRICS : bgmStructure(request)},
    },
  };
}

/** Phase SFX-2: the cross-video cache identity of one SFX request (its exact provider task plus its ingest trim). */
export const sfxCacheKeyFor = (request: SfxGenerationRequest): string => sfxCacheKey(buildSfxTask(request).task, request.durationSec.max);

/** The positive prompt for one event's sound: its own description and family, plus the project's "no music, no vocals" suffix. */
export function sfxPrompt(request: SfxGenerationRequest): string {
  return `${request.character.description}, ${request.character.family} sound effect, no music, no vocals`.slice(0, 300);
}

/**
 * SFX-1: every SFX family, including `texture`, uses Mirelo SFX. `bytedance:seed-audio@1.0` is a speech model (Runware schema: "speech generation
 * model for expressive TTS, voice conversion, and speech editing", no duration field), so it is never used for SFX.
 */
export const sfxModelFor = (_request: SfxGenerationRequest): string => MODEL_MIRELO;

/** The provider duration for an SFX: the smallest whole second covering the request's max, within Mirelo's 1..10 s. Ingest trims to the request. */
export const sfxTaskDurationSec = (request: SfxGenerationRequest): number =>
  Math.min(MIRELO_DURATION_SEC.max, Math.max(MIRELO_DURATION_SEC.min, Math.ceil(request.durationSec.max - 1e-9)));

/** Exactly the fields of runware.py sfx_task (no others are verified). */
export function buildSfxTask(request: SfxGenerationRequest, attempt = 0): {task: ProviderTask} {
  return {
    task: {
      taskType: 'audioInference',
      taskUUID: deterministicTaskUuid(request.requestId, attempt),
      model: sfxModelFor(request),
      positivePrompt: sfxPrompt(request),
      duration: sfxTaskDurationSec(request),
      outputFormat: 'WAV',
      outputType: 'URL',
      includeCost: true,
      deliveryMethod: 'sync',
    },
  };
}

// --- Provider response -> outcome ------------------------------------------------------------------------------------------------
export type ParsedResponse =
  | {kind: 'ready'; audioUrl: string; costUsd: number | null; taskUUID: string | null}
  | {kind: 'processing'; taskUUID: string | null}
  | {kind: 'failed'; code: GenerationErrorCode; detail: string};

/** The same rules as runware.py RunwareTransport._item and post(). */
export function parseRunwareResponse(body: unknown): ParsedResponse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {kind: 'failed', code: 'response_not_object', detail: 'Runware response was not an object'};
  const record = body as {errors?: unknown; data?: unknown};
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const data = Array.isArray(record.data) ? record.data : [];
  if (errors.length > 0 && data.length === 0) {
    const first = errors[0] as {code?: unknown} | null;
    const code = first && typeof first === 'object' && typeof first.code === 'string' ? first.code : 'unknown';
    return {kind: 'failed', code: 'provider_error', detail: `Runware audioInference failed (${code})`};
  }
  if (data.length === 0) return {kind: 'failed', code: 'no_data', detail: 'Runware response had no data'};
  const item = data[0] as Record<string, unknown>;
  if (!item || typeof item !== 'object') return {kind: 'failed', code: 'no_data', detail: 'Runware data[0] was not an object'};
  const taskUUID = typeof item.taskUUID === 'string' ? item.taskUUID : null;
  if (item.status === 'error') return {kind: 'failed', code: 'provider_item_error', detail: 'Runware audioInference failed (error)'};
  const url = typeof item.audioURL === 'string' && item.audioURL ? item.audioURL : typeof item.audioUrl === 'string' && item.audioUrl ? item.audioUrl : null;
  if (item.status === 'processing' && !url) return {kind: 'processing', taskUUID};
  if (!url) return {kind: 'failed', code: 'no_audio_url', detail: 'Runware response had no audioURL'};
  const cost = typeof item.cost === 'number' ? item.cost : typeof item.cost === 'string' && item.cost.trim() !== '' ? Number(item.cost) : null;
  return {kind: 'ready', audioUrl: url, costUsd: cost !== null && Number.isFinite(cost) ? cost : null, taskUUID};
}

// --- Orchestration ---------------------------------------------------------------------------------------------------------------
export type GenerationOutcome = {
  requestId: string;
  kind: 'bgm' | 'sfx';
  model: string;
  taskUUID: string;
  seed: number | null;
  /** Hash of the exact provider task (minus its taskUUID), so a manifest can prove which prompt made the file. */
  taskHash: string;
  contractVerification: ContractVerification;
  status: 'downloaded' | 'failed';
  /** Local file the provider audio was saved to (raw, before ingest). */
  rawPath: string | null;
  /** Host of the provider URL only (the full URL may be signed). */
  audioUrlHost: string | null;
  costUsd: number | null;
  failure: {code: GenerationErrorCode; detail: string} | null;
  /** Phase SFX-2 (SFX only): the cross-video cache identity, and whether the sound came from the cache (no provider request, cost 0). */
  cacheKey?: string;
  cacheHit?: boolean;
};

export type GenerationJobResult =
  | {status: 'refused'; code: GenerationErrorCode; detail: string; estimatedUsd: number | null; consumedBy?: ConsumedBy}
  | {
      status: 'completed';
      outcomes: GenerationOutcome[];
      /** Null when the job contains SFX: their price is unknown (SFX_PRICE). Never an underestimate. */
      estimatedUsd: number | null;
      reportedUsd: number;
      spendLines: string[];
      /** Phase 1.7.1: the video's ledger record after the job ('claimed' if the outcome could not be recorded: it still blocks). */
      bgmLedger?: {file: string; state: 'claimed' | 'resolved'};
    };

/** BGM-only estimate (unchanged BGM policy). SFX-1: an SFX count above 0 throws, because the SFX price is unknown (SFX_PRICE); use estimateGenerationCost. */
export const estimateCostUsd = (bgm: number, sfx: number): number => {
  if (sfx > 0) throw new GenerationError('sfx_price_unknown', SFX_PRICE.evidence);
  return Math.round(bgm * BGM_COST_USD * 1e6) / 1e6;
};

/** SFX-1: the job estimate. `usd` is null whenever SFX are included (their price is unknown); `knownUsd` covers BGM only. */
export function estimateGenerationCost(bgm: number, sfx: number): {usd: number | null; knownUsd: number; unknownSfx: number} {
  const knownUsd = estimateCostUsd(bgm, 0);
  return {usd: sfx > 0 && SFX_PRICE.usdPerSecond === null ? null : knownUsd, knownUsd, unknownSfx: SFX_PRICE.usdPerSecond === null ? sfx : 0};
}

/** One spend line in agents/music_specialist/spend.py's format (time is the caller's; nothing is written here). */
export function formatSpendLine(input: {isoTime: string; videoId: string; label: 'bgm' | 'sfx'; requestId: string; seed: number | null; costUsd: number | null; durationSec: number}): string {
  return [input.isoTime, `video=${input.videoId || '-'}`, `label=${input.label}`, `cache_key=${input.requestId}`, `seed=${input.seed ?? 0}`, `includeCost=${input.costUsd ?? ''}`, `duration=${input.durationSec}`].join(' ');
}

const taskHashOf = (task: ProviderTask) => {
  const {taskUUID: _uuid, ...rest} = task;
  return `task-v1:${sha256(canonicalJson(rest))}`;
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

/**
 * Runs one generation job through a transport: cost cap first (nothing is sent over the cap), then each request: post, poll with getResponse while
 * processing, download. Every failure is recorded per request; the job itself only refuses up front (cap, unverified SFX contract on a live transport).
 */
export async function runGenerationJob(input: {
  bgm: BgmGenerationRequest | null;
  sfx: readonly SfxGenerationRequest[];
  transport: RunwareTransport;
  maxUsd: number;
  workDir: string;
  /** getResponse polls while a task is processing. */
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  /** ISO time for spend lines (the caller's clock; never read here). */
  isoTime?: string;
  /** How the BGM task's settings.lyrics is built (default 'story', the Phase 1.5 behaviour). */
  bgmStructure?: BgmStructureMode;
  /** Phase SFX-2 (optional): cross-video SFX content cache. Hits are reused with no provider request. */
  sfxCache?: SfxCacheStore;
  /** Phase SFX-2 (optional): per-video SFX round ledger, claimed before the first SFX request. REQUIRED for SFX misses on a live transport. */
  sfxLedger?: SfxLedgerOptions;
  /**
   * Phase 1.7.1: the per-video generation ledger (bgmLedger.ts). REQUIRED for a BGM request on a live transport: one generation POST per video, ever.
   * Optional for mock and disabled transports so Phase 1.5 tests keep their shape.
   */
  bgmLedger?: BgmLedgerOptions;
  /**
   * Production Completion Sprint 1: the documentation-verified SFX contract (sfxContract.ts). ONLY with it may a live transport generate SFX: the
   * unverified-contract and unknown-price refusals are replaced by a worst-case cap (capUsdPerSecond x billed provider seconds) that must fit
   * `maxUsd`, and the per-video SFX ledger stays required. Absent = exactly the previous behaviour (live SFX refused).
   */
  sfxContract?: VerifiedSfxContract;
}): Promise<GenerationJobResult> {
  // Phase SFX-2: cache lookups first; only misses are generations (priced, refused on live, claimed in the ledger).
  const sfxPlan = input.sfx.map(request => {
    const built = buildSfxTask(request);
    const cacheKey = sfxCacheKey(built.task, request.durationSec.max);
    return {request, built, cacheKey, hit: input.sfxCache ? input.sfxCache.get(cacheKey) : null};
  });
  const sfxMisses = sfxPlan.filter(item => item.hit === null);
  const estimate = estimateGenerationCost(input.bgm ? 1 : 0, sfxMisses.length);
  const estimatedUsd = estimate.usd;
  // The cap is checked on what is known (BGM). SFX with an unknown price are never treated as free on a paying transport (below).
  if (estimate.knownUsd > input.maxUsd + 1e-12) return {status: 'refused', code: 'cost_cap_exceeded', detail: `estimated $${estimate.knownUsd} > cap $${input.maxUsd}`, estimatedUsd};
  if (input.transport.live && sfxMisses.length > 0 && input.sfxContract) {
    const capUsd = sfxCapUsd(sfxMisses.map(item => sfxTaskDurationSec(item.request)), input.sfxContract);
    const total = Math.round((estimate.knownUsd + capUsd) * 1e6) / 1e6;
    if (total > input.maxUsd + 1e-12) return {status: 'refused', code: 'cost_cap_exceeded', detail: `worst-case $${total} (SFX at $${input.sfxContract.capUsdPerSecond}/s) > cap $${input.maxUsd}`, estimatedUsd: total};
    if (!input.sfxLedger) return {status: 'refused', code: 'sfx_ledger_required', detail: 'a live SFX generation needs the per-video SFX ledger (one round per video)', estimatedUsd: total};
  } else if (input.transport.live && sfxMisses.length > 0) {
    return {status: 'refused', code: 'sfx_contract_unverified', detail: `${MODEL_MIRELO} was never called live; verify its response, duration and format before paying for SFX`, estimatedUsd};
  }
  if (input.transport.live && estimate.unknownSfx > 0 && !input.sfxContract) {
    return {status: 'refused', code: 'sfx_price_unknown', detail: `${estimate.unknownSfx} SFX with no established price (${SFX_PRICE.evidence}); a cap cannot be enforced`, estimatedUsd};
  }
  if (input.transport.live && sfxMisses.length > 0 && !input.sfxLedger) {
    return {status: 'refused', code: 'sfx_ledger_required', detail: 'a live SFX generation needs the per-video SFX ledger (one round per video)', estimatedUsd};
  }
  if (input.bgm && input.transport.live && !input.bgmLedger) {
    return {status: 'refused', code: 'bgm_ledger_required', detail: 'a live BGM generation needs the per-video ledger (one generation per video)', estimatedUsd};
  }
  if (input.bgm && input.bgmLedger) {
    const state = bgmGenerationState(input.bgmLedger);
    if (state.state === 'consumed') return {status: 'refused', code: 'bgm_already_generated', detail: `video ${input.bgmLedger.videoId} already used its one BGM generation (${state.by.source})`, estimatedUsd, consumedBy: state.by};
  }
  const sleep = input.sleep ?? (async () => undefined);
  const maxPolls = input.maxPolls ?? 20;
  mkdirSync(input.workDir, {recursive: true});
  const outcomes: GenerationOutcome[] = [];
  const spendLines: string[] = [];
  let ledgerState: {file: string; state: 'claimed' | 'resolved'} | undefined;

  const run = async (kind: 'bgm' | 'sfx', requestId: string, videoId: string, built: {task: ProviderTask; seed: number | null}, fileStem: string, durationSec: number) => {
    const base = {requestId, kind, model: built.task.model, taskUUID: built.task.taskUUID, seed: built.seed, taskHash: taskHashOf(built.task), contractVerification: CONTRACT_VERIFICATION[kind]};
    const fail = (code: GenerationErrorCode, detail: string, costUsd: number | null = null): GenerationOutcome => ({...base, status: 'failed', rawPath: null, audioUrlHost: null, costUsd, failure: {code, detail}});
    let parsed: ParsedResponse;
    try {
      parsed = parseRunwareResponse(await input.transport.post([built.task]));
      for (let poll = 0; parsed.kind === 'processing' && poll < maxPolls; poll += 1) {
        await sleep(Math.min(1500 * 1.5 ** poll, 8000));
        parsed = parseRunwareResponse(await input.transport.post([{taskType: 'getResponse', taskUUID: built.task.taskUUID}]));
      }
    } catch (error) {
      return fail(error instanceof GenerationError ? error.code : 'transport_error', error instanceof Error ? error.message.slice(0, 300) : 'transport failed');
    }
    if (parsed.kind === 'processing') return fail('still_processing_after_polls', `still processing after ${maxPolls} polls`);
    if (parsed.kind === 'failed') return fail(parsed.code, parsed.detail);
    if (input.isoTime) spendLines.push(formatSpendLine({isoTime: input.isoTime, videoId, label: kind, requestId, seed: built.seed, costUsd: parsed.costUsd, durationSec}));
    const rawPath = path.join(input.workDir, `${fileStem}.raw`);
    try {
      await input.transport.download(parsed.audioUrl, rawPath);
    } catch (error) {
      return fail(error instanceof GenerationError ? error.code : 'download_failed', error instanceof Error ? error.message.slice(0, 300) : 'download failed', parsed.costUsd);
    }
    return {...base, status: 'downloaded', rawPath, audioUrlHost: hostOf(parsed.audioUrl), costUsd: parsed.costUsd, failure: null} satisfies GenerationOutcome;
  };

  if (input.bgm) {
    let built: {task: ProviderTask; seed: number} | null = null;
    try {
      built = buildBgmTask(input.bgm, 0, {structure: input.bgmStructure});
    } catch (error) {
      const code = error instanceof GenerationError ? error.code : 'transport_error';
      outcomes.push({requestId: input.bgm.requestId, kind: 'bgm', model: BGM_MODEL, taskUUID: deterministicTaskUuid(input.bgm.requestId, 0), seed: null, taskHash: '', contractVerification: CONTRACT_VERIFICATION.bgm, status: 'failed', rawPath: null, audioUrlHost: null, costUsd: null, failure: {code, detail: error instanceof Error ? error.message : 'invalid'}});
    }
    if (built && input.bgmLedger) {
      // The claim is the decision, taken immediately before the POST: of concurrent jobs for one video exactly one gets past it.
      const claim = claimBgmGeneration(input.bgmLedger, {requestId: input.bgm.requestId, taskUUID: built.task.taskUUID, taskHash: taskHashOf(built.task), callId: callIdOf(built.task), claimedAt: input.isoTime ?? null});
      if (!claim.ok) return {status: 'refused', code: 'bgm_already_generated', detail: `video ${input.bgmLedger.videoId} already used its one BGM generation (${claim.consumed.source})`, estimatedUsd, consumedBy: claim.consumed};
      const outcome = await run('bgm', input.bgm.requestId, input.bgm.videoId, built, `bgm-${input.bgm.requestId.slice(-12)}`, built.task.duration as number);
      outcomes.push(outcome);
      try {
        resolveBgmGeneration(input.bgmLedger, {status: outcome.status, costUsd: outcome.costUsd, failureCode: outcome.failure?.code ?? null, rawPath: outcome.rawPath, resolvedAt: input.isoTime ?? null});
        ledgerState = {file: claim.file, state: 'resolved'};
      } catch {
        ledgerState = {file: claim.file, state: 'claimed'}; // the claim still blocks; the outcome is in this result and the manifest
      }
    } else if (built) {
      outcomes.push(await run('bgm', input.bgm.requestId, input.bgm.videoId, built, `bgm-${input.bgm.requestId.slice(-12)}`, built.task.duration as number));
    }
  }
  // Phase SFX-2: one SFX round per video. The misses are claimed together before the first SFX request; a consumed round makes every miss a
  // recorded failure with no request. Cache hits never touch the ledger.
  let sfxRoundRefused: string | null = null;
  let sfxRoundClaimed = false;
  if (sfxMisses.length > 0 && input.sfxLedger) {
    const claim = claimSfxGeneration(
      input.sfxLedger,
      sfxMisses.map(item => ({requestId: item.request.requestId, eventId: item.request.event.id, cacheKey: item.cacheKey, taskUUID: item.built.task.taskUUID})),
      input.isoTime ?? null,
    );
    if (claim.ok) sfxRoundClaimed = true;
    else sfxRoundRefused = claim.state.state === 'consumed' ? claim.state.detail : 'unavailable';
  }
  const generatedSfx: GenerationOutcome[] = [];
  for (const item of sfxPlan) {
    const {request, built, cacheKey, hit} = item;
    const stem = `sfx-${request.requestId.slice(-12)}`;
    const base = {requestId: request.requestId, kind: 'sfx' as const, model: built.task.model, taskUUID: built.task.taskUUID, seed: null, taskHash: taskHashOf(built.task), contractVerification: CONTRACT_VERIFICATION.sfx, cacheKey};
    if (hit) {
      const rawPath = path.join(input.workDir, `${stem}.raw`);
      copyFileSync(hit.file, rawPath);
      outcomes.push({...base, status: 'downloaded', rawPath, audioUrlHost: null, costUsd: 0, failure: null, cacheHit: true});
      continue;
    }
    if (sfxRoundRefused !== null) {
      outcomes.push({...base, status: 'failed', rawPath: null, audioUrlHost: null, costUsd: null, failure: {code: 'sfx_already_generated', detail: `this video already used its one SFX round (${sfxRoundRefused})`}, cacheHit: false});
      continue;
    }
    const outcome = {...(await run('sfx', request.requestId, request.videoId, {...built, seed: null}, stem, built.task.duration as number)), cacheKey, cacheHit: false};
    outcomes.push(outcome);
    generatedSfx.push(outcome);
  }
  if (sfxRoundClaimed && input.sfxLedger) {
    try {
      resolveSfxGeneration(input.sfxLedger, generatedSfx.map(outcome => ({requestId: outcome.requestId, status: outcome.status, costUsd: outcome.costUsd, failureCode: outcome.failure?.code ?? null})), input.isoTime ?? null);
    } catch {
      // the claim stays in force: still consumed
    }
  }
  const reportedUsd = Math.round(outcomes.reduce((sum, outcome) => sum + (outcome.costUsd ?? 0), 0) * 1e6) / 1e6;
  return {status: 'completed', outcomes, estimatedUsd, reportedUsd, spendLines, ...(ledgerState ? {bgmLedger: ledgerState} : {})};
}
