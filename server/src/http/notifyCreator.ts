/**
 * Ask the Creators Flask API to send a remote push when a captions edit
 * finishes. The engine never talks to APNs/FCM itself.
 */

import {env} from '../config/env.ts';
import {logger} from '../lib/logger.ts';

export async function notifyCreatorEditDone(input: {
  userId: string;
  editJobId: string;
  status: 'done' | 'failed';
  outputUrl?: string;
  errorMessage?: string;
}): Promise<void> {
  const base = env.CREATOR_API_URL.replace(/\/+$/, '');
  if (!base) {
    logger.info(
      {editJobId: input.editJobId},
      'skip edit-done notify — CREATOR_API_URL unset',
    );
    return;
  }
  if (!env.ENGINE_API_KEY) {
    logger.warn(
      {editJobId: input.editJobId},
      'skip edit-done notify — ENGINE_API_KEY unset',
    );
    return;
  }

  const url = `${base}/creator/internal/edit-done`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-engine-key': env.ENGINE_API_KEY,
      },
      body: JSON.stringify({
        userId: input.userId,
        editJobId: input.editJobId,
        status: input.status,
        ...(input.outputUrl ? {outputUrl: input.outputUrl} : {}),
        ...(input.errorMessage ? {errorMessage: input.errorMessage} : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(
        {
          editJobId: input.editJobId,
          status: response.status,
          body: text.slice(0, 240),
        },
        'edit-done notify failed',
      );
    }
  } catch (error) {
    logger.warn({editJobId: input.editJobId, error}, 'edit-done notify error');
  }
}
