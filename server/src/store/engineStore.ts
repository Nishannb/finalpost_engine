/**
 * Typed persistence for the engine.
 *
 * The idempotency index is the most important piece of cost control here: the
 * same (videoUrl, language, filter settings) tuple returns the cached blueprint
 * instead of re-billing Groq and Gemini when a user re-opens the editor.
 */

import {createHash} from 'node:crypto';

import {env} from '../config/env.ts';
import type {
  AnalysisJob,
  CaptionsEditJob,
  RenderJob,
  TimelineBlueprint,
} from '../types/blueprint.ts';
import type {TemplateDesignJob} from '../types/templateDesign.ts';
import {graphicsStatusKey, parseStoredGraphicsStatus, type JobGraphicsStatus} from '../lib/productEditProfile.ts';
import {EngineError} from '../lib/errors.ts';
import {logger} from '../lib/logger.ts';
import {getKv} from './kv.ts';
import {getDurableJobStore, isTerminalStatus} from './durableJobs.ts';

const BLUEPRINT_PREFIX = 'engine:blueprint:';
const BLUEPRINT_INDEX_PREFIX = 'engine:blueprint-index:';
const ANALYSIS_PREFIX = 'engine:analysis:';
const RENDER_PREFIX = 'engine:render:';
const EDIT_PREFIX = 'engine:edit:';
const DESIGN_PREFIX = 'engine:template-design:';
const DESIGN_USER_PREFIX = 'engine:template-design-user:';
const QUOTA_PREFIX = 'engine:quota:';
const RATE_PREFIX = 'engine:rate:';

const RENDER_JOB_TTL_SEC = 60 * 60 * 24;
const ANALYSIS_JOB_TTL_SEC = 60 * 60 * 6;
const EDIT_JOB_TTL_SEC = 60 * 60 * 24;
const DESIGN_JOB_TTL_SEC = 60 * 60 * 24 * 30;

export function fingerprintSource(input: {
  videoUrl: string;
  languageCode: string;
  colorGradeLut?: string;
  styleRecipeKey?: string;
  userBrollKey?: string;
  captionStyleKey?: string;
  forceSpeakerCutout?: boolean;
  /** Non-empty only when the client provided a transparent cutout URL, so keys made without one are unchanged (a blueprint built around a provided cutout must never be served to a request without it). */
  subjectCutoutKey?: string;
  directorV2?: boolean;
  northStar?: boolean;
  requestedEdits?: string;
  forceDeliveryShaping?: boolean;
  captionTemplate?: string;
  teleprompterClean?: boolean;
  scriptKey?: string;
  /** WP1: non-empty only for a non-legacy product edit profile, so legacy cache keys are unchanged. */
  editProfileKey?: string;
  /** WP3Z: non-empty only when the request's graphics decision is `on` or `skipped_budget` (lib/productEditProfile.ts), so keys made while graphics were off are unchanged. */
  graphicsKey?: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.videoUrl,
        input.languageCode,
        // Filter settings change the blueprint, so they belong in the key.
        env.SILENCE_THRESHOLD_SEC,
        env.SILENCE_PADDING_SEC,
        env.ZOOM_SCALE,
        env.ZOOM_MAX_DURATION_SEC,
        env.BROLL_ENABLED ? `${env.BROLL_MOMENT_COUNT}:visual-v19-captions-first` : 'no-broll',
        env.HOOK_DURATION_SEC,
        env.GROQ_MODEL,
        (input.colorGradeLut ?? '').trim().toLowerCase(),
        (input.styleRecipeKey ?? '').trim(),
        (input.userBrollKey ?? '').trim(),
        (input.captionStyleKey ?? '').trim(),
        input.forceSpeakerCutout || env.FORCE_SPEAKER_CUTOUT ? 'cutout' : '',
        input.directorV2 || env.DIRECTOR_V2 ? 'director-v2' : '',
        input.northStar || env.NORTH_STAR ? 'north-star' : '',
        ...(input.subjectCutoutKey ? [`cutout:${input.subjectCutoutKey}`] : []),
        (input.requestedEdits ?? '').trim(),
        input.forceDeliveryShaping === true
          ? 'delivery-on'
          : input.forceDeliveryShaping === false
            ? 'delivery-off'
            : '',
        env.DELIVERY_SHAPING_AUTO ? 'delivery-auto' : '',
        env.DELIVERY_LLM_EMPHASIS ? 'delivery-llm' : '',
        (input.captionTemplate ?? '').trim().toLowerCase(),
        input.teleprompterClean ? 'tp-clean-v2' : '',
        (input.scriptKey ?? '').trim(),
        ...(input.editProfileKey ? [input.editProfileKey] : []),
        ...(input.graphicsKey ? [input.graphicsKey] : []),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);
}

