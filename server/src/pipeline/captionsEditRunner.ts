/**
 * Captions-only mobile job: wait for the phone's background R2 PUT, then
 * analyze + burn without requiring the app to stay in the foreground.
 */

import {randomUUID} from 'node:crypto';

import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {notifyCreatorEditDone, type EditNotificationType} from '../http/notifyCreator.ts';
import {randomUUID as workerUuid} from 'node:crypto';

import {env} from '../config/env.ts';
import {checkFullEditForWorker} from '../lib/entitlement.ts';
import {styleTier, type EditStyleId} from '../lib/editStyles.ts';
import {
  loadAnalysisJob,
  loadBlueprint,
  loadCaptionsEditJob,
  grantBlueprintAccess,
  loadDurableBlueprint,
  saveBlueprint,
  saveCaptionsEditJob,
  saveDurableBlueprint,
} from '../store/engineStore.ts';
import {getDurableJobStore} from '../store/durableJobs.ts';
import {getKv} from '../store/kv.ts';
import {
  applyLabeledAssetBindings,
  buildLabeledAssetBrief,
  computeEditReadiness,
  type LabeledAssetBinding,
} from '../stages/broll/labeledAssetBrief.ts';
import {presignSourceVideo, sourceObjectExists} from '../storage/r2.ts';
import type {
  CaptionTemplateId,
  CaptionsEditJob,
  LanguageCode,
} from '../types/blueprint.ts';
import {burnCaptionKitVideo} from './captionKitBurn.ts';
import {startAnalysis} from './analysisRunner.ts';
import {
  loadRenderJob,
  refreshRenderJob,
  startRender,
} from './renderRunner.ts';

const log = stageLogger('captions-edit');

