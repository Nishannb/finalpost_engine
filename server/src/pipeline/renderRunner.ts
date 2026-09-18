/**
 * Stage E job runner.
 *
 * Dev: Remotion on this Mac, MP4 uploaded to R2.
 * Prod: Remotion Lambda, when function name + serve URL are set.
 */

import {randomUUID} from 'node:crypto';

import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {
  loadBlueprint,
  loadRenderJob,
  saveRenderJob,
} from '../store/engineStore.ts';
import {localRenderAvailable, renderLocally} from '../stages/render/localRender.ts';
import {
  pollLambdaRender,
  renderConfigured as lambdaConfigured,
  startLambdaRender,
} from '../stages/render/remotionLambda.ts';
import {
  assertRenderAllowed,
  estimateRenderCostUsd,
  recordRender,
} from '../stages/render/renderBudget.ts';
import type {RenderJob, RenderStyle} from '../types/blueprint.ts';

const log = stageLogger('render-runner');

export function renderAvailable(): boolean {
  return lambdaConfigured() || localRenderAvailable();
}

export function renderMode(): 'lambda' | 'local' | 'off' {
  if (lambdaConfigured()) {
    return 'lambda';
  }
  if (localRenderAvailable()) {
    return 'local';
  }
  return 'off';
}

export async function startRender(input: {
  userId: string;
  blueprintId: string;
  style: RenderStyle;
}): Promise<RenderJob> {
  if (!renderAvailable()) {
    throw new EngineError(
      'not_configured',
      'Rendering is not enabled — Remotion project or Lambda missing',
    );
  }

  const blueprint = await loadBlueprint(input.blueprintId);
  if (!blueprint) {
    throw new EngineError('not_found', 'Blueprint not found or expired');
  }

  const outputDurationSec = input.style.trimEnabled
    ? blueprint.outputDurationSec
    : blueprint.sourceDurationSec;

  await assertRenderAllowed(input.userId, outputDurationSec);

  const now = new Date().toISOString();
  const job: RenderJob = {
    renderJobId: `rn_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    blueprintId: blueprint.blueprintId,
    userId: input.userId,
    status: 'queued',
    progress: 0,
    style: input.style,
    outputDurationSec,
    createdAt: now,
    updatedAt: now,
    estimatedCostUsd: estimateRenderCostUsd(outputDurationSec),
  };
  await saveRenderJob(job);
  await recordRender(input.userId, outputDurationSec);

  void runRender(job);
  return job;
}

async function runRender(job: RenderJob): Promise<void> {
  const blueprint = await loadBlueprint(job.blueprintId);
  if (!blueprint) {
    job.status = 'failed';
    job.errorCode = 'not_found';
    job.errorMessage = 'Blueprint expired before render started';
    job.updatedAt = new Date().toISOString();
    await saveRenderJob(job);
    return;
  }

  job.status = 'rendering';
  job.progress = 0.05;
  job.updatedAt = new Date().toISOString();
  await saveRenderJob(job);

  try {
    if (lambdaConfigured()) {
      const handles = await startLambdaRender({
        blueprint,
        style: job.style,
        renderJobId: job.renderJobId,
      });
      job.bucketName = handles.bucketName;
      job.lambdaRenderId = handles.lambdaRenderId;
      job.updatedAt = new Date().toISOString();
      await saveRenderJob(job);
      return;
    }

    const result = await renderLocally({
      blueprint,
      style: job.style,
      renderJobId: job.renderJobId,
      onProgress: progress => {
        job.progress = progress;
        job.updatedAt = new Date().toISOString();
        void saveRenderJob(job);
      },
    });
    job.status = 'done';
    job.progress = 1;
    job.outputUrl = result.outputUrl;
    job.updatedAt = new Date().toISOString();
    await saveRenderJob(job);
  } catch (error) {
    const engineError = toEngineError(error);
    log.error({renderJobId: job.renderJobId, error}, 'render failed');
    job.status = 'failed';
    job.errorCode = engineError.code;
    job.errorMessage = isEngineError(error)
      ? engineError.message
      : 'Render failed. Please try again.';
    job.updatedAt = new Date().toISOString();
    await saveRenderJob(job);
  }
}

/** Refresh Lambda progress. Local jobs already write their own status. */
export async function refreshRenderJob(job: RenderJob): Promise<RenderJob> {
  if (job.status === 'done' || job.status === 'failed') {
    return job;
  }
  if (!job.lambdaRenderId || !job.bucketName) {
    return job;
  }

  const progress = await pollLambdaRender(job);
  job.progress = progress.progress;
  job.updatedAt = new Date().toISOString();
  if (progress.errorMessage) {
    job.status = 'failed';
    job.errorCode = 'render_failed';
    job.errorMessage = progress.errorMessage;
  } else if (progress.done && progress.outputUrl) {
    job.status = 'done';
    job.progress = 1;
    job.outputUrl = progress.outputUrl;
    if (progress.costUsd !== undefined) {
      job.estimatedCostUsd = progress.costUsd;
    }
  }
  await saveRenderJob(job);
  return job;
}

export {loadRenderJob};
