/**
 * Persistence for RVM matting jobs. Same KV as every other engine job (store/kv.ts: Redis when REDIS_URL
 * is set, memory otherwise); a separate file so engineStore.ts stays untouched.
 *
 * Keys:  engine:matte:job:<jobId>            the job record
 *        engine:matte:index:<fingerprint>    -> jobId (idempotency; the fingerprint includes the user)
 */

import {createHash} from 'node:crypto';

import {getKv} from './kv.ts';

const JOB_PREFIX = 'engine:matte:job:';
const INDEX_PREFIX = 'engine:matte:index:';
export const MATTING_JOB_TTL_SEC = 60 * 60 * 24;

export type MattingStatus = 'queued' | 'running' | 'done' | 'failed';
export type MattingQuality = 'high' | 'fast';
export type MattingOutputFormat = 'transparent';

export type MattingResult = {
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
  device: string;
  elapsedMs: number;
  /** The WebM carries no audio track; audio stays on the source asset. */
  silent: true;
};

export type MattingJob = {
  jobId: string;
  userId: string;
  /** Source URL with query string and fragment removed (a signed URL must not be persisted or echoed). */
  sourceUrl: string;
  quality: MattingQuality;
  outputFormat: MattingOutputFormat;
  status: MattingStatus;
  /** 0..1 */
  progress: number;
  /** Coarse phase while running: downloading | probing | matting | uploading. */
  stage?: string;
  createdAt: string;
  updatedAt: string;
  outputUrl?: string;
  result?: MattingResult;
  errorCode?: string;
  errorMessage?: string;
};

export function mattingFingerprint(input: {
  userId: string;
  videoUrl: string;
  quality: string;
  outputFormat: string;
}): string {
  return createHash('sha256')
    .update([input.userId, input.videoUrl, input.quality, input.outputFormat].join('|'))
    .digest('hex')
    .slice(0, 32);
}

export async function saveMattingJob(job: MattingJob): Promise<void> {
  const kv = await getKv();
  await kv.set(`${JOB_PREFIX}${job.jobId}`, JSON.stringify(job), MATTING_JOB_TTL_SEC);
}

export async function loadMattingJob(jobId: string): Promise<MattingJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${JOB_PREFIX}${jobId}`);
  return raw ? (JSON.parse(raw) as MattingJob) : null;
}

export async function indexMattingJob(fingerprint: string, jobId: string): Promise<void> {
  const kv = await getKv();
  await kv.set(`${INDEX_PREFIX}${fingerprint}`, jobId, MATTING_JOB_TTL_SEC);
}

export async function findMattingJobByFingerprint(fingerprint: string): Promise<MattingJob | null> {
  const kv = await getKv();
  const id = await kv.get(`${INDEX_PREFIX}${fingerprint}`);
  return id ? loadMattingJob(id) : null;
}
