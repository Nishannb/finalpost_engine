/**
 * Phase 1.5 generated asset manifest: the only way generated audio reaches the compiler.
 *
 *   provider outcome (runware.ts) --ingest--> GeneratedAssetManifest --validate--> asset catalogue + plan --compile.ts--> AudioTimeline
 *
 * The compiler never sees a provider response: it sees MusicAsset / SfxAsset records built from manifest entries that passed validation (file present,
 * SHA-256 matches, WAV re-parsed and matching, durations fit their requests, one sound per event, request identity intact).
 *
 * Deterministic: no clock, no randomness. Asset ids and file names come from request ids; entries are sorted; `manifestHash` is the canonical hash of
 * everything else. The same outcomes and files always give the same manifest.
 */

import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {z} from 'zod';

import type {MusicAsset, SfxAsset} from '../audioPlan/assets.ts';
import {audioPlanSchema, type AudioPlanInput} from '../audioPlan/planSchema.ts';
import {canonicalJson} from '../eventSheet/hash.ts';
import type {EditEventSheet} from '../eventSheet/types.ts';
import type {BgmGenerationRequest, SfxGenerationRequest} from './requests.ts';
import type {ContractVerification, GenerationOutcome} from './runware.ts';
import {carveSpeechBand} from './speechCarve.ts';
import {decodeWav, measurePeakAndOnset, prepareSfxWav, WavError, wavInfo} from './wav.ts';

export const GENERATED_MANIFEST_VERSION = 1 as const;
/** A generated SFX quieter than this at its peak is treated as silent (failed generation), never placed. */
export const SILENT_PEAK_DBFS = -60;
/** Duration tolerance when re-checking files (one 48 kHz sample is ~0.02 ms; this allows encoder rounding). */
const DURATION_TOLERANCE_SEC = 0.002;

export const DEFAULT_USAGE = Object.freeze({
  cleared: false,
  licence: 'Runware-generated audio; commercial redistribution terms not verified',
  restriction: 'local review only until a human clears the provider terms',
});

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

