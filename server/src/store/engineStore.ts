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
import {getKv} from './kv.ts';

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
  directorV2?: boolean;
  northStar?: boolean;
  requestedEdits?: string;
  forceDeliveryShaping?: boolean;
  captionTemplate?: string;
  teleprompterClean?: boolean;
  scriptKey?: string;
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
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);
}

export async function saveBlueprint(
  blueprint: TimelineBlueprint,
  fingerprint: string,
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

export async function saveCaptionsEditJob(job: CaptionsEditJob): Promise<void> {
  const kv = await getKv();
  await kv.set(
    `${EDIT_PREFIX}${job.editJobId}`,
    JSON.stringify(job),
    EDIT_JOB_TTL_SEC,
  );
}

export async function loadCaptionsEditJob(
  editJobId: string,
): Promise<CaptionsEditJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${EDIT_PREFIX}${editJobId}`);
  return raw ? (JSON.parse(raw) as CaptionsEditJob) : null;
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
