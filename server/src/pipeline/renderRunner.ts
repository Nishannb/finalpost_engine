/**
 * Stage E job runner.
 *
 * Dev: Remotion on this Mac, MP4 uploaded to R2.
 * Prod: Remotion Lambda, when function name + serve URL are set.
 */

import {randomUUID} from 'node:crypto';

import {env} from '../config/env.ts';
import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {audioExpectationFor, createInFlight, describeVerificationFailure, verifyLambdaOutput} from '../lib/lambdaOutputCheck.ts';
import {createWorkspace, downloadToFile} from '../lib/tempFiles.ts';
import {designDiagnosticsFor} from '../lib/designTokens.ts';
import {stageLogger} from '../lib/logger.ts';
import {masterLambdaOutput} from '../stages/music/lambdaMaster.ts';
import {masterPass} from '../stages/music/masterPass.ts';
import {logMixCheck} from '../stages/music/mixCheck.ts';
import {logMusicSummary} from '../stages/music/musicSummary.ts';
import {assertRenderOutputValid} from '../lib/renderIntegrity.ts';
import {uploadPublicFile} from '../storage/r2.ts';
import {inspectOutput} from './experimentVerdict.ts';
import {
  assertBlueprintAccess,
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

/** WP3E: ceiling and timeout for downloading a finished Lambda render to check it (a download safety limit, not an integrity threshold). */
const LAMBDA_VERIFY_MAX_BYTES = 512 * 1024 * 1024;
const LAMBDA_VERIFY_TIMEOUT_MS = 5 * 60_000;
const lambdaVerifications = createInFlight();

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

  await assertBlueprintAccess(input.blueprintId, input.userId);
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

  // Migration diagnostics: a design conflict or an ignored invalid design is logged here (the renderer cannot reach the server log). Never blocks.
  for (const diagnostic of designDiagnosticsFor(blueprint)) {
    log.warn({code: diagnostic.code, blueprintId: blueprint.blueprintId}, diagnostic.message);
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
    if (progress.costUsd !== undefined) {
      job.estimatedCostUsd = progress.costUsd; // the render was paid for whatever the verdict
    }
    // WP3E: a finished Lambda render is NOT yet a successful one. The file is downloaded (address guard applied), inspected with the same judge as the local render, and the
    // URL becomes the job's output only if it passes. One poll verifies; concurrent polls report "still rendering" and save nothing.
    if (!lambdaVerifications.tryStart(job.renderJobId)) {
      job.progress = Math.min(job.progress, 0.99);
      return job;
    }
    try {
      const blueprint = await loadBlueprint(job.blueprintId);
      if (!blueprint) {
        throw new EngineError('render_failed', 'The render finished but could not be verified: its blueprint is no longer available.');
      }
      const workspace = await createWorkspace('lambda-verify');
      // WP3F: audio is required only when the ingest probe saved on the blueprint says the source had audio; no saved probe = unchecked + a warning, never a guess.
      const audio = audioExpectationFor(blueprint.sourceHasAudio);
      const verifiedUrl = await verifyLambdaOutput(
        {outputUrl: progress.outputUrl, expected: {width: blueprint.width, height: blueprint.height, durationSec: job.outputDurationSec, expectAudio: audio.expectAudio}},
        {
          download: (url, destination) => downloadToFile(url, destination, {maxBytes: LAMBDA_VERIFY_MAX_BYTES, timeoutMs: LAMBDA_VERIFY_TIMEOUT_MS}),
          inspect: inspectOutput,
          workspace,
          allowHosts: env.INGEST_ALLOWED_PRIVATE_HOSTS.split(',').map(item => item.trim()).filter(Boolean),
        },
      );
      // Production audio parity: the same -14 LUFS / -1 dBTP master pass as a local render, on the finished Lambda MP4. The mastered copy goes to its
      // own key and becomes the job's output; any failure keeps the verified Lambda URL (music.master_pass_failed) and the render still succeeds.
      const mastered = await masterLambdaOutput(
        {outputUrl: verifiedUrl, renderJobId: job.renderJobId, blueprintId: blueprint.blueprintId},
        {
          download: (url, destination) => downloadToFile(url, destination, {maxBytes: LAMBDA_VERIFY_MAX_BYTES, timeoutMs: LAMBDA_VERIFY_TIMEOUT_MS}),
          master: masterPass,
          verify: async file => {
            assertRenderOutputValid(await inspectOutput(file), {width: blueprint.width, height: blueprint.height, durationSec: job.outputDurationSec, expectAudio: audio.expectAudio});
          },
          upload: (file, key) => uploadPublicFile(file, key, 'video/mp4'),
          workspace: await createWorkspace('lambda-master'),
        },
      );
      job.status = 'done';
      job.progress = 1;
      job.outputUrl = mastered.url;
      if (!mastered.mastered && mastered.reason && mastered.reason !== 'off') job.warnings = [...new Set([...(job.warnings ?? []), 'music:master_not_applied'])];
      logMixCheck(log, blueprint);
      logMusicSummary(log, {renderJobId: job.renderJobId, blueprintId: blueprint.blueprintId, where: 'lambda', audioDesign: blueprint.audioDesign, master: mastered.master ?? null});
      if (audio.warnings.length > 0) {
        job.warnings = [...new Set([...(job.warnings ?? []), ...audio.warnings])];
      }
    } catch (error) {
      const failure = describeVerificationFailure(error);
      log.error({renderJobId: job.renderJobId, code: failure.code, error}, 'lambda render output failed verification');
      job.status = 'failed';
      job.errorCode = failure.code;
      job.errorMessage = failure.message;
    } finally {
      lambdaVerifications.end(job.renderJobId);
    }
  }
  await saveRenderJob(job);
  return job;
}

export {loadRenderJob};