const fileSchema = z.strictObject({
  /** What the renderer plays: `staticFile:<path>` under the public root. */
  src: z.string().regex(/^staticFile:[A-Za-z0-9_./-]+$/),
  /** Path relative to the public root. */
  path: z.string().regex(/^[A-Za-z0-9_./-]+$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  format: z.literal('wav'),
  codec: z.enum(['pcm_int', 'pcm_float']),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  bitsPerSample: z.number().int().positive(),
  durationSec: z.number().positive(),
});

const entrySchema = z.strictObject({
  assetId: z.string().regex(/^gen-(bgm|sfx)-[0-9a-f]{12}$/),
  kind: z.enum(['music', 'sfx']),
  status: z.enum(['ready', 'failed', 'invalid']),
  requestId: z.string().regex(/^(bgm|sfx)req-v1:[0-9a-f]{64}$/),
  /** SFX: the Event Sheet event this sound was generated for. Music: null. */
  sourceEventId: z.string().nullable(),
  provider: z.literal('runware'),
  model: z.string().min(1),
  taskUUID: z.string().nullable(),
  seed: z.number().int().nullable(),
  taskHash: z.string(),
  file: fileSchema.nullable(),
  measured: z.strictObject({peakDbfs: z.number(), transientOffsetSec: z.number().nullable(), integratedLufs: z.number().nullable()}).nullable(),
  /** SFX only: what the deterministic trim did. */
  prepared: z.strictObject({trimmedLeadSec: z.number(), cutTailSec: z.number(), faded: z.boolean(), speechBandCarveDb: z.number().optional(), preCarvePeakDbfs: z.number().optional()}).nullable(),
  costUsd: z.number().nullable(),
  failure: z.strictObject({code: z.string(), detail: z.string()}).nullable(),
  provenance: z.strictObject({
    generator: z.literal('audio_director_generation_v1'),
    contractVerification: z.enum(['live_smoke_2026_11_03', 'project_source_never_called_live']),
    usage: z.strictObject({cleared: z.boolean(), licence: z.string().min(1), restriction: z.string().min(1)}),
  }),
});
export type GeneratedAssetEntry = z.infer<typeof entrySchema>;

export const generatedManifestSchema = z.strictObject({
  version: z.literal(GENERATED_MANIFEST_VERSION),
  videoId: z.string().min(1),
  eventSheet: z.strictObject({version: z.number().int(), timingHash: z.string()}),
  /** Hash of the request ids the manifest answers (sorted). */
  requestSetHash: z.string().regex(/^reqset-v1:[0-9a-f]{64}$/),
  assets: z.array(entrySchema),
  manifestHash: z.string().regex(/^manifest-v1:[0-9a-f]{64}$/),
});
export type GeneratedAssetManifest = z.infer<typeof generatedManifestSchema>;

export const assetIdFor = (kind: 'music' | 'sfx', requestId: string): string => `gen-${kind === 'music' ? 'bgm' : 'sfx'}-${sha256Hex(requestId).slice(0, 12)}`;
export const requestSetHash = (requestIds: readonly string[]): string => `reqset-v1:${sha256Hex(canonicalJson([...requestIds].sort()))}`;
const hashManifest = (body: Omit<GeneratedAssetManifest, 'manifestHash'>): string => `manifest-v1:${sha256Hex(canonicalJson(body))}`;

export type LufsMeter = (absPath: string) => Promise<number>;

/**
 * Turns job outcomes into manifest entries. Writes each accepted file to `<publicRoot>/<relDir>/<assetId>.wav` (SFX trimmed and faded
 * deterministically; music copied as generated) and measures it. Music loudness comes from `measureLufs` (inject a meter; there is no default so a
 * missing measurement can never be silently assumed).
 */
export async function ingestGeneration(input: {
  videoId: string;
  sheet: EditEventSheet;
  bgm: BgmGenerationRequest | null;
  sfx: readonly SfxGenerationRequest[];
  outcomes: readonly GenerationOutcome[];
  publicRoot: string;
  relDir: string;
  measureLufs: LufsMeter;
  usage?: {cleared: boolean; licence: string; restriction: string};
}): Promise<GeneratedAssetManifest> {
  const usage = input.usage ?? DEFAULT_USAGE;
  const requests = new Map<string, BgmGenerationRequest | SfxGenerationRequest>([...(input.bgm ? [input.bgm] : []), ...input.sfx].map(request => [request.requestId, request]));
  mkdirSync(path.join(input.publicRoot, input.relDir), {recursive: true});
  const assets: GeneratedAssetEntry[] = [];
  for (const outcome of input.outcomes) {
    const request = requests.get(outcome.requestId);
    if (!request) continue; // an outcome for a request this job did not make is not ingested
    const kind: 'music' | 'sfx' = request.kind === 'bgm' ? 'music' : 'sfx';
    const assetId = assetIdFor(kind, request.requestId);
    const base = {
      assetId,
      kind,
      requestId: request.requestId,
      sourceEventId: request.kind === 'sfx' ? request.event.id : null,
      provider: 'runware' as const,
      model: outcome.model,
      taskUUID: outcome.taskUUID,
      seed: outcome.seed,
      taskHash: outcome.taskHash,
      costUsd: outcome.costUsd,
      provenance: {generator: 'audio_director_generation_v1' as const, contractVerification: outcome.contractVerification as ContractVerification, usage: {...usage}},
    };
    const notReady = (status: 'failed' | 'invalid', code: string, detail: string): GeneratedAssetEntry => ({...base, status, file: null, measured: null, prepared: null, failure: {code, detail}});
    if (outcome.status === 'failed' || !outcome.rawPath) {
      assets.push(notReady('failed', outcome.failure?.code ?? 'failed', outcome.failure?.detail ?? 'generation failed'));
      continue;
    }
    try {
      const raw = readFileSync(outcome.rawPath);
      const decoded = decodeWav(raw);
      const rel = `${input.relDir.replace(/\/+$/, '')}/${assetId}.wav`;
      const abs = path.join(input.publicRoot, rel);
      let prepared: GeneratedAssetEntry['prepared'] = null;
      if (request.kind === 'sfx') {
        const result = prepareSfxWav(decoded, request.durationSec.max);
        // Visual Event Sound Design: a sound planned as an under-speech onset accent is speech-band carved (generation/speechCarve.ts)
        const carve = request.timing?.tier === 'onset_accent' ? carveSpeechBand(result.bytes) : null;
        writeFileSync(abs, carve ? carve.bytes : result.bytes);
        const preCarvePeak = carve ? measurePeakAndOnset(decodeWav(result.bytes)).peakDbfs : null;
        prepared = {trimmedLeadSec: Math.round(result.trimmedLeadSec * 10000) / 10000, cutTailSec: Math.round(result.cutTailSec * 10000) / 10000, faded: result.faded, ...(carve ? {speechBandCarveDb: carve.speechBandChangeDb, ...(preCarvePeak !== null && Number.isFinite(preCarvePeak) ? {preCarvePeakDbfs: preCarvePeak} : {})} : {})};
      } else {
        copyFileSync(outcome.rawPath, abs);
      }
      const bytes = readFileSync(abs);
      const final = decodeWav(bytes);
      const peak = measurePeakAndOnset(final);
      const integratedLufs = request.kind === 'bgm' ? await input.measureLufs(abs) : null;
      const info = wavInfo(final);
      assets.push({
        ...base,
        status: 'ready',
        file: {src: `staticFile:${rel}`, path: rel, sha256: sha256Hex(bytes), bytes: bytes.length, format: 'wav', codec: info.codec, sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, durationSec: Math.round(info.durationSec * 10000) / 10000},
        measured: {peakDbfs: Number.isFinite(peak.peakDbfs) ? peak.peakDbfs : -200, transientOffsetSec: peak.transientOffsetSec, integratedLufs: integratedLufs === null ? null : Math.round(integratedLufs * 10) / 10},
        prepared,
        failure: null,
      });
    } catch (error) {
      const code = error instanceof WavError ? (error.code === 'not_wav' ? 'unsupported_format' : error.code) : 'ingest_failed';
      assets.push(notReady('invalid', code, error instanceof Error ? error.message.slice(0, 300) : 'ingest failed'));
    }
  }
  assets.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  const body = {
    version: GENERATED_MANIFEST_VERSION,
    videoId: input.videoId,
    eventSheet: {version: input.sheet.version, timingHash: input.sheet.timingHash},
    requestSetHash: requestSetHash([...requests.keys()]),
    assets,
  };
  return {...body, manifestHash: hashManifest(body)};
}

export type ManifestIssue = {ref: string; code: string; detail: string};

/**
 * Everything the compiler relies on, re-checked from the files themselves. A manifest with any issue yields no assets (validateManifest().ok false);
 * an entry that is `failed` or `invalid` is allowed (it is simply not a usable asset) but must carry its failure and no file.
 */
export function validateManifest(raw: unknown, ctx: {sheet: EditEventSheet; bgm: BgmGenerationRequest | null; sfx: readonly SfxGenerationRequest[]; publicRoot: string}): {ok: true; manifest: GeneratedAssetManifest} | {ok: false; issues: ManifestIssue[]} {
  const parsed = generatedManifestSchema.safeParse(raw);
  if (!parsed.success) return {ok: false, issues: parsed.error.issues.map(issue => ({ref: issue.path.join('.') || '(root)', code: 'schema_invalid', detail: issue.message}))};
  const manifest = parsed.data;
  const issues: ManifestIssue[] = [];
  const {manifestHash, ...body} = manifest;
  if (hashManifest(body) !== manifestHash) issues.push({ref: 'manifestHash', code: 'manifest_hash_mismatch', detail: 'the manifest was edited after it was written'});
  if (manifest.eventSheet.timingHash !== ctx.sheet.timingHash) issues.push({ref: 'eventSheet.timingHash', code: 'stale_timing', detail: 'generated for a different edit timing'});
  const requests = new Map<string, BgmGenerationRequest | SfxGenerationRequest>([...(ctx.bgm ? [ctx.bgm] : []), ...ctx.sfx].map(request => [request.requestId, request]));
  if (manifest.requestSetHash !== requestSetHash([...requests.keys()])) issues.push({ref: 'requestSetHash', code: 'request_set_mismatch', detail: 'the manifest answers a different set of requests'});
  const events = new Set(ctx.sheet.events.map(event => event.id));
  const readyByEvent = new Map<string, string>();
  const seenRequests = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of manifest.assets) {
    const ref = `asset:${entry.assetId}`;
    if (seenIds.has(entry.assetId)) issues.push({ref, code: 'duplicate_asset_id', detail: 'asset ids must be unique'});
    seenIds.add(entry.assetId);
    if (seenRequests.has(entry.requestId)) issues.push({ref, code: 'duplicate_request', detail: `${entry.requestId} has more than one asset`});
    seenRequests.add(entry.requestId);
    const request = requests.get(entry.requestId);
    if (!request) {
      issues.push({ref, code: 'unknown_request', detail: `${entry.requestId} is not one of this job's requests`});
      continue;
    }
    const kind = request.kind === 'bgm' ? 'music' : 'sfx';
    if (entry.kind !== kind || entry.assetId !== assetIdFor(kind, request.requestId)) issues.push({ref, code: 'asset_identity_mismatch', detail: 'kind or asset id does not derive from the request'});
    if (request.kind === 'sfx') {
      if (entry.sourceEventId !== request.event.id) issues.push({ref, code: 'event_identity_mismatch', detail: `asset says ${entry.sourceEventId}, request says ${request.event.id}`});
      if (!events.has(request.event.id)) issues.push({ref, code: 'unknown_event', detail: `${request.event.id} is not an event of this sheet`});
    } else if (entry.sourceEventId !== null) issues.push({ref, code: 'event_identity_mismatch', detail: 'music has no source event'});
    if (entry.status !== 'ready') {
      if (!entry.failure || entry.file) issues.push({ref, code: 'not_ready_without_failure', detail: 'a failed or invalid entry must carry its failure and no file'});
      continue;
    }
    if (!entry.file || !entry.measured || entry.failure) {
      issues.push({ref, code: 'ready_without_file', detail: 'a ready entry needs a file and measurements, and no failure'});
      continue;
    }
    if (request.kind === 'sfx') {
      const other = readyByEvent.get(request.event.id);
      if (other) issues.push({ref, code: 'duplicate_event', detail: `${request.event.id} already has ${other}`});
      readyByEvent.set(request.event.id, entry.assetId);
    }
    const abs = path.join(ctx.publicRoot, entry.file.path);
    if (entry.file.src !== `staticFile:${entry.file.path}`) issues.push({ref, code: 'src_path_mismatch', detail: 'src must be staticFile:<path>'});
    if (!existsSync(abs)) {
      issues.push({ref, code: 'file_missing', detail: entry.file.path});
      continue;
    }
    const bytes = readFileSync(abs);
    if (sha256Hex(bytes) !== entry.file.sha256 || bytes.length !== entry.file.bytes) {
      issues.push({ref, code: 'file_hash_mismatch', detail: `${entry.file.path} changed since ingest`});
      continue;
    }
    let decoded;
    try {
      decoded = decodeWav(bytes);
    } catch (error) {
      issues.push({ref, code: 'unsupported_format', detail: error instanceof Error ? error.message : 'not a WAV'});
      continue;
    }
    if (decoded.sampleRate !== entry.file.sampleRate || decoded.channels !== entry.file.channels || Math.abs(decoded.durationSec - entry.file.durationSec) > DURATION_TOLERANCE_SEC) {
      issues.push({ref, code: 'file_metadata_mismatch', detail: 're-parsed WAV does not match the recorded format or duration'});
    }
    if (request.kind === 'bgm') {
      if (entry.measured.integratedLufs === null) issues.push({ref, code: 'music_loudness_missing', detail: 'integratedLufs is required to duck the bed against the voice'});
      if (entry.file.durationSec + DURATION_TOLERANCE_SEC < request.window.durationSec) issues.push({ref, code: 'too_short_for_window', detail: `${entry.file.durationSec}s < the ${request.window.durationSec}s music window`});
    } else {
      if (entry.file.durationSec > request.durationSec.max + DURATION_TOLERANCE_SEC) issues.push({ref, code: 'longer_than_request', detail: `${entry.file.durationSec}s > ${request.durationSec.max}s`});
      if (entry.file.durationSec + DURATION_TOLERANCE_SEC < request.durationSec.min) issues.push({ref, code: 'shorter_than_request', detail: `${entry.file.durationSec}s < ${request.durationSec.min}s`});
      if (entry.measured.peakDbfs < SILENT_PEAK_DBFS || entry.measured.transientOffsetSec === null) issues.push({ref, code: 'silent_asset', detail: `peak ${entry.measured.peakDbfs} dBFS`});
    }
  }
  return issues.length > 0 ? {ok: false, issues} : {ok: true, manifest};
}

