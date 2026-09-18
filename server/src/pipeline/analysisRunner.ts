/**
 * Async job wrapper around stages A→D.
 *
 * Analysis takes tens of seconds, which is far too long to hold a mobile HTTP
 * request open, so callers get a job id immediately and poll. Concurrency is
 * capped because ffmpeg is the one CPU-bound step and the API shares a small VPS.
 */

import {randomUUID} from 'node:crypto';

import {isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {
  fingerprintSource,
  loadBlueprintByFingerprint,
  saveAnalysisJob,
  saveBlueprint,
} from '../store/engineStore.ts';
import {
  assertAnalysisAllowed,
  recordAnalysis,
} from '../stages/render/renderBudget.ts';
import {userBrollFingerprintKey} from '../stages/broll/userBrollDescribe.ts';
import type {
  AnalysisJob,
  AnalysisStage,
  LanguageCode,
} from '../types/blueprint.ts';
import {analyzeVideo} from './analyzeVideo.ts';

const log = stageLogger('analysis-runner');

const MAX_CONCURRENT_ANALYSES = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  if (active >= MAX_CONCURRENT_ANALYSES) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    active -= 1;
    waiting.shift()?.();
  };
}

export async function startAnalysis(input: {
  userId: string;
  videoUrl: string;
  languageCode: LanguageCode;
  useCache: boolean;
  colorGradeLut?: string;
  styleRecipe?: Record<string, unknown>;
  userBrollUrls?: string[];
}): Promise<AnalysisJob> {
  const now = new Date().toISOString();
  const userBrollUrls = (input.userBrollUrls ?? []).filter(Boolean).slice(0, 5);
  const fingerprint = fingerprintSource({
    videoUrl: input.videoUrl,
    languageCode: input.languageCode,
    colorGradeLut: input.colorGradeLut,
    styleRecipeKey: input.styleRecipe
      ? JSON.stringify(input.styleRecipe).slice(0, 500)
      : '',
    userBrollKey: userBrollFingerprintKey(userBrollUrls),
  });

  // Cache hit costs nothing and must not consume the user's monthly allowance.
  if (input.useCache) {
    const cached = await loadBlueprintByFingerprint(fingerprint);
    if (cached) {
      const job: AnalysisJob = {
        analysisJobId: `an_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        userId: input.userId,
        videoUrl: input.videoUrl,
        languageCode: input.languageCode,
        status: 'done',
        progress: 1,
        createdAt: now,
        updatedAt: now,
        cached: true,
        blueprint: cached,
      };
      await saveAnalysisJob(job);
      log.info({blueprintId: cached.blueprintId}, 'served cached blueprint');
      return job;
    }
  }

  await assertAnalysisAllowed(input.userId);

  const job: AnalysisJob = {
    analysisJobId: `an_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    videoUrl: input.videoUrl,
    languageCode: input.languageCode,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    cached: false,
  };
  await saveAnalysisJob(job);

  void runAnalysis(job, fingerprint, {
    colorGradeLut: input.colorGradeLut,
    styleRecipe: input.styleRecipe,
    userBrollUrls,
  });
  return job;
}

async function runAnalysis(
  job: AnalysisJob,
  fingerprint: string,
  extras: {
    colorGradeLut?: string;
    styleRecipe?: Record<string, unknown>;
    userBrollUrls?: string[];
  },
): Promise<void> {
  const release = await acquireSlot();
  const patch = async (
    status: AnalysisStage,
    progress: number,
    extra: Partial<AnalysisJob> = {},
  ) => {
    Object.assign(job, extra, {
      status,
      progress,
      updatedAt: new Date().toISOString(),
    });
    await saveAnalysisJob(job);
  };

  try {
    const blueprint = await analyzeVideo(
      {
        videoUrl: job.videoUrl,
        languageCode: job.languageCode,
        userId: job.userId,
        colorGradeLut: extras.colorGradeLut,
        styleRecipe: extras.styleRecipe,
        userBrollUrls: extras.userBrollUrls,
      },
      {
        onStage: (stage, progress) => {
          // Fire-and-forget: a slow store write must not stall the pipeline.
          void patch(stage, progress);
        },
      },
    );

    await saveBlueprint(blueprint, fingerprint);
    await recordAnalysis(job.userId);
    await patch('done', 1, {blueprint});
  } catch (error) {
    const engineError = toEngineError(error);
    log.error(
      {analysisJobId: job.analysisJobId, code: engineError.code, error},
      'analysis failed',
    );
    await patch('failed', job.progress, {
      errorCode: engineError.code,
      errorMessage: isEngineError(error)
        ? engineError.message
        : 'AI edit failed. Please try again.',
    });
  } finally {
    release();
  }
}
