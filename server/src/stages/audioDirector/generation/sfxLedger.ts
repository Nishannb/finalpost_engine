/**
 * Phase SFX-2: the AudioDirector's per-video SFX generation record. Policy: ONE SFX generation round per edited video, ever. The round is the set of
 * requests that were not served from the content cache; it is claimed (exclusive create, fsync) BEFORE the first SFX provider request and never
 * reset. Any record, in any state, consumes the video's SFX round: a changed prompt, event set or request id cannot buy a second round, and a failed,
 * timed-out or interrupted round stays consumed. Cache hits are not generations and never need or consume the ledger.
 *
 * Same storage semantics and limits as the BGM ledger (bgmLedger.ts, which is unchanged and separate): local filesystem only; at most one round per
 * video per ledger directory across concurrent jobs and processes on one machine; not exactly-once (a crash after the claim consumes the round).
 * Production storage (R2) is NOT wired here.
 */

import {createHash} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync} from 'node:fs';
import path from 'node:path';

import {z} from 'zod';

export const SFX_LEDGER_VERSION = 1 as const;
export const MAX_SFX_ROUNDS_PER_VIDEO = 1 as const;

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');

const claimedRequestSchema = z.strictObject({requestId: z.string().min(1), eventId: z.string().min(1), cacheKey: z.string().min(1), taskUUID: z.string().min(1)});
const outcomeSchema = z.strictObject({requestId: z.string().min(1), status: z.enum(['downloaded', 'failed']), costUsd: z.number().nullable(), failureCode: z.string().nullable()});

export const sfxLedgerRecordSchema = z.strictObject({
  version: z.literal(SFX_LEDGER_VERSION),
  kind: z.literal('sfx_generation'),
  videoId: z.string().min(1),
  maxRounds: z.literal(MAX_SFX_ROUNDS_PER_VIDEO),
  state: z.enum(['claimed', 'resolved']),
  claim: z.strictObject({claimedAt: z.string().nullable(), requests: z.array(claimedRequestSchema).min(1)}),
  resolution: z.strictObject({resolvedAt: z.string().nullable(), outcomes: z.array(outcomeSchema)}).nullable(),
});
export type SfxLedgerRecord = z.infer<typeof sfxLedgerRecordSchema>;

export type SfxLedgerOptions = {dir: string; videoId: string};
export type SfxLedgerState = {state: 'available'} | {state: 'consumed'; record: SfxLedgerRecord | null; detail: string};

export function sfxLedgerPathFor(dir: string, videoId: string): string {
  const readable = videoId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(dir, `sfx-${readable}-${sha256Hex(videoId).slice(0, 16)}.json`);
}

export function sfxGenerationState(opts: SfxLedgerOptions): SfxLedgerState {
  const file = sfxLedgerPathFor(opts.dir, opts.videoId);
  if (!existsSync(file)) return {state: 'available'};
  try {
    const parsed = sfxLedgerRecordSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? {state: 'consumed', record: parsed.data, detail: parsed.data.state} : {state: 'consumed', record: null, detail: 'ledger file does not match the schema'};
  } catch (error) {
    return {state: 'consumed', record: null, detail: error instanceof Error ? error.name : 'unreadable'};
  }
}

function writeDurably(fd: number, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
}

/** Claim the video's one SFX round for `requests` (the cache misses). The exclusive create is the decision. */
export function claimSfxGeneration(opts: SfxLedgerOptions, requests: z.input<typeof claimedRequestSchema>[], claimedAt: string | null): {ok: true; record: SfxLedgerRecord} | {ok: false; state: SfxLedgerState} {
  const before = sfxGenerationState(opts);
  if (before.state === 'consumed') return {ok: false, state: before};
  mkdirSync(opts.dir, {recursive: true});
  const record: SfxLedgerRecord = {
    version: SFX_LEDGER_VERSION,
    kind: 'sfx_generation',
    videoId: opts.videoId,
    maxRounds: MAX_SFX_ROUNDS_PER_VIDEO,
    state: 'claimed',
    claim: {claimedAt, requests: requests.map(request => claimedRequestSchema.parse(request))},
    resolution: null,
  };
  let fd: number;
  try {
    fd = openSync(sfxLedgerPathFor(opts.dir, opts.videoId), 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return {ok: false, state: sfxGenerationState(opts)};
    throw error;
  }
  try {
    writeDurably(fd, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return {ok: true, record};
}

/** claimed -> resolved (atomic rename). A failure here leaves the claim in force. */
export function resolveSfxGeneration(opts: SfxLedgerOptions, outcomes: z.input<typeof outcomeSchema>[], resolvedAt: string | null): SfxLedgerRecord {
  const file = sfxLedgerPathFor(opts.dir, opts.videoId);
  const record = sfxLedgerRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (record.state !== 'claimed') throw new Error(`sfx ledger for ${opts.videoId} is already resolved`);
  const next: SfxLedgerRecord = {...record, state: 'resolved', resolution: {resolvedAt, outcomes: outcomes.map(outcome => outcomeSchema.parse(outcome))}};
  const temp = `${file}.${process.pid}.tmp`;
  const fd = openSync(temp, 'wx');
  try {
    writeDurably(fd, `${JSON.stringify(next, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  return next;
}