const running = new Set<string>();
const sourceReady = new Set<string>();
const HEAD_POLL_MS = 2500;
const HEAD_TIMEOUT_MS = 20 * 60 * 1000;
const STAGE_POLL_MS = 2000;
const STAGE_TIMEOUT_MS = 12 * 60 * 1000;

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export async function createCaptionsEditJob(input: {
  userId: string;
  contentType: string;
  extension?: string;
  languageCode: LanguageCode;
  captionTemplate: CaptionTemplateId;
  captionPreset?: string;
  captionStyleGuide?: Record<string, unknown> | null;
  mode?: 'captions' | 'teleprompter_clean' | 'basic_captions' | 'full_edit';
  scriptText?: string;
  /** `full_edit` only: options the durable job keeps so a restarted engine can resume it. */
  fullEdit?: CaptionsEditJob['fullEdit'];
  /** The picked edit style (the route already derived `mode` from it) and what is known at request time about honouring it (the analysis updates it). */
  style?: EditStyleId;
  degraded?: boolean;
  degradedReasons?: string[];
}): Promise<{job: CaptionsEditJob; uploadUrl: string}> {
  if (input.mode === 'full_edit' && env.NODE_ENV === 'production' && !getDurableJobStore()) {
    // A full edit can wait days for the creator's assets: refuse to start one that would only live in KV (24h).
    throw new EngineError('not_configured', 'Durable edit storage is not configured.');
  }
  const presigned = await presignSourceVideo({
    contentType: input.contentType,
    extension: input.extension,
  });
  const now = new Date().toISOString();
  const mode =
    input.mode === 'teleprompter_clean' ||
    input.mode === 'basic_captions' ||
    input.mode === 'full_edit'
      ? input.mode
      : 'captions';
  const job: CaptionsEditJob = {
    editJobId: `ed_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    status: 'awaiting_upload',
    progress: 0.02,
    sourceKey: presigned.key,
    sourcePublicUrl: presigned.publicUrl,
    languageCode: input.languageCode,
    captionTemplate: input.captionTemplate,
    captionPreset: input.captionPreset?.trim() || undefined,
    captionStyleGuide: input.captionStyleGuide || undefined,
    mode,
    scriptText:
      mode === 'teleprompter_clean'
        ? (input.scriptText || '').trim().slice(0, 20_000) || undefined
        : undefined,
    ...(mode === 'full_edit' && input.fullEdit ? {fullEdit: input.fullEdit} : {}),
    ...(input.style ? {style: input.style} : {}),
    ...(input.style ? {degraded: Boolean(input.degraded), degradedReasons: input.degradedReasons ?? []} : {}),
    createdAt: now,
    updatedAt: now,
  };
  await saveCaptionsEditJob(job);
  void waitForSourceThenRun(job.editJobId);
  return {job, uploadUrl: presigned.uploadUrl};
}

export async function markCaptionsSourceUploaded(
  editJobId: string,
  userId: string,
): Promise<CaptionsEditJob> {
  const job = await loadCaptionsEditJob(editJobId);
  if (!job || job.userId !== userId) {
    throw new EngineError('not_found', 'Edit job not found');
  }
  sourceReady.add(job.editJobId);
  void waitForSourceThenRun(job.editJobId);
  return (await loadCaptionsEditJob(editJobId)) ?? job;
}

async function waitForSourceThenRun(editJobId: string): Promise<void> {
  if (running.has(editJobId)) {
    return;
  }
  running.add(editJobId);
  try {
    let job = await loadCaptionsEditJob(editJobId);
    if (!job) {
      return;
    }
    if (job.status === 'done' || job.status === 'failed') {
      return;
    }

    if (job.status === 'awaiting_upload') {
      const deadline = Date.now() + HEAD_TIMEOUT_MS;
      let present = sourceReady.has(editJobId);
      while (!present) {
        present = sourceReady.has(editJobId) || (await sourceObjectExists(job.sourceKey));
        if (present) {
          break;
        }
        if (Date.now() > deadline) {
          await failJob(job, 'timeout', 'Video upload timed out. Try again.');
          return;
        }
        await sleep(HEAD_POLL_MS);
        const refreshed = await loadCaptionsEditJob(editJobId);
        if (!refreshed || refreshed.status !== 'awaiting_upload') {
          job = refreshed ?? job;
          break;
        }
      }
    }

    job = (await loadCaptionsEditJob(editJobId)) ?? job;
    if (job.status === 'done' || job.status === 'failed') {
      return;
    }
    // Re-read under the lease: a second poller (another instance, or the recovery worker) may have started this job
    // while this one was waiting for the upload, and a stale copy must never start a second analysis.
    if (job.status === 'awaiting_upload') {
      await leased(job.editJobId, job.mode, async () => {
        const fresh = await loadCaptionsEditJob(editJobId);
        if (fresh && fresh.status === 'awaiting_upload') {
          await runCaptionsPipeline(fresh);
        }
      });
    } else if (job.status === 'analyzing' || job.status === 'rendering') {
      await leased(job.editJobId, job.mode, async () => {
        const fresh = await loadCaptionsEditJob(editJobId);
        if (fresh && (fresh.status === 'analyzing' || fresh.status === 'rendering')) {
          await resumeCaptionsPipeline(fresh);
        }
      });
    }
  } catch (error) {
    const engineError = toEngineError(error);
    log.error({editJobId, error}, 'captions edit failed');
    const job = await loadCaptionsEditJob(editJobId);
    if (job && job.status !== 'done') {
      await failJob(
        job,
        engineError.code,
        isEngineError(error)
          ? engineError.message
          : 'Could not add captions. Try again.',
      );
    }
  } finally {
    running.delete(editJobId);
  }
}

async function runCaptionsPipeline(job: CaptionsEditJob): Promise<void> {
  if (job.mode === 'full_edit') {
    await runFullEditPipeline(job);
    return;
  }
  // A Pro style is re-checked right before work starts, whatever mode it maps to (full_edit re-checks in its own pipeline).
  if (styleTier(job.style) === 'pro' && !(await entitledToProceed(job))) {
    return;
  }
  job.status = 'analyzing';
  job.progress = 0.08;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  const teleprompterClean = job.mode === 'teleprompter_clean';
  const analysis = await startAnalysis({
    userId: job.userId,
    videoUrl: job.sourcePublicUrl,
    languageCode: job.languageCode,
    useCache: !job.captionStyleGuide && !teleprompterClean,
    // Free lean path: the analysis layer, not PRODUCT_EDIT_PROFILE, decides what runs.
    basicCaptions: job.mode === 'basic_captions',
    requestedEdits: ['captions'],
    captionTemplate: job.captionTemplate,
    captionPreset: job.captionPreset,
    captionStyleGuide: job.captionStyleGuide || null,
    teleprompterClean,
    scriptText: job.scriptText,
    ...(job.style ? {style: job.style} : {}), // startAnalysis resolves its flags (lib/styleRun.ts)
  });
  job.analysisJobId = analysis.analysisJobId;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  const analysisDone = await waitForAnalysis(job);
  if (!analysisDone?.blueprint) {
    return;
  }

  job.status = 'rendering';
  job.progress = 0.55;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  if (job.captionPreset && !teleprompterClean) {
    await burnCaptionsWithCaptionKit(job, analysisDone.blueprint.captionWords, analysisDone.blueprint.outputDurationSec);
    return;
  }

  const render = await startRender({
    userId: job.userId,
    blueprintId: analysisDone.blueprint.blueprintId,
    style: {
      captionTemplate: job.captionTemplate,
      layoutStyle: 'fullscreen',
      captionBottomFrac: analysisDone.blueprint.captionDirection?.bottomFrac ?? 0.22,
      captionCenterXFrac: 0.5,
      brollEnabled: false,
      zoomEnabled: false,
      // Teleprompter clean must honor keepSegments (silence + retakes).
      trimEnabled: teleprompterClean,
      colorGradeLut: '',
    },
  });
  job.renderJobId = render.renderJobId;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  await waitForRenderJob(job);
}

async function resumeCaptionsPipeline(job: CaptionsEditJob): Promise<void> {
  if (job.mode === 'full_edit') {
    await resumeFullEditPipeline(job);
    return;
  }
  const teleprompterClean = job.mode === 'teleprompter_clean';
  if (job.status === 'analyzing') {
    const analysisDone = await waitForAnalysis(job);
    if (!analysisDone?.blueprint) {
      return;
    }
    if (!job.renderJobId) {
      job.status = 'rendering';
      job.progress = 0.55;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
      if (job.captionPreset && !teleprompterClean) {
        await burnCaptionsWithCaptionKit(
          job,
          analysisDone.blueprint.captionWords,
          analysisDone.blueprint.outputDurationSec,
        );
        return;
      }
      const render = await startRender({
        userId: job.userId,
        blueprintId: analysisDone.blueprint.blueprintId,
        style: {
          captionTemplate: job.captionTemplate,
          layoutStyle: 'fullscreen',
          captionBottomFrac:
            analysisDone.blueprint.captionDirection?.bottomFrac ?? 0.22,
          captionCenterXFrac: 0.5,
          brollEnabled: false,
          zoomEnabled: false,
          trimEnabled: teleprompterClean,
          colorGradeLut: '',
        },
      });
      job.renderJobId = render.renderJobId;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
    }
  }
  if (job.captionPreset && !teleprompterClean && !job.renderJobId && job.analysisJobId) {
    const analysisDone = await waitForAnalysis(job);
    if (!analysisDone?.blueprint || job.status === 'failed') {
      return;
    }
    if (job.status !== 'done') {
      job.status = 'rendering';
      job.progress = 0.55;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
      await burnCaptionsWithCaptionKit(
        job,
        analysisDone.blueprint.captionWords,
        analysisDone.blueprint.outputDurationSec,
      );
    }
    return;
  }
  if (job.renderJobId) {
    await waitForRenderJob(job);
  }
}

async function burnCaptionsWithCaptionKit(
  job: CaptionsEditJob,
  words: import('../types/blueprint.ts').CaptionWord[],
  outputDurationSec?: number,
): Promise<void> {
  const presetId = (job.captionPreset || '').trim();
  if (!presetId) {
    await failJob(job, 'bad_request', 'Caption style is missing.');
    return;
  }
  try {
    const burned = await burnCaptionKitVideo({
      videoUrl: job.sourcePublicUrl,
      editJobId: job.editJobId,
      presetId,
      words,
    });
    job.status = 'done';
    job.progress = 1;
    job.outputUrl = burned.outputUrl;
    job.outputDurationSec = outputDurationSec;
    job.updatedAt = new Date().toISOString();
    await saveCaptionsEditJob(job);
    await notifyCreatorEditDone({
      userId: job.userId,
      editJobId: job.editJobId,
      status: 'done',
      outputUrl: burned.outputUrl,
    });
  } catch (error) {
    const engineError = toEngineError(error);
    await failJob(
      job,
      engineError.code || 'render_failed',
      isEngineError(error)
        ? engineError.message
        : 'Could not burn captions. Try again.',
    );
  }
}

async function waitForAnalysis(
  job: CaptionsEditJob,
): Promise<Awaited<ReturnType<typeof loadAnalysisJob>>> {
  if (!job.analysisJobId) {
    await failJob(job, 'analysis_failed', 'Analysis did not start.');
    return null;
  }
  const deadline = Date.now() + STAGE_TIMEOUT_MS;
  for (;;) {
    const analysis = await loadAnalysisJob(job.analysisJobId);
    if (analysis?.status === 'done' && analysis.blueprint) {
      // Edit styles: the analysis says what it really produced (a re-analysis after the asset gate replaces the earlier answer).
      if (job.style && analysis.style && typeof analysis.degraded === 'boolean') {
        job.degraded = analysis.degraded;
        job.degradedReasons = analysis.degradedReasons ?? [];
        job.styleNotes = analysis.styleNotes ?? [];
      }
      job.progress = 0.52;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
      return analysis;
    }
    if (analysis?.status === 'failed') {
      await failJob(
        job,
        analysis.errorCode || 'analysis_failed',
        analysis.errorMessage || 'Could not add captions. Try again.',
      );
      return null;
    }
    if (Date.now() > deadline) {
      await failJob(job, 'timeout', 'Caption analysis timed out. Try again.');
      return null;
    }
    if (analysis) {
      job.progress = 0.08 + analysis.progress * 0.42;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
    }
    await sleep(STAGE_POLL_MS);
  }
}

async function waitForRenderJob(job: CaptionsEditJob): Promise<void> {
  if (!job.renderJobId) {
    await failJob(job, 'render_failed', 'Render did not start.');
    return;
  }
  const deadline = Date.now() + STAGE_TIMEOUT_MS;
  for (;;) {
    let render = await loadRenderJob(job.renderJobId);
    if (!render) {
      await failJob(job, 'render_failed', 'Render job was lost.');
      return;
    }
    render = await refreshRenderJob(render);
    if (render.status === 'done' && render.outputUrl) {
      job.status = 'done';
      job.progress = 1;
      job.outputUrl = render.outputUrl;
      job.outputDurationSec = render.outputDurationSec;
      job.updatedAt = new Date().toISOString();
      await saveCaptionsEditJob(job);
      await notifyEnd(job, 'done', {outputUrl: render.outputUrl});
      return;
    }
    if (render.status === 'failed') {
      await failJob(
        job,
        render.errorCode || 'render_failed',
        render.errorMessage || 'Could not render captions. Try again.',
      );
      return;
    }
    if (Date.now() > deadline) {
      await failJob(job, 'timeout', 'Caption render timed out. Try again.');
      return;
    }
    job.progress = 0.55 + render.progress * 0.4;
    job.updatedAt = new Date().toISOString();
    await saveCaptionsEditJob(job);
    await sleep(STAGE_POLL_MS);
  }
}

async function failJob(
  job: CaptionsEditJob,
  code: string,
  message: string,
): Promise<void> {
  job.status = 'failed';
  job.errorCode = code;
  job.errorMessage = message;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);
  await notifyEnd(job, 'failed', {errorMessage: message});
}


// ---------------------------------------------------------------------------
// Durable Pro / Pro Plus full edit (mode `full_edit`).
//
// awaiting_upload → analyzing → (awaiting_assets) → rendering → done | failed
//
// Every transition is persisted on the job (the KV store), never held only in a Promise: an app that
// is closed, killed or offline can come back, GET the job and resume. The labeled-asset gate is
// server-owned: analysis stops at `awaiting_assets`, one `assets_needed` push goes out, and rendering
// resumes only when the creator submits (or skips) the slots through submitFullEditAssets.
// ---------------------------------------------------------------------------

const fullEditActive = new Set<string>();

/** The push for the end of a job. Captions jobs keep the original `edit_done` message; full edits add types and dedupe. */
async function notifyEnd(
  job: CaptionsEditJob,
  status: 'done' | 'failed',
  extra: {outputUrl?: string; errorMessage?: string},
): Promise<void> {
  if (job.mode !== 'full_edit') {
    await notifyCreatorEditDone({
      userId: job.userId,
      editJobId: job.editJobId,
      status,
      ...extra,
    });
    return;
  }
  await notifyOnce(job, status === 'done' ? 'edit_done' : 'edit_failed', status, extra);
}

const notifyClaimKey = (editJobId: string, type: string) => `engine:notified:${editJobId}:${type}`;

/** Full edits send each notification type at most once per job (a resumed or retried step never re-sends). */
async function notifyOnce(
  job: CaptionsEditJob,
  type: EditNotificationType,
  status: 'done' | 'failed' | 'awaiting_assets',
  extra: {outputUrl?: string; errorMessage?: string} = {},
): Promise<void> {
  const fresh = (await loadCaptionsEditJob(job.editJobId)) ?? job;
  const sent = new Set([...(fresh.notified ?? []), ...(job.notified ?? [])]);
  if (sent.has(type)) {
    return;
  }
  // A stale worker must not announce an outcome the job no longer has (e.g. "done" for a job that failed).
  if ((type === 'edit_done' && fresh.status === 'failed') || (type === 'edit_failed' && fresh.status === 'done')) {
    return;
  }
  // Atomic claim: of any number of workers finishing the same job at once (a stale worker + the recovery worker,
  // two engine instances), exactly one gets 1 back and sends. The persisted `notified` list above covers KV loss.
  const claim = await (await getKv()).increment(notifyClaimKey(job.editJobId, type), 1, 90 * 24 * 60 * 60);
  if (claim !== 1) {
    return;
  }
  sent.add(type);
  job.notified = [...sent];
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);
  await notifyCreatorEditDone({
    userId: job.userId,
    editJobId: job.editJobId,
    status,
    type,
    ...(job.blueprintId ? {blueprintId: job.blueprintId} : {}),
    ...extra,
  });
}

/** Retries a transient engine start (never a bad request) once before the job is failed. */
async function startWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isEngineError(error) && (error.code === 'bad_request' || error.code === 'not_found')) {
      throw error;
    }
    await sleep(2500);
    return fn();
  }
}

/** Re-checks the creator's plan right before paid work starts. Returns false (and fails the job) when it is not allowed. */
async function entitledToProceed(job: CaptionsEditJob): Promise<boolean> {
  const verdict = await checkFullEditForWorker(job.userId);
  if (verdict === 'allow') {
    return true;
  }
  if (verdict === 'deny') {
    await failJob(job, 'pro_required', 'FinalPost Pro is required to finish this edit.');
  } else {
    await failJob(job, 'entitlement_unavailable', 'We could not confirm your FinalPost plan. Try again in a moment.');
  }
  return false;
}

async function runFullEditPipeline(job: CaptionsEditJob): Promise<void> {
  if (!(await entitledToProceed(job))) {
    return;
  }
  job.status = 'analyzing';
  job.progress = 0.08;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  const options = job.fullEdit ?? {};
  const analysis = await startWithRetry(() =>
    startAnalysis({
      userId: job.userId,
      videoUrl: job.sourcePublicUrl,
      languageCode: job.languageCode,
      useCache: !job.captionStyleGuide,
      captionStyleGuide: job.captionStyleGuide || null,
      ...(options.userBrollUrls?.length ? {userBrollUrls: options.userBrollUrls} : {}),
      ...(options.subjectCutoutUrl ? {subjectCutoutUrl: options.subjectCutoutUrl} : {}),
      ...(job.style ? {style: job.style} : {}), // startAnalysis resolves its flags (lib/styleRun.ts)
    }),
  );
  job.analysisJobId = analysis.analysisJobId;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);
  await continueFullEditAfterAnalysis(job);
}

async function continueFullEditAfterAnalysis(job: CaptionsEditJob): Promise<void> {
  const analysis = await waitForAnalysis(job);
  if (!analysis?.blueprint) {
    return;
  }
  const blueprint = analysis.blueprint;
  job.blueprintId = blueprint.blueprintId;
  const brief = blueprint.assetBrief;
  if (brief && Array.isArray(brief.slots)) {
    job.assetBrief = brief;
  }
  job.updatedAt = new Date().toISOString();
  // Keep the plan with the job: the KV blueprint can expire long before the creator answers the asset gate.
  await saveDurableBlueprint(job, blueprint);

  // Server-owned gate: stop here until the creator answers (submit or skip), unless they already did.
  if (!job.labeledAssetBindings && (job.assetBrief?.slots.length ?? 0) > 0) {
    job.status = 'awaiting_assets';
    job.progress = 0.5;
    await saveCaptionsEditJob(job);
    await notifyOnce(job, 'assets_needed', 'awaiting_assets');
    return;
  }
  await saveCaptionsEditJob(job);
  await startFullEditRender(job);
}

async function startFullEditRender(job: CaptionsEditJob): Promise<void> {
  if (!job.blueprintId) {
    await failJob(job, 'analysis_failed', 'The edit plan is missing. Try again.');
    return;
  }
  let blueprint = await loadBlueprint(job.blueprintId);
  if (!blueprint) {
    // KV expired: restore the plan from the durable snapshot saved with the job.
    const snapshot = (await loadDurableBlueprint(job.editJobId)) as typeof blueprint | null;
    if (snapshot) {
      await saveBlueprint(snapshot, `restore:${job.editJobId}`);
      await grantBlueprintAccess(job.blueprintId, job.userId);
      blueprint = snapshot;
    }
  }
  if (!blueprint) {
    await failJob(job, 'not_found', 'The edit plan expired. Try again.');
    return;
  }
  if (!(await entitledToProceed(job))) {
    return;
  }
  job.status = 'rendering';
  job.progress = 0.55;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);

  const flags = job.fullEdit?.renderFlags ?? {brollEnabled: true, zoomEnabled: true, trimEnabled: true};
  const render = await startWithRetry(() =>
    startRender({
      userId: job.userId,
      blueprintId: blueprint.blueprintId,
      style: {
        captionTemplate: job.captionTemplate,
        layoutStyle: (job.fullEdit?.layoutStyle as never) || 'fullscreen',
        captionBottomFrac: blueprint.captionDirection?.bottomFrac ?? 0.22,
        captionCenterXFrac: 0.5,
        ...flags,
        colorGradeLut: '',
      },
    }),
  );
  job.renderJobId = render.renderJobId;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);
  await waitForRenderJob(job);
}

async function resumeFullEditPipeline(job: CaptionsEditJob): Promise<void> {
  if (job.status === 'awaiting_assets') {
    return; // waits for submitFullEditAssets
  }
  if (job.status === 'analyzing') {
    if (job.labeledAssetBindings && !job.assetsAnalysisStarted) {
      // The creator answered the gate but the engine stopped before acting on it: do that now (not the old plan).
      await resumeFullEditAfterAssets(job);
    } else if (job.analysisJobId) {
      await continueFullEditAfterAnalysis(job);
    } else {
      await runFullEditPipeline(job);
    }
    return;
  }
  if (job.status === 'rendering') {
    if (job.renderJobId) {
      await waitForRenderJob(job);
    } else {
      await startFullEditRender(job);
    }
  }
}

// Worker identity and lease. The lease lives in the durable table so that, across processes, at most one worker
// advances a job at a time. It is renewed while the work runs and released afterwards; if the process dies the
// lease simply expires and the recovery worker (below) can take the job over.
const WORKER_ID = `engine-${workerUuid().slice(0, 8)}`;
const LEASE_MS = 10 * 60 * 1000;
const RECOVER_IDLE_MS = 2 * 60 * 1000;
const RECOVER_EVERY_MS = 60 * 1000;
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/** Runs `fn` while holding the job's lease. Captions jobs (and a store-less dev setup) just run. Returns false when another worker holds it. */
async function leased(editJobId: string, mode: CaptionsEditJob['mode'], fn: () => Promise<void>): Promise<boolean> {
  const durable = mode === 'full_edit' ? getDurableJobStore() : null;
  if (!durable) {
    await fn();
    return true;
  }
  if (!(await durable.claimLease(editJobId, WORKER_ID, LEASE_MS))) {
    log.info({editJobId}, 'full edit is owned by another worker');
    return false;
  }
  const heartbeat = setInterval(() => {
    void durable.claimLease(editJobId, WORKER_ID, LEASE_MS).catch(() => {});
  }, LEASE_MS / 3);
  heartbeat.unref();
  try {
    await fn();
  } finally {
    clearInterval(heartbeat);
    await durable.releaseLease(editJobId, WORKER_ID).catch(() => {});
  }
  return true;
}

/** Runs `fn` as the single active worker of a full-edit job (a duplicate trigger is a no-op). */
async function withFullEditLock(editJobId: string, fn: () => Promise<void>): Promise<void> {
  if (fullEditActive.has(editJobId) || running.has(editJobId)) {
    return;
  }
  fullEditActive.add(editJobId);
  try {
    await leased(editJobId, 'full_edit', fn);
  } catch (error) {
    const engineError = toEngineError(error);
    log.error({editJobId, error}, 'full edit step failed');
    const job = await loadCaptionsEditJob(editJobId);
    if (job && job.status !== 'done' && job.status !== 'failed') {
      await failJob(job, engineError.code, isEngineError(error) ? engineError.message : 'Could not finish your edit. Try again.');
    }
  } finally {
    fullEditActive.delete(editJobId);
  }
}

function ownedFullEdit(job: CaptionsEditJob | null, userId: string): CaptionsEditJob {
  if (!job || job.userId !== userId) {
    throw new EngineError('not_found', 'Edit job not found');
  }
  if (job.mode !== 'full_edit') {
    throw new EngineError('bad_request', 'This edit does not take assets');
  }
  return job;
}

/**
 * The creator answered the labeled-asset gate. Idempotent: only the FIRST answer of an
 * `awaiting_assets` job starts anything; a repeat (double tap, retry after a lost response) returns the job as it is.
 */
export async function submitFullEditAssets(input: {
  editJobId: string;
  userId: string;
  bindings?: LabeledAssetBinding[];
  skipAll?: boolean;
}): Promise<CaptionsEditJob> {
  const job = ownedFullEdit(await loadCaptionsEditJob(input.editJobId), input.userId);
  if (job.status !== 'awaiting_assets' || job.labeledAssetBindings) {
    return job;
  }
  const slots = job.assetBrief?.slots ?? [];
  const bindings: LabeledAssetBinding[] = input.skipAll
    ? slots.map(slot => ({slotId: slot.id, status: 'skipped' as const}))
    : (input.bindings ?? []);
  job.labeledAssetBindings = bindings;
  job.status = 'analyzing';
  job.progress = 0.5;
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job);
  void withFullEditLock(job.editJobId, () => resumeFullEditAfterAssets(job));
  return job;
}

function uploadedAssetUrls(bindings: readonly LabeledAssetBinding[]): string[] {
  return bindings
    .filter(binding => binding.status === 'uploaded')
    .flatMap(binding => [binding.assetUrl, ...(binding.assetUrls ?? [])])
    .map(url => (url || '').trim())
    .filter((url, index, all) => Boolean(url) && all.indexOf(url) === index);
}

async function resumeFullEditAfterAssets(job: CaptionsEditJob): Promise<void> {
  const bindings = job.labeledAssetBindings ?? [];
  const urls = uploadedAssetUrls(bindings);
  const options = job.fullEdit ?? {};
  if (urls.length > 0) {
    if (!(await entitledToProceed(job))) {
      return;
    }
    // New assets change the plan: analyze again with them (a fresh blueprint, no cache).
    const merged = [...(options.userBrollUrls ?? []), ...urls].filter((url, i, all) => all.indexOf(url) === i);
    const analysis = await startWithRetry(() =>
      startAnalysis({
        userId: job.userId,
        videoUrl: job.sourcePublicUrl,
        languageCode: job.languageCode,
        useCache: false,
        captionStyleGuide: job.captionStyleGuide || null,
        userBrollUrls: merged,
        labeledAssetBindings: bindings,
        ...(options.subjectCutoutUrl ? {subjectCutoutUrl: options.subjectCutoutUrl} : {}),
        ...(job.style ? {style: job.style} : {}), // startAnalysis resolves its flags (lib/styleRun.ts)
      }),
    );
    job.analysisJobId = analysis.analysisJobId;
    job.assetsAnalysisStarted = true;
    job.updatedAt = new Date().toISOString();
    await saveCaptionsEditJob(job);
    await continueFullEditAfterAnalysis(job);
    return;
  }
  job.assetsAnalysisStarted = true;
  if (bindings.length > 0 && job.blueprintId) {
    const blueprint = await loadBlueprint(job.blueprintId);
    if (blueprint) {
      const baseBrief =
        blueprint.assetBrief ??
        buildLabeledAssetBrief({words: blueprint.captionWords ?? [], outputDurationSec: blueprint.outputDurationSec});
      const assetBrief = applyLabeledAssetBindings(baseBrief, bindings, new Map());
      await saveBlueprint(
        {...blueprint, assetBrief, editReadiness: computeEditReadiness(assetBrief)},
        `bind:${job.blueprintId}:${Date.now()}`,
      );
    }
  }
  await startFullEditRender(job);
}

/** A failed full edit can be retried once the creator asks: from the render if a plan exists, else from analysis. Idempotent. */
export async function retryFullEdit(input: {editJobId: string; userId: string}): Promise<CaptionsEditJob> {
  const job = ownedFullEdit(await loadCaptionsEditJob(input.editJobId), input.userId);
  if (job.status !== 'failed') {
    return job;
  }
  job.errorCode = undefined;
  job.errorMessage = undefined;
  job.notified = (job.notified ?? []).filter(type => type !== 'edit_failed');
  await (await getKv()).del(notifyClaimKey(job.editJobId, 'edit_failed')); // a new failure may notify again
  if (job.blueprintId && (job.labeledAssetBindings || (job.assetBrief?.slots.length ?? 0) === 0)) {
    job.status = 'rendering';
    job.renderJobId = undefined;
  } else {
    job.status = 'analyzing';
    job.analysisJobId = undefined;
    job.blueprintId = undefined;
  }
  job.updatedAt = new Date().toISOString();
  await saveCaptionsEditJob(job, {allowReopen: true});
  void withFullEditLock(job.editJobId, () => resumeFullEditPipeline(job));
  return job;
}

/**
 * Recovery worker (the ONLY thing that restarts a stalled job; GET /v1/edits/:id is read-only).
 *
 * A job is recoverable when it is `awaiting_upload` / `analyzing` / `rendering`, has been silent for RECOVER_IDLE_MS and its lease is
 * free or expired (its worker died with the engine). `awaiting_assets` is never touched: the asset gate is only
 * answered by the creator. Each recovery takes the lease first, so two engine instances never run the same job,
 * and the pipeline steps are idempotent (a stored render / analysis id is waited on, never started again).
 */
export async function recoverFullEditJobs(): Promise<number> {
  const durable = getDurableJobStore();
  if (!durable) {
    return 0;
  }
  const ids = await durable.listRecoverable({idleMs: RECOVER_IDLE_MS, limit: 20});
  let started = 0;
  for (const editJobId of ids) {
    started += 1;
    void withFullEditLock(editJobId, async () => {
      const job = await loadCaptionsEditJob(editJobId);
      if (!job || job.mode !== 'full_edit') {
        return;
      }
      if (job.status === 'awaiting_upload') {
        // The engine restarted while the phone was uploading: nothing is polling the source any more. Poll it again
        // (up to the usual upload window) instead of waiting for the phone's follow-up ping or the creator to reopen the app.
        log.info({editJobId}, 'recovering full edit waiting for its upload');
        await waitForSourceThenRun(editJobId);
        return;
      }
      if (job.status !== 'analyzing' && job.status !== 'rendering') {
        return;
      }
      log.info({editJobId, status: job.status}, 'recovering stalled full edit');
      await resumeFullEditPipeline(job);
    });
  }
  return started;
}

let recoveryTimers: NodeJS.Timeout[] = [];

/** Starts the recovery scan (every minute) and the retention sweep (daily). Idempotent. */
export function startFullEditRecoveryWorker(): void {
  if (recoveryTimers.length > 0 || !getDurableJobStore()) {
    return;
  }
  const scan = setInterval(() => {
    void recoverFullEditJobs().catch(error => log.warn({error}, 'full edit recovery scan failed'));
  }, RECOVER_EVERY_MS);
  const purge = setInterval(() => {
    void getDurableJobStore()
      ?.purge()
      .then(result => log.info(result, 'edit job retention sweep'))
      .catch(error => log.warn({error}, 'edit job retention sweep failed'));
  }, PURGE_EVERY_MS);
  scan.unref();
  purge.unref();
  recoveryTimers = [scan, purge];
  // One scan shortly after boot picks up whatever the previous process left behind.
  setTimeout(() => void recoverFullEditJobs().catch(() => {}), 5_000).unref();
}

export function stopFullEditRecoveryWorker(): void {
  for (const timer of recoveryTimers) {
    clearInterval(timer);
  }
  recoveryTimers = [];
}

export {loadCaptionsEditJob};