export async function saveBlueprint(
  blueprint: TimelineBlueprint,
  fingerprint: string,
  /** WP3Y: the graphics decision of the run that made this blueprint, kept beside it so a cache hit can report it. Omitted = nothing stored (the field stays absent on a hit). */
  meta: {graphics?: JobGraphicsStatus} = {},
): Promise<void> {
  const kv = await getKv();
  const ttl = env.BLUEPRINT_TTL_SEC;
  await kv.set(
    `${BLUEPRINT_PREFIX}${blueprint.blueprintId}`,
    JSON.stringify(blueprint),
    ttl,
  );
  await kv.set(
    `${BLUEPRINT_INDEX_PREFIX}${fingerprint}`,
    blueprint.blueprintId,
    ttl,
  );
  if (meta.graphics) {
    await kv.set(graphicsStatusKey(blueprint.blueprintId), meta.graphics, ttl);
  }
}

/** WP3Y: the stored graphics decision for a blueprint, or `undefined` for an entry saved without one. */
export async function loadBlueprintGraphicsStatus(blueprintId: string): Promise<JobGraphicsStatus | undefined> {
  const kv = await getKv();
  return parseStoredGraphicsStatus(await kv.get(graphicsStatusKey(blueprintId)));
}

export async function loadBlueprint(
  blueprintId: string,
): Promise<TimelineBlueprint | null> {
  const kv = await getKv();
  const raw = await kv.get(`${BLUEPRINT_PREFIX}${blueprintId}`);
  return raw ? (JSON.parse(raw) as TimelineBlueprint) : null;
}

export async function loadBlueprintByFingerprint(
  fingerprint: string,
): Promise<TimelineBlueprint | null> {
  const kv = await getKv();
  const id = await kv.get(`${BLUEPRINT_INDEX_PREFIX}${fingerprint}`);
  return id ? loadBlueprint(id) : null;
}

export async function saveAnalysisJob(job: AnalysisJob): Promise<void> {
  const kv = await getKv();
  await kv.set(
    `${ANALYSIS_PREFIX}${job.analysisJobId}`,
    JSON.stringify(job),
    ANALYSIS_JOB_TTL_SEC,
  );
}

export async function loadAnalysisJob(
  analysisJobId: string,
): Promise<AnalysisJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${ANALYSIS_PREFIX}${analysisJobId}`);
  return raw ? (JSON.parse(raw) as AnalysisJob) : null;
}

export async function saveRenderJob(job: RenderJob): Promise<void> {
  const kv = await getKv();
  await kv.set(
    `${RENDER_PREFIX}${job.renderJobId}`,
    JSON.stringify(job),
    RENDER_JOB_TTL_SEC,
  );
}

export async function loadRenderJob(
  renderJobId: string,
): Promise<RenderJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${RENDER_PREFIX}${renderJobId}`);
  return raw ? (JSON.parse(raw) as RenderJob) : null;
}

/**
 * Captions jobs live in KV only (24h), exactly as before. `full_edit` jobs are ALSO written to the durable
 * table (store/durableJobs.ts) on every save: KV is the fast path, the table is the source of truth, so a
 * restart or an expired KV entry never loses the job.
 */
export async function saveCaptionsEditJob(
  job: CaptionsEditJob,
  options: {allowReopen?: boolean} = {},
): Promise<void> {
  const kv = await getKv();
  if (job.mode === 'full_edit' && !options.allowReopen) {
    // A finished job (done / failed) never moves again unless the creator retries it: a stale or duplicate
    // worker must not flip a terminal job back to rendering, or finish it twice.
    const currentRaw = await kv.get(`${EDIT_PREFIX}${job.editJobId}`);
    const current = currentRaw ? (JSON.parse(currentRaw) as CaptionsEditJob) : null;
    if (current && isTerminalStatus(current.status) && current.status !== job.status) {
      logger.warn({editJobId: job.editJobId, from: current.status, to: job.status}, 'ignored transition out of a terminal job state');
      return;
    }
  }
  await kv.set(
    `${EDIT_PREFIX}${job.editJobId}`,
    JSON.stringify(job),
    EDIT_JOB_TTL_SEC,
  );
  if (job.mode === 'full_edit') {
    const durable = getDurableJobStore();
    if (durable) {
      try {
        await durable.upsert(job);
      } catch (error) {
        // KV still has the job; the next save retries the write. Never fail an edit step over a bookkeeping write.
        logger.error({editJobId: job.editJobId, error}, 'durable job write failed');
      }
    }
  }
}

