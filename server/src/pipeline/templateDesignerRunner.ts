/**
 * Reference video → AI Template Designer → EditSpec → Alan black-screen preview.
 * Does not call or modify the AI Director.
 */

import {randomUUID} from 'node:crypto';

import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
  withWorkspace,
} from '../lib/tempFiles.ts';
import {presignSourceVideo, sourceObjectExists} from '../storage/r2.ts';
import {
  fingerprintSource,
  loadTemplateDesignJob,
  saveBlueprint,
  saveTemplateDesignJob,
} from '../store/engineStore.ts';
import {preprocessReferenceVideo} from '../stages/templateDesigner/preprocess.ts';
import {runTemplateDesigner} from '../stages/templateDesigner/designer.ts';
import {editSpecToCaptionStyleGuide} from '../stages/templateDesigner/applyEditSpec.ts';
import {
  alanPreviewRenderStyle,
  buildAlanPreviewBlueprint,
} from '../stages/templateDesigner/alanPreviewBlueprint.ts';
import {loadRenderJob, refreshRenderJob, startRender} from './renderRunner.ts';
import type {TemplateDesignJob} from '../types/templateDesign.ts';

const log = stageLogger('template-designer-job');
const running = new Set<string>();
const sourceReady = new Set<string>();
const HEAD_POLL_MS = 2500;
const HEAD_TIMEOUT_MS = 20 * 60 * 1000;
const STAGE_POLL_MS = 2000;
const STAGE_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export async function createTemplateDesignJob(input: {
  userId: string;
  contentType: string;
  extension?: string;
  name?: string;
}): Promise<{job: TemplateDesignJob; uploadUrl: string}> {
  const presigned = await presignSourceVideo({
    contentType: input.contentType,
    extension: input.extension,
  });
  const now = new Date().toISOString();
  const job: TemplateDesignJob = {
    designJobId: `td_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    status: 'awaiting_upload',
    progress: 0.02,
    name: (input.name || 'My caption style').trim().slice(0, 80) || 'My caption style',
    description: '',
    sourceKey: presigned.key,
    sourcePublicUrl: presigned.publicUrl,
    createdAt: now,
    updatedAt: now,
  };
  await saveTemplateDesignJob(job);
  void waitThenDesign(job.designJobId);
  return {job, uploadUrl: presigned.uploadUrl};
}

export async function markTemplateDesignUploaded(
  designJobId: string,
  userId: string,
): Promise<TemplateDesignJob> {
  const job = await loadTemplateDesignJob(designJobId);
  if (!job || job.userId !== userId) {
    throw new EngineError('not_found', 'Template design job not found');
  }
  sourceReady.add(job.designJobId);
  void waitThenDesign(job.designJobId);
  return (await loadTemplateDesignJob(designJobId)) ?? job;
}

async function waitThenDesign(designJobId: string): Promise<void> {
  if (running.has(designJobId)) {
    return;
  }
  running.add(designJobId);
  try {
    let job = await loadTemplateDesignJob(designJobId);
    if (!job || job.status === 'done' || job.status === 'failed') {
      return;
    }
    if (job.status === 'awaiting_upload') {
      const deadline = Date.now() + HEAD_TIMEOUT_MS;
      let present = sourceReady.has(designJobId);
      while (!present) {
        present =
          sourceReady.has(designJobId) ||
          (await sourceObjectExists(job.sourceKey));
        if (present) {
          break;
        }
        if (Date.now() > deadline) {
          await failJob(job, 'timeout', 'Reference upload timed out. Try again.');
          return;
        }
        await sleep(HEAD_POLL_MS);
        const refreshed = await loadTemplateDesignJob(designJobId);
        if (!refreshed || refreshed.status !== 'awaiting_upload') {
          job = refreshed ?? job;
          break;
        }
      }
    }
    job = (await loadTemplateDesignJob(designJobId)) ?? job;
    if (
      job.status === 'awaiting_upload' ||
      job.status === 'preprocessing' ||
      job.status === 'designing'
    ) {
      await runDesign(job);
    } else if (job.status === 'rendering_preview') {
      await renderPreview(job.designJobId);
    }
  } catch (error) {
    const engineError = toEngineError(error);
    log.error({designJobId, error}, 'template design failed');
    const job = await loadTemplateDesignJob(designJobId);
    if (job && job.status !== 'done') {
      await failJob(
        job,
        engineError.code,
        isEngineError(error)
          ? engineError.message
          : 'Could not design that template. Try another clip.',
      );
    }
  } finally {
    running.delete(designJobId);
  }
}

async function runDesign(job: TemplateDesignJob): Promise<void> {
  job.status = 'preprocessing';
  job.progress = 0.12;
  job.updatedAt = new Date().toISOString();
  await saveTemplateDesignJob(job);

  const designed = await withWorkspace('template-design', async workspace => {
    const local = isLocalMediaPath(job.sourcePublicUrl);
    const extension = job.sourcePublicUrl.toLowerCase().includes('.mov')
      ? '.mov'
      : '.mp4';
    const sourcePath = workspace.file(`source${extension}`);
    await (local
      ? copyLocalFile(job.sourcePublicUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES})
      : downloadToFile(job.sourcePublicUrl, sourcePath, {
          maxBytes: MAX_SOURCE_BYTES,
        }));
    const preprocess = await preprocessReferenceVideo({
      sourcePath,
      stillPath: name => workspace.file(name),
    });
    job.status = 'designing';
    job.progress = 0.45;
    job.updatedAt = new Date().toISOString();
    await saveTemplateDesignJob(job);
    return runTemplateDesigner({
      preprocess,
      referenceUrl: job.sourcePublicUrl,
    });
  });

  const guide = editSpecToCaptionStyleGuide(designed.spec);
  job.editSpec = designed.spec;
  job.captionStyleGuide = guide;
  job.warnings = designed.warnings;
  job.modelUsed = designed.modelUsed;
  job.estimatedCostUsd = designed.estimatedCostUsd;
  job.confidence = designed.spec.confidence;
  job.description = designed.spec.overallStyle;
  job.name = designed.spec.name.slice(0, 80);
  job.status = 'rendering_preview';
  job.progress = 0.88;
  job.updatedAt = new Date().toISOString();
  await saveTemplateDesignJob(job);

  await renderPreview(job.designJobId);
}

async function renderPreview(designJobId: string): Promise<void> {
  const job = await loadTemplateDesignJob(designJobId);
  if (!job?.editSpec || !job.captionStyleGuide) {
    return;
  }
  job.progress = 0.9;
  job.updatedAt = new Date().toISOString();
  await saveTemplateDesignJob(job);

  const blueprint = buildAlanPreviewBlueprint({
    spec: job.editSpec,
    designJobId: job.designJobId,
  });
  await saveBlueprint(
    blueprint,
    fingerprintSource({
      videoUrl: `alan-preview:${job.designJobId}`,
      languageCode: 'en',
      requestedEdits: 'captions',
      captionStyleKey: job.designJobId,
    }),
  );
  const render = await startRender({
    userId: job.userId,
    blueprintId: blueprint.blueprintId,
    style: alanPreviewRenderStyle(job.editSpec),
  });
  job.previewRenderJobId = render.renderJobId;
  await saveTemplateDesignJob(job);
  const renderDeadline = Date.now() + STAGE_TIMEOUT_MS;
  while (Date.now() < renderDeadline) {
    let live = await loadRenderJob(render.renderJobId);
    if (!live) {
      throw new EngineError('render_failed', 'Alan preview render job was lost');
    }
    // Lambda jobs only flip to done/failed when we poll Remotion.
    live = await refreshRenderJob(live);
    if (live.status === 'done' && live.outputUrl) {
      const latest = (await loadTemplateDesignJob(designJobId)) ?? job;
      latest.previewUrl = live.outputUrl;
      latest.status = 'done';
      latest.progress = 1;
      latest.updatedAt = new Date().toISOString();
      await saveTemplateDesignJob(latest);
      return;
    }
    if (live.status === 'failed') {
      throw new EngineError(
        'render_failed',
        live.errorMessage || 'Preview render failed',
      );
    }
    await sleep(STAGE_POLL_MS);
  }
  throw new EngineError('upstream_timeout', 'Alan preview render timed out');
}

async function failJob(
  job: TemplateDesignJob,
  code: string,
  message: string,
): Promise<void> {
  job.status = 'failed';
  job.errorCode = code;
  job.errorMessage = message;
  job.updatedAt = new Date().toISOString();
  await saveTemplateDesignJob(job);
}