const rightsOf = (entry: GeneratedAssetEntry) => ({cleared: entry.provenance.usage.cleared, licence: entry.provenance.usage.licence, note: entry.provenance.usage.restriction});

/** Ready entries of a VALIDATED manifest as compiler assets. */
export function manifestAssets(manifest: GeneratedAssetManifest): {music: MusicAsset[]; sfx: SfxAsset[]} {
  const ready = manifest.assets.filter(entry => entry.status === 'ready' && entry.file && entry.measured);
  return {
    music: ready
      .filter(entry => entry.kind === 'music')
      .map(entry => ({id: entry.assetId, kind: 'music', source: 'generated', url: entry.file!.src, fullDurationSec: entry.file!.durationSec, ...(entry.measured!.integratedLufs !== null ? {integratedLufs: entry.measured!.integratedLufs} : {}), rights: rightsOf(entry)})),
    sfx: ready
      .filter(entry => entry.kind === 'sfx')
      .map(entry => ({id: entry.assetId, kind: 'sfx', source: 'generated', src: entry.file!.src, durationSec: entry.file!.durationSec, peakDbfs: entry.measured!.peakDbfs, transientOffsetSec: entry.measured!.transientOffsetSec ?? 0, rights: rightsOf(entry), ...(entry.file!.channels === 1 || entry.file!.channels === 2 ? {channels: entry.file!.channels as 1 | 2} : {}), ...(entry.prepared?.speechBandCarveDb !== undefined ? {speechBandCarved: true, ...(entry.prepared.preCarvePeakDbfs !== undefined ? {levelPeakDbfs: entry.prepared.preCarvePeakDbfs} : {})} : {})})),
  };
}

