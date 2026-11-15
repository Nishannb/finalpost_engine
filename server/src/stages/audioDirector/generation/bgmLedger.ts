/**
 * Phase 1.7.1: the AudioDirector's per-video BGM generation record. Policy: ONE provider generation POST per edited video, ever.
 *
 * Why a separate file and not the manifest: the manifest (manifest.ts) is written only after the provider answered and the audio was downloaded and
 * measured, and it is content-hashed. It cannot record "a POST is about to be sent", which is the moment that matters: after it, the provider may have
 * started (and billed) work even if we never see an answer. So the gate is a small ledger file, one per video, created EXCLUSIVELY (O_CREAT|O_EXCL)
 * and fsynced BEFORE the POST, and never deleted or reset by code. Existing manifests are a second, read-only source: a manifest that already holds a
 * paid BGM entry (ready, invalid, or failed after a POST) also consumes the video. That covers beds generated before the ledger existed (Phase 1.6).
 *
 * Lifecycle:  (none) --claim (exclusive create, before the POST)--> claimed --resolve (atomic rename, after the outcome)--> resolved
 *   Any record, in any state, blocks another generation for that video, whatever the request id, prompt, seed or intent.
 *   `claimed` with no resolution means the outcome is unknown (crash, timeout, kill): it stays blocking. Clearing it is a human decision outside code.
 *
 * Guarantee: AT MOST ONE generation POST per video id per ledger directory, across concurrent jobs and processes on one local filesystem (the
 * exclusive create is the single point of decision). It is NOT exactly-once: a crash after the claim and before the POST consumes the video with no
 * generation. It does not coordinate across machines or different ledger directories, and it relies on nobody deleting ledger files.
 */

import {createHash} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync} from 'node:fs';
import path from 'node:path';

import {z} from 'zod';

import {generatedManifestSchema} from './manifest.ts';

export const MAX_BGM_GENERATIONS_PER_VIDEO = 1 as const;
export const BGM_LEDGER_VERSION = 1 as const;

/** Manifest failure codes that are decided before any network request; such an entry did not reach the provider. */
const PRE_NETWORK_FAILURES: ReadonlySet<string> = new Set(['generation_disabled', 'live_transport_not_implemented', 'duration_not_verified']);

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');

const attemptSchema = z.strictObject({
  requestId: z.string().min(1),
  taskUUID: z.string().min(1),
  taskHash: z.string().min(1),
  /** sha256 of the exact POST body (JSON.stringify of the one-task array), as `bgmcall-v1:` in Phase 1.6A. */
  callId: z.string().regex(/^bgmcall-v1:[0-9a-f]{64}$/),
  claimedAt: z.string().nullable(),
});

const resolutionSchema = z.strictObject({
  status: z.enum(['downloaded', 'failed']),
  costUsd: z.number().nullable(),
  failureCode: z.string().nullable(),
  rawPath: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});

export const bgmLedgerRecordSchema = z.strictObject({
  version: z.literal(BGM_LEDGER_VERSION),
  kind: z.literal('bgm_generation'),
  videoId: z.string().min(1),
  maxGenerations: z.literal(MAX_BGM_GENERATIONS_PER_VIDEO),
  state: z.enum(['claimed', 'resolved']),
  attempt: attemptSchema,
  resolution: resolutionSchema.nullable(),
});
export type BgmLedgerRecord = z.infer<typeof bgmLedgerRecordSchema>;

export type BgmLedgerOptions = {
  /** Directory holding one ledger file per video (git-ignored, local). */
  dir: string;
  /** The edited video's id (the request's videoId). */
  videoId: string;
  /** Existing manifests for this video: a paid BGM entry in any of them consumes the video too. */
  manifests?: readonly string[];
};

export type ConsumedBy =
  | {source: 'ledger'; state: 'claimed' | 'resolved'; record: BgmLedgerRecord}
  | {source: 'ledger'; state: 'unreadable'; detail: string}
  | {source: 'manifest'; manifestPath: string; assetId: string; entryStatus: 'ready' | 'failed' | 'invalid'};

export type BgmGenerationState = {state: 'available'} | {state: 'consumed'; by: ConsumedBy};

/** File name for a video: readable prefix plus a hash, so any id maps to one safe name and distinct ids never collide. */
export function ledgerPathFor(dir: string, videoId: string): string {
  const readable = videoId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(dir, `bgm-${readable}-${sha256Hex(videoId).slice(0, 16)}.json`);
}

export const callIdOf = (task: Record<string, unknown>): string => `bgmcall-v1:${sha256Hex(JSON.stringify([task]))}`;

function readLedger(file: string): {ok: true; record: BgmLedgerRecord} | {ok: false; detail: string} {
  try {
    const parsed = bgmLedgerRecordSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? {ok: true, record: parsed.data} : {ok: false, detail: 'ledger file does not match the schema'};
  } catch (error) {
    return {ok: false, detail: error instanceof Error ? error.name : 'unreadable'};
  }
}