export async function loadCaptionsEditJob(
  editJobId: string,
): Promise<CaptionsEditJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${EDIT_PREFIX}${editJobId}`);
  if (raw) {
    return JSON.parse(raw) as CaptionsEditJob;
  }
  // KV miss: expired (24h), evicted or the engine restarted. A full edit is still in the durable table.
  const durable = getDurableJobStore();
  if (!durable) {
    return null;
  }
  try {
    const stored = await durable.get(editJobId);
    if (!stored) {
      return null;
    }
    await kv.set(`${EDIT_PREFIX}${editJobId}`, JSON.stringify(stored.job), EDIT_JOB_TTL_SEC);
    return stored.job;
  } catch (error) {
    logger.error({editJobId, error}, 'durable job read failed');
    return null;
  }
}

const BLUEPRINT_ACCESS_PREFIX = 'engine:bp-access:';
const BLUEPRINT_GATE_PREFIX = 'engine:bp-gated:';

/**
 * A blueprint holds a creator's transcript and media urls. Its id is random (80 bits) but an id alone must not
 * be enough: the creator who made (or cache-hit) a plan is recorded, and the read / bind / render paths check it.
 * A blueprint with no record (made before this existed) stays reachable, exactly as before.
 */
export async function grantBlueprintAccess(blueprintId: string, userId: string): Promise<void> {
  if (!blueprintId || !userId) {
    return;
  }
  const kv = await getKv();
  const ttl = env.BLUEPRINT_TTL_SEC;
  await kv.set(`${BLUEPRINT_GATE_PREFIX}${blueprintId}`, '1', ttl);
  await kv.set(`${BLUEPRINT_ACCESS_PREFIX}${blueprintId}:${userId}`, '1', ttl);
}

/** Throws `not_found` (never "forbidden", so ids are not probeable) when the plan belongs to someone else. */
export async function assertBlueprintAccess(blueprintId: string, userId: string): Promise<void> {
  const kv = await getKv();
  if (!(await kv.get(`${BLUEPRINT_GATE_PREFIX}${blueprintId}`))) {
    return;
  }
  if (!(await kv.get(`${BLUEPRINT_ACCESS_PREFIX}${blueprintId}:${userId}`))) {
    throw new EngineError('not_found', 'Blueprint not found or expired');
  }
}

/** Keep a copy of the edit plan next to the job so `awaiting_assets` survives the KV blueprint expiring. */
export async function saveDurableBlueprint(job: CaptionsEditJob, blueprint: unknown): Promise<void> {
  const durable = getDurableJobStore();
  if (!durable) {
    return;
  }
  try {
    await durable.upsert(job, blueprint);
  } catch (error) {
    logger.error({editJobId: job.editJobId, error}, 'durable blueprint write failed');
  }
}

/** The plan snapshot saved with a job, if any. */
export async function loadDurableBlueprint(editJobId: string): Promise<unknown | null> {
  const durable = getDurableJobStore();
  if (!durable) {
    return null;
  }
  try {
    return (await durable.get(editJobId))?.blueprint ?? null;
  } catch {
    return null;
  }
}

export async function saveTemplateDesignJob(job: TemplateDesignJob): Promise<void> {
  const kv = await getKv();
  await kv.set(
    `${DESIGN_PREFIX}${job.designJobId}`,
    JSON.stringify(job),
    DESIGN_JOB_TTL_SEC,
  );
  const indexKey = `${DESIGN_USER_PREFIX}${job.userId}`;
  const existingRaw = await kv.get(indexKey);
  const ids = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
  const next = [job.designJobId, ...ids.filter(id => id !== job.designJobId)].slice(
    0,
    40,
  );
  await kv.set(indexKey, JSON.stringify(next), DESIGN_JOB_TTL_SEC);
}

export async function loadTemplateDesignJob(
  designJobId: string,
): Promise<TemplateDesignJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${DESIGN_PREFIX}${designJobId}`);
  return raw ? (JSON.parse(raw) as TemplateDesignJob) : null;
}

export async function listTemplateDesignJobs(
  userId: string,
): Promise<TemplateDesignJob[]> {
  const kv = await getKv();
  const raw = await kv.get(`${DESIGN_USER_PREFIX}${userId}`);
  const ids = raw ? (JSON.parse(raw) as string[]) : [];
  const jobs: TemplateDesignJob[] = [];
  for (const id of ids) {
    const job = await loadTemplateDesignJob(id);
    if (job) {
      jobs.push(job);
    }
  }
  return jobs;
}

/** Calendar-month bucket, so quotas reset without a cron job. */
function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_TTL_SEC = 60 * 60 * 24 * 40;

export async function incrementMonthlyUsage(
  userId: string,
  metric: 'analyses' | 'renderSeconds',
  amount: number,
): Promise<number> {
  const kv = await getKv();
  return kv.increment(
    `${QUOTA_PREFIX}${monthKey()}:${metric}:${userId}`,
    amount,
    MONTH_TTL_SEC,
  );
}

export async function readMonthlyUsage(
  userId: string,
  metric: 'analyses' | 'renderSeconds',
): Promise<number> {
  const kv = await getKv();
  const raw = await kv.get(`${QUOTA_PREFIX}${monthKey()}:${metric}:${userId}`);
  return Number(raw ?? 0);
}

/** Fixed-window counter; good enough to stop a runaway retry loop. */
export async function hitRateLimit(
  bucket: string,
  windowSec: number,
): Promise<number> {
  const kv = await getKv();
  const window = Math.floor(Date.now() / 1000 / windowSec);
  return kv.increment(`${RATE_PREFIX}${bucket}:${window}`, 1, windowSec + 1);
}
