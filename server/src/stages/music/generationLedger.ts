/**
 * Phase 1.7.2: the production Music Specialist's per-video BGM generation ledger. Policy: at most ONE paid BGM generation attempt per edited video.
 *
 * Key (approved): `music/ledger/<videoId>.json`. Lifecycle: absent -> claimed -> resolved. Any record, in any state, consumes the video: a changed
 * prompt, seed, brief or cache key cannot buy a second generation. No code path deletes or resets a record.
 *
 * The concurrency guarantee is ONE storage primitive: an atomic create-if-absent (`createIfAbsent`). There is no read-then-write anywhere in the
 * decision: `read` is used only to choose between reusing a finished asset and falling back, never to decide who may generate.
 *
 * Production wiring (Phase 1.7.4): `resolveMusicLedgerStore()` returns the R2 store ONLY when MUSIC_GENERATION_LEDGER=r2 and real R2 is configured;
 * otherwise null, and live generation fails closed (falls back to the pool). Default: unset, so null.
 * `R2ConditionalLedgerStore` sends PutObject with `If-None-Match: *` (installed @aws-sdk/client-s3 3.986.0 `PutObjectRequest.IfNoneMatch`) and a
 * unique `write-id` metadata value. Cloudflare documents (r2/api/s3/conditional-operations, r2/reference/consistency, both updated 2026-11-10) that the
 * condition is evaluated atomically at commit, competing conditional writes are serialized, and losers get 412 PreconditionFailed. Verified live on
 * 2026-11-12 (Phase 1.7.4): five concurrent conditional PUTs to one fresh key -> one 200, four 412 PreconditionFailed; read-back matched the winner.
 */

import {randomUUID} from 'node:crypto';