/** A paid BGM entry in a manifest: ready, invalid (downloaded but rejected), or failed after a POST. Unreadable manifests are reported, conservatively. */
function manifestConsumption(manifestPath: string): ConsumedBy | null {
  if (!existsSync(manifestPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return {source: 'ledger', state: 'unreadable', detail: `manifest ${path.basename(manifestPath)} is not JSON`};
  }
  const parsed = generatedManifestSchema.safeParse(raw);
  if (!parsed.success) return {source: 'ledger', state: 'unreadable', detail: `manifest ${path.basename(manifestPath)} does not match the schema`};
  for (const entry of parsed.data.assets) {
    if (entry.kind !== 'music') continue;
    const posted = entry.status === 'ready' || entry.status === 'invalid' || (entry.taskHash !== '' && !PRE_NETWORK_FAILURES.has(entry.failure?.code ?? ''));
    if (posted) return {source: 'manifest', manifestPath, assetId: entry.assetId, entryStatus: entry.status};
  }
  return null;
}

/** Read-only: may this video still have its one generation? */
export function bgmGenerationState(opts: BgmLedgerOptions): BgmGenerationState {
  const file = ledgerPathFor(opts.dir, opts.videoId);
  if (existsSync(file)) {
    const read = readLedger(file);
    return {state: 'consumed', by: read.ok ? {source: 'ledger', state: read.record.state, record: read.record} : {source: 'ledger', state: 'unreadable', detail: read.detail}};
  }
  for (const manifestPath of opts.manifests ?? []) {
    const by = manifestConsumption(manifestPath);
    if (by) return {state: 'consumed', by};
  }
  return {state: 'available'};
}

function writeDurably(fd: number, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
}

export type ClaimResult = {ok: true; file: string; record: BgmLedgerRecord} | {ok: false; consumed: ConsumedBy};

/**
 * Claim the video's one generation. Must be called immediately before the POST, after every local validation that could still refuse the job.
 * The exclusive create is the decision: of any number of concurrent claims for one video, exactly one succeeds.
 */
export function claimBgmGeneration(opts: BgmLedgerOptions, attempt: z.input<typeof attemptSchema>): ClaimResult {
  const before = bgmGenerationState(opts);
  if (before.state === 'consumed') return {ok: false, consumed: before.by};
  mkdirSync(opts.dir, {recursive: true});
  const file = ledgerPathFor(opts.dir, opts.videoId);
  const record: BgmLedgerRecord = {
    version: BGM_LEDGER_VERSION,
    kind: 'bgm_generation',
    videoId: opts.videoId,
    maxGenerations: MAX_BGM_GENERATIONS_PER_VIDEO,
    state: 'claimed',
    attempt: attemptSchema.parse(attempt),
    resolution: null,
  };
  let fd: number;
  try {
    fd = openSync(file, 'wx'); // O_CREAT | O_EXCL
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const state = bgmGenerationState(opts);
      return {ok: false, consumed: state.state === 'consumed' ? state.by : {source: 'ledger', state: 'unreadable', detail: 'claimed concurrently'}};
    }
    throw error;
  }
  try {
    writeDurably(fd, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return {ok: true, file, record};
}

/**
 * Record the outcome of the claimed attempt (atomic: temp file + fsync + rename). Never clears the claim: a resolved record still blocks.
 * Failure to write the resolution leaves the record `claimed`, which still blocks.
 */
export function resolveBgmGeneration(opts: BgmLedgerOptions, resolution: BgmLedgerRecord['resolution'] & object): BgmLedgerRecord {
  const file = ledgerPathFor(opts.dir, opts.videoId);
  const read = readLedger(file);
  if (!read.ok) throw new Error(`bgm ledger for ${opts.videoId} is unreadable (${read.detail}); the claim stays in force`);
  if (read.record.state !== 'claimed') throw new Error(`bgm ledger for ${opts.videoId} is already resolved`);
  const record: BgmLedgerRecord = {...read.record, state: 'resolved', resolution: resolutionSchema.parse(resolution)};
  const temp = `${file}.${process.pid}.tmp`;
  const fd = openSync(temp, 'wx');
  try {
    writeDurably(fd, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  return record;
}

/** The reusable asset of a video, if a manifest holds a ready BGM entry: what re-renders and recompiles use instead of generating. */
export function existingReadyBgm(opts: Pick<BgmLedgerOptions, 'manifests'>): {manifestPath: string; assetId: string} | null {
  for (const manifestPath of opts.manifests ?? []) {
    const by = manifestConsumption(manifestPath);
    if (by && by.source === 'manifest' && by.entryStatus === 'ready') return {manifestPath, assetId: by.assetId};
  }
  return null;
}
