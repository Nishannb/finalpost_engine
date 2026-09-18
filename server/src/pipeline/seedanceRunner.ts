/**
 * Async Seedance template-apply jobs (pollable like analyze/render).
 */

import {randomUUID} from 'node:crypto';

import {EngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {getKv} from '../store/kv.ts';
import {
  applySeedanceTemplate,
  seedanceConfigured,
} from '../stages/templates/seedanceEdit.ts';

const log = stageLogger('seedance-job');
const PREFIX = 'engine:seedance:';
const TTL_SEC = 60 * 60 * 6;

export type SeedanceJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed';

export type SeedanceJob = {
  seedanceJobId: string;
  userId: string;
  status: SeedanceJobStatus;
  progress: number;
  error?: string;
  outputUrl?: string;
  estimatedCostUsd?: number;
  model?: string;
  outputDurationSec?: number;
  createdAt: string;
  updatedAt: string;
};

async function saveJob(job: SeedanceJob): Promise<void> {
  const kv = await getKv();
  await kv.set(`${PREFIX}${job.seedanceJobId}`, JSON.stringify(job), TTL_SEC);
}

export async function loadSeedanceJob(
  seedanceJobId: string,
): Promise<SeedanceJob | null> {
  const kv = await getKv();
  const raw = await kv.get(`${PREFIX}${seedanceJobId}`);
  return raw ? (JSON.parse(raw) as SeedanceJob) : null;
}

export async function startSeedanceEdit(input: {
  userId: string;
  videoUrl: string;
  styleRecipe: Record<string, unknown>;
  styleReferenceVideoUrl?: string | null;
}): Promise<SeedanceJob> {
  if (!seedanceConfigured()) {
    throw new EngineError(
      'not_configured',
      'Seedance is not configured (set OPENROUTER_API_KEY)',
    );
  }
  const now = new Date().toISOString();
  const job: SeedanceJob = {
    seedanceJobId: `sdj_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    status: 'queued',
    progress: 0.05,
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);

  void runSeedanceJob(job.seedanceJobId, input);
  return job;
}

async function runSeedanceJob(
  seedanceJobId: string,
  input: {
    userId: string;
    videoUrl: string;
    styleRecipe: Record<string, unknown>;
    styleReferenceVideoUrl?: string | null;
  },
): Promise<void> {
  const bump = async (patch: Partial<SeedanceJob>) => {
    const current = await loadSeedanceJob(seedanceJobId);
    if (!current) {
      return;
    }
    await saveJob({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  try {
    await bump({status: 'running', progress: 0.15});
    const result = await applySeedanceTemplate({
      videoUrl: input.videoUrl,
      styleRecipe: input.styleRecipe,
      styleReferenceVideoUrl: input.styleReferenceVideoUrl,
    });
    await bump({
      status: 'done',
      progress: 1,
      outputUrl: result.outputUrl,
      estimatedCostUsd: result.estimatedCostUsd,
      model: result.model,
      outputDurationSec: result.outputDurationSec,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Seedance edit failed';
    log.warn({error, seedanceJobId}, 'seedance job failed');
    await bump({status: 'failed', progress: 1, error: message});
  }
}