import {GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {z} from 'zod';

import {r2LedgerClient} from '../../storage/r2.ts';

export const MUSIC_LEDGER_VERSION = 1 as const;
export const MAX_BGM_GENERATIONS_PER_VIDEO = 1 as const;

/** Only ids that map to the approved key unchanged are accepted; anything else is refused (never rewritten into a different key). */
const VIDEO_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const ledgerKeyFor = (videoId: string): string => {
  if (!VIDEO_ID.test(videoId)) throw new Error('ledger_invalid_video_id');
  return `music/ledger/${videoId}.json`;
};

/** One id per process, so a record shows which instance claimed it. Not a credential, not user data. */
const INSTANCE_ID = randomUUID();

const assetSchema = z.strictObject({
  cacheKey: z.string().min(1),
  url: z.string().min(1),
  fullUrl: z.string().optional(),
  loopUrl: z.string().optional(),
  carvedUrl: z.string().optional(),
  durationSec: z.number().optional(),
});

export const musicLedgerRecordSchema = z.strictObject({
  version: z.literal(MUSIC_LEDGER_VERSION),
  kind: z.literal('music_specialist_bgm'),
  videoId: z.string(),
  maxGenerations: z.literal(MAX_BGM_GENERATIONS_PER_VIDEO),
  state: z.enum(['claimed', 'resolved']),
  claim: z.strictObject({
    claimedAt: z.string(),
    instanceId: z.string(),
    /** Unique per claim; also sent as the object's `write-id` metadata, so an ambiguous or SDK-retried write can be reconciled (Cloudflare's procedure). */
    writeId: z.string().optional(),
    cacheKey: z.string(),
    seed: z.number(),
    promptVersion: z.number().nullable(),
    estimatedCostUsd: z.number().nullable(),
  }),
  resolution: z
    .strictObject({
      resolvedAt: z.string(),
      outcome: z.enum(['generated', 'qc_failed', 'failed', 'upload_failed']),
      reason: z.string().nullable(),
      costUsd: z.number().nullable(),
      qc: z.strictObject({passed: z.boolean().nullable(), retried: z.boolean().nullable(), vocalScore: z.number().nullable(), silenceSec: z.number().nullable(), truePeakDbfs: z.number().nullable(), bpmErrorRatio: z.number().nullable(), seamDb: z.number().nullable()}).nullable(),
      asset: assetSchema.nullable(),
    })
    .nullable(),
});
export type MusicLedgerRecord = z.infer<typeof musicLedgerRecordSchema>;
export type MusicLedgerAsset = z.infer<typeof assetSchema>;
export type MusicLedgerResolution = NonNullable<MusicLedgerRecord['resolution']>;

/** The storage contract. `createIfAbsent` MUST be a single atomic conditional create: of concurrent callers exactly one gets 'created'. */
export interface MusicLedgerStore {
  readonly name: string;
  /** True only when the store's create-if-absent has been verified against the real backend. */
  readonly atomicCreateVerified: boolean;
  createIfAbsent(key: string, body: string, writeId: string): Promise<'created' | 'exists'>;
  read(key: string): Promise<string | null>;
  /** Overwrite by the claim's owner (claimed -> resolved). Never used to decide ownership. */
  replace(key: string, body: string): Promise<void>;
}

// --- R2 (S3 API) store: conditional PutObject ---------------------------------------------------------------------------------------
/** The slice of S3Client this store needs, so tests inject a fake; production would pass the engine's S3Client. */
export type S3Like = {send(command: {input: Record<string, unknown>; constructor: {name: string}}): Promise<unknown>};
type CommandCtor = new (input: Record<string, unknown>) => {input: Record<string, unknown>; constructor: {name: string}};

const statusOf = (error: unknown): number | undefined => (error as {$metadata?: {httpStatusCode?: number}})?.$metadata?.httpStatusCode;
const nameOf = (error: unknown): string | undefined => (error as {name?: string})?.name;

export class R2ConditionalLedgerStore implements MusicLedgerStore {
  readonly name = 'r2-conditional-put';
  /** True only for the production wiring, which rests on the Phase 1.7.4 live verification and Cloudflare's documented semantics. */
  readonly atomicCreateVerified: boolean;
  readonly #client: S3Like;
  readonly #bucket: string;
  readonly #Put: CommandCtor;
  readonly #Get: CommandCtor;

  constructor(opts: {client: S3Like; bucket: string; PutObjectCommand: CommandCtor; GetObjectCommand: CommandCtor; atomicCreateVerified?: boolean}) {
    this.atomicCreateVerified = opts.atomicCreateVerified ?? false;
    this.#client = opts.client;
    this.#bucket = opts.bucket;
    this.#Put = opts.PutObjectCommand;
    this.#Get = opts.GetObjectCommand;
  }

  async createIfAbsent(key: string, body: string, writeId: string): Promise<'created' | 'exists'> {
    try {
      await this.#client.send(new this.#Put({Bucket: this.#bucket, Key: key, Body: body, ContentType: 'application/json', IfNoneMatch: '*', Metadata: {'write-id': writeId}}));
      return 'created';
    } catch (error) {
      // 412 PreconditionFailed: the key exists (R2's documented answer for every losing conditional write). claimGeneration then checks whether the
      // existing record carries THIS claim's writeId (an SDK retry of a PUT that had in fact committed). Anything else, including 409
      // (documented by R2 only as ObjectLockedByBucketPolicy), throws: the caller fails closed.
      if (statusOf(error) === 412 || nameOf(error) === 'PreconditionFailed') return 'exists';
      throw error;
    }
  }

  async read(key: string): Promise<string | null> {
    try {
      const out = (await this.#client.send(new this.#Get({Bucket: this.#bucket, Key: key}))) as {Body?: {transformToString?: () => Promise<string>}};
      return out.Body?.transformToString ? await out.Body.transformToString() : null;
    } catch (error) {
      if (statusOf(error) === 404 || nameOf(error) === 'NoSuchKey' || nameOf(error) === 'NotFound') return null;
      throw error;
    }
  }

  async replace(key: string, body: string): Promise<void> {
    await this.#client.send(new this.#Put({Bucket: this.#bucket, Key: key, Body: body, ContentType: 'application/json'}));
  }
}

/**
 * Production store. Opt-in: MUSIC_GENERATION_LEDGER=r2 AND real R2 configured (not STORAGE_BACKEND=local, which has no conditional create).
 * Anything else: null, so live generation fails closed. Enabling this does NOT enable generation: MUSIC_SPECIALIST=live (+ key, caller token) is a
 * separate gate that stays off by default.
 */
export function resolveMusicLedgerStore(env: NodeJS.ProcessEnv = process.env, r2: () => ReturnType<typeof r2LedgerClient> = r2LedgerClient): MusicLedgerStore | null {
  if ((env.MUSIC_GENERATION_LEDGER ?? '').trim().toLowerCase() !== 'r2') return null;
  const target = r2();
  if (!target) return null;
  return new R2ConditionalLedgerStore({client: target.client as unknown as S3Like, bucket: target.bucket, PutObjectCommand: PutObjectCommand as unknown as CommandCtor, GetObjectCommand: GetObjectCommand as unknown as CommandCtor, atomicCreateVerified: true});
}

// --- Ledger operations ----------------------------------------------------------------------------------------------------------------
export type LedgerView =
  | {state: 'absent'}
  | {state: 'claimed'; record: MusicLedgerRecord}
  | {state: 'resolved'; record: MusicLedgerRecord}
  | {state: 'unreadable'};

/** Read-only view, used ONLY to choose reuse vs fallback for an already-consumed video. Never a permission to generate. */
export async function viewLedger(store: MusicLedgerStore, videoId: string): Promise<LedgerView> {
  const raw = await store.read(ledgerKeyFor(videoId));
  if (raw === null) return {state: 'absent'};
  try {
    const parsed = musicLedgerRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {state: 'unreadable'};
    return parsed.data.state === 'resolved' ? {state: 'resolved', record: parsed.data} : {state: 'claimed', record: parsed.data};
  } catch {
    return {state: 'unreadable'};
  }
}

export type ClaimInput = {videoId: string; cacheKey: string; seed: number; promptVersion: number | null; estimatedCostUsd: number | null; now: string};

/**
 * The decision: one atomic create-if-absent. 'won' means this job, and only this job, may start the paid generation.
 * On 'exists' the record is read back ONLY to recognise this claim's own writeId (an SDK retry of a PUT that had committed); a different or missing
 * writeId, or an unreadable record, is a loss.
 */
export async function claimGeneration(store: MusicLedgerStore, input: ClaimInput): Promise<{outcome: 'won'; record: MusicLedgerRecord} | {outcome: 'lost'}> {
  const writeId = randomUUID();
  const record: MusicLedgerRecord = {
    version: MUSIC_LEDGER_VERSION,
    kind: 'music_specialist_bgm',
    videoId: input.videoId,
    maxGenerations: MAX_BGM_GENERATIONS_PER_VIDEO,
    state: 'claimed',
    claim: {claimedAt: input.now, instanceId: INSTANCE_ID, writeId, cacheKey: input.cacheKey, seed: input.seed, promptVersion: input.promptVersion, estimatedCostUsd: input.estimatedCostUsd},
    resolution: null,
  };
  const created = await store.createIfAbsent(ledgerKeyFor(input.videoId), `${JSON.stringify(record, null, 2)}\n`, writeId);
  if (created === 'created') return {outcome: 'won', record};
  const existing = await viewLedger(store, input.videoId).catch(() => ({state: 'unreadable'}) as LedgerView);
  if (existing.state === 'claimed' && existing.record.claim.writeId === writeId) return {outcome: 'won', record: existing.record};
  return {outcome: 'lost'};
}

/** claimed -> resolved, by the claim's owner. A failure here leaves the record `claimed`, which still consumes the video. */
export async function resolveGeneration(store: MusicLedgerStore, claimed: MusicLedgerRecord, resolution: MusicLedgerResolution): Promise<MusicLedgerRecord> {
  const record: MusicLedgerRecord = {...claimed, state: 'resolved', resolution};
  musicLedgerRecordSchema.parse(record);
  await store.replace(ledgerKeyFor(claimed.videoId), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
