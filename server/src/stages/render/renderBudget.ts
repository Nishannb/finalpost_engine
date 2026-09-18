/**
 * Cost guardrails.
 *
 * The AI stages are cheap (~$0.004 per 5-minute analysis); the Lambda burn is
 * what can blow a $5/user budget, so renders are metered in output *seconds*
 * and refused past the monthly allowance instead of silently charging AWS.
 */

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {
  incrementMonthlyUsage,
  readMonthlyUsage,
} from '../../store/engineStore.ts';

/**
 * Observed Remotion Lambda cost for 1080x1920 H.264 at 3 GB memory.
 * Used for reporting only — AWS remains the source of truth for billing.
 */
const LAMBDA_USD_PER_OUTPUT_MINUTE = 0.032;

export type QuotaSnapshot = {
  analysesUsed: number;
  analysesLimit: number;
  renderMinutesUsed: number;
  renderMinutesLimit: number;
};

export async function readQuota(userId: string): Promise<QuotaSnapshot> {
  const [analysesUsed, renderSeconds] = await Promise.all([
    readMonthlyUsage(userId, 'analyses'),
    readMonthlyUsage(userId, 'renderSeconds'),
  ]);
  return {
    analysesUsed,
    analysesLimit: env.MAX_ANALYSES_PER_USER_MONTH,
    renderMinutesUsed: Math.round((renderSeconds / 60) * 100) / 100,
    renderMinutesLimit: env.MAX_RENDER_MINUTES_PER_USER_MONTH,
  };
}

/** Called before Stage A; cached blueprints must not consume an analysis. */
export async function assertAnalysisAllowed(userId: string): Promise<void> {
  if (env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production') {
    return;
  }
  const used = await readMonthlyUsage(userId, 'analyses');
  if (used >= env.MAX_ANALYSES_PER_USER_MONTH) {
    throw new EngineError(
      'quota_exceeded',
      'Monthly AI edit limit reached for this account',
      {used, limit: env.MAX_ANALYSES_PER_USER_MONTH},
    );
  }
}

export async function recordAnalysis(userId: string): Promise<void> {
  if (env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production') {
    return;
  }
  await incrementMonthlyUsage(userId, 'analyses', 1);
}

export async function assertRenderAllowed(
  userId: string,
  outputDurationSec: number,
): Promise<void> {
  if (env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production') {
    return;
  }
  const usedSeconds = await readMonthlyUsage(userId, 'renderSeconds');
  const limitSeconds = env.MAX_RENDER_MINUTES_PER_USER_MONTH * 60;
  if (usedSeconds + outputDurationSec > limitSeconds) {
    throw new EngineError(
      'quota_exceeded',
      'Monthly export limit reached for this account',
      {
        usedMinutes: Math.round((usedSeconds / 60) * 10) / 10,
        limitMinutes: env.MAX_RENDER_MINUTES_PER_USER_MONTH,
      },
    );
  }
}

export async function recordRender(
  userId: string,
  outputDurationSec: number,
): Promise<void> {
  if (env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production') {
    return;
  }
  await incrementMonthlyUsage(
    userId,
    'renderSeconds',
    Math.ceil(outputDurationSec),
  );
}

export function estimateRenderCostUsd(outputDurationSec: number): number {
  return (
    Math.round((outputDurationSec / 60) * LAMBDA_USD_PER_OUTPUT_MINUTE * 10_000) /
    10_000
  );
}