export const generatedCueId = (eventId: string): string => `g-${sha256Hex(eventId).slice(0, 12)}`;

export type GeneratedPlanReport = {
  music: 'generated' | 'unavailable';
  musicFailure: string | null;
  sfxAdded: {eventId: string; cueId: string; assetId: string}[];
  sfxMissing: {eventId: string; essential: boolean; reason: string}[];
  essentialMissing: boolean;
  /** Phase SFX-2: present only when `essentialFallback` was requested. Built-in sounds standing in for missing ESSENTIAL generated SFX. */
  sfxFallback?: {eventId: string; cueId: string; builtin: 'whoosh' | 'hit' | 'pop'; reason: string}[];
};

/**
 * Phase SFX-2: the built-in stand-in for a missing essential generated SFX, by family. Sustained families (swell, texture) have no honest built-in
 * equivalent, so they get none and stay reported as missing.
 */
export const FALLBACK_BUILTIN_BY_FAMILY: Readonly<Record<SfxGenerationRequest['character']['family'], 'whoosh' | 'hit' | 'pop' | null>> = Object.freeze({
  whoosh: 'whoosh',
  sweep: 'whoosh',
  riser: 'whoosh',
  impact: 'hit',
  stinger: 'hit',
  pop: 'pop',
  click: 'pop',
  swell: null,
  texture: null,
});
export const fallbackCueId = (eventId: string): string => `f-${sha256Hex(eventId).slice(0, 12)}`;

