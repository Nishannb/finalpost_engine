/**
 * Stage E — headless burn on Remotion Lambda.
 *
 * The blueprint plus the user's style choices are passed straight through as
 * input props, so the Lambda site is a pure function of this payload: identical
 * inputs always produce an identical MP4, which makes retries safe.
 */

import {
  getRenderProgress,
  renderMediaOnLambda,
  type AwsRegion,
} from '@remotion/lambda/client';

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  RemotionInputProps,
  RenderJob,
  RenderStyle,
  TimelineBlueprint,
} from '../../types/blueprint.ts';

const log = stageLogger('stage-e-render');

export function renderConfigured(): boolean {
  return Boolean(env.REMOTION_FUNCTION_NAME && env.REMOTION_SERVE_URL);
}

function region(): AwsRegion {
  return env.REMOTION_AWS_REGION as AwsRegion;
}

export async function startLambdaRender(input: {
  blueprint: TimelineBlueprint;
  style: RenderStyle;
  renderJobId: string;
}): Promise<{bucketName: string; lambdaRenderId: string}> {
  if (!renderConfigured()) {
    throw new EngineError(
      'not_configured',
      'Rendering is not configured (REMOTION_FUNCTION_NAME / REMOTION_SERVE_URL missing)',
    );
  }

  const inputProps: RemotionInputProps = {
    blueprint: input.blueprint,
    style: input.style,
  };

  try {
    const result = await renderMediaOnLambda({
      region: region(),
      functionName: env.REMOTION_FUNCTION_NAME,
      serveUrl: env.REMOTION_SERVE_URL,
      composition: env.REMOTION_COMPOSITION_ID,
      inputProps,
      codec: 'h264',
      imageFormat: 'jpeg',
      jpegQuality: 88,
      privacy: 'public',
      framesPerLambda: env.REMOTION_FRAMES_PER_LAMBDA,
      maxRetries: 1,
      // Without an explicit bucket, Remotion writes into its own render bucket.
      outName: env.REMOTION_S3_OUTPUT_BUCKET
        ? {
            key: `renders/${input.renderJobId}.mp4`,
            bucketName: env.REMOTION_S3_OUTPUT_BUCKET,
          }
        : `renders/${input.renderJobId}.mp4`,
      downloadBehavior: {
        type: 'download',
        fileName: `kinmel-short-${input.renderJobId}.mp4`,
      },
      logLevel: env.NODE_ENV === 'production' ? 'warn' : 'info',
    });

    log.info(
      {
        renderJobId: input.renderJobId,
        lambdaRenderId: result.renderId,
        durationSec: input.blueprint.outputDurationSec,
      },
      'lambda render started',
    );

    return {bucketName: result.bucketName, lambdaRenderId: result.renderId};
  } catch (error) {
    log.error({error, renderJobId: input.renderJobId}, 'lambda render failed to start');
    throw new EngineError(
      'render_failed',
      error instanceof Error ? error.message : 'Render could not be started',
    );
  }
}

export type LambdaProgress = {
  done: boolean;
  progress: number;
  outputUrl?: string;
  costUsd?: number;
  errorMessage?: string;
};

export async function pollLambdaRender(job: RenderJob): Promise<LambdaProgress> {
  if (!job.bucketName || !job.lambdaRenderId) {
    throw new EngineError('not_found', 'Render job has no Lambda handles');
  }

  const progress = await getRenderProgress({
    renderId: job.lambdaRenderId,
    bucketName: job.bucketName,
    functionName: env.REMOTION_FUNCTION_NAME,
    region: region(),
  });

  if (progress.fatalErrorEncountered) {
    return {
      done: false,
      progress: progress.overallProgress ?? 0,
      errorMessage:
        progress.errors?.[0]?.message ?? 'Render failed inside Lambda',
    };
  }

  return {
    done: Boolean(progress.done),
    progress: Math.max(0, Math.min(1, progress.overallProgress ?? 0)),
    outputUrl: progress.outputFile ?? undefined,
    costUsd: progress.costs?.accruedSoFar ?? undefined,
  };
}
