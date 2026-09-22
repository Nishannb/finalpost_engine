/**
 * Captions-only mobile job: wait for the phone's background R2 PUT, then
 * analyze + burn without requiring the app to stay in the foreground.
 */

import {randomUUID} from 'node:crypto';

import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {notifyCreatorEditDone} from '../http/notifyCreator.ts';
import {
  loadAnalysisJob,
  loadCaptionsEditJob,
  saveCaptionsEditJob,
} from '../store/engineStore.ts';
import {presignSourceVideo, sourceObjectExists} from '../storage/r2.ts';
import type {
  CaptionTemplateId,
  CaptionsEditJob,
  LanguageCode,
} from '../types/blueprint.ts';
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
  captionStyleGuide?: Record<string, unknown> | null;
  mode?: 'captions' | 'teleprompter_clean';
  scriptText?: string;
}): Promise<{job: CaptionsEditJob; uploadUrl: string}> {
  const presigned = await presignSourceVideo({
    contentType: input.contentType,
    extension: input.extension,
  });
  const now = new Date().toISOString();
  const mode = input.mode === 'teleprompter_clean' ? 'teleprompter_clean' : 'captions';
  const job: CaptionsEditJob = {
    editJobId: `ed_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    status: 'awaiting_upload',
    progress: 0.02,
    sourceKey: presigned.key,
    sourcePublicUrl: presigned.publicUrl,
    languageCode: input.languageCode,
    captionTemplate: input.captionTemplate,
    captionStyleGuide: input.captionStyleGuide || undefined,
    mode,
    scriptText:
      mode === 'teleprompter_clean'
        ? (input.scriptText || '').trim().slice(0, 20_000) || undefined
        : undefined,
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
    if (job.status === 'awaiting_upload') {
      await runCaptionsPipeline(job);
    } else if (job.status === 'analyzing' || job.status === 'rendering') {
      await resumeCaptionsPipeline(job);
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
    requestedEdits: ['captions'],
    captionTemplate: job.captionTemplate,
    captionStyleGuide: job.captionStyleGuide || null,
    teleprompterClean,
    scriptText: job.scriptText,
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
  if (job.renderJobId) {
    await waitForRenderJob(job);
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
      await notifyCreatorEditDone({
        userId: job.userId,
        editJobId: job.editJobId,
        status: 'done',
        outputUrl: render.outputUrl,
      });
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
  await notifyCreatorEditDone({
    userId: job.userId,
    editJobId: job.editJobId,
    status: 'failed',
    errorMessage: message,
  });
}

export {loadCaptionsEditJob};