/**
 * The Director's plan with generated assets in it: the music intent names the generated bed (its sections, entry, fades are unchanged), and each
 * ready event SFX becomes one cue anchored on its own event, aligned by its measured transient. Everything else (placement, ducking, word mask,
 * budget) is the compiler's. A failed bed leaves `music: null` and says so; the caller decides the fallback (plan.policy.fallback).
 */
export function applyGeneratedAssets(
  planInput: unknown,
  manifest: GeneratedAssetManifest,
  sfxRequests: readonly SfxGenerationRequest[],
  /** Phase SFX-2 (opt-in): `builtin` places a clearly labelled built-in sound for a missing ESSENTIAL SFX. Default: none (unchanged behaviour). */
  options: {essentialFallback?: 'none' | 'builtin'} = {},
): {ok: true; plan: AudioPlanInput; report: GeneratedPlanReport} | {ok: false; detail: string} {
  const parsed = audioPlanSchema.safeParse(planInput);
  if (!parsed.success) return {ok: false, detail: parsed.error.issues[0]?.message ?? 'plan invalid'};
  const plan = parsed.data;
  if (plan.eventSheet.timingHash !== manifest.eventSheet.timingHash) return {ok: false, detail: 'plan and manifest are for different edit timings'};
  const byRequest = new Map(manifest.assets.map(entry => [entry.requestId, entry]));
  const music = manifest.assets.find(entry => entry.kind === 'music');
  const musicReady = music?.status === 'ready';
  const sfxAdded: GeneratedPlanReport['sfxAdded'] = [];
  const sfxMissing: GeneratedPlanReport['sfxMissing'] = [];
  const cues: AudioPlanInput['sfx'] = [];
  const sfxFallback: NonNullable<GeneratedPlanReport['sfxFallback']> = [];
  for (const request of sfxRequests) {
    const entry = byRequest.get(request.requestId);
    if (!entry || entry.status !== 'ready') {
      const reason = entry?.failure?.code ?? 'not_generated';
      const builtin = options.essentialFallback === 'builtin' && request.essential ? FALLBACK_BUILTIN_BY_FAMILY[request.character.family] : null;
      if (builtin) {
        const cueId = fallbackCueId(request.event.id);
        cues.push({
          id: cueId,
          anchor: {kind: 'event', eventId: request.event.id, at: request.event.anchorAt},
          align: 'transient',
          sound: {kind: 'builtin', name: builtin},
          level: request.intensity,
          priority: 1,
          allowConditionalVisibility: request.allowConditionalVisibility,
          family: request.character.family,
          why: `fallback: built-in ${builtin} for a missing generated ${request.purpose} sound (${reason})`.slice(0, 240),
        });
        sfxFallback.push({eventId: request.event.id, cueId, builtin, reason});
        continue;
      }
      sfxMissing.push({eventId: request.event.id, essential: request.essential, reason});
      continue;
    }
    const cueId = generatedCueId(request.event.id);
    cues.push({
      id: cueId,
      anchor: {kind: 'event', eventId: request.event.id, at: request.event.anchorAt},
      // Validation Sprint 2: a transient (impact / pop / click) is aligned on its measured hit; a sustained sound (whoosh, swell...) on its START, so
      // the compiled start is exactly the planned one whatever the file contains (its swell peak is inside its own designed lead-in).
      align: (['impact', 'pop', 'click'] as const).includes(request.character.family as 'impact') ? 'transient' : 'start',
      sound: {kind: 'asset', assetId: entry.assetId},
      level: request.intensity,
      priority: request.essential ? 1 : 3,
      ...(request.timing ? {plannedTransientFrame: request.timing.startFrame} : {}),
      allowConditionalVisibility: request.allowConditionalVisibility,
      family: request.character.family,
      why: `${request.purpose}: ${request.character.description}`.slice(0, 240),
    });
    sfxAdded.push({eventId: request.event.id, cueId, assetId: entry.assetId});
  }
  const next: AudioPlanInput = {
    ...plan,
    music: plan.music && musicReady ? {...plan.music, assetId: music!.assetId} : null,
    sfx: [...plan.sfx, ...cues],
  };
  return {
    ok: true,
    plan: next,
    report: {
      music: plan.music && musicReady ? 'generated' : 'unavailable',
      musicFailure: musicReady ? null : (music?.failure?.code ?? (plan.music ? 'not_generated' : 'plan_has_no_music')),
      sfxAdded,
      sfxMissing,
      essentialMissing: sfxMissing.some(item => item.essential),
      ...(options.essentialFallback === 'builtin' ? {sfxFallback} : {}),
    },
  };
}
