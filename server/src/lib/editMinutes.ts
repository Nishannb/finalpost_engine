/**
 * Pro edit minutes ("coins"): 1 coin = 1 minute of finished paid edit video, 45 per monthly billing period that restarts when the
 * subscription renews (Creators API owns the balance and the ledger: kinmel-server-production creator/edit_minutes.py).
 *
 *  - Start: a new paid edit (create / retry) is refused with `edit_minutes_exhausted` when the balance is 0. Soft check only: a job
 *    already running finishes and is charged. A balance that cannot be read does NOT block (a metering outage must not lock out a
 *    creator the entitlement check already verified as Pro).
 *  - Charge: the `done` completion callback carries `billable: true` + `outputDurationSec` for paid modes; the Creators API charges
 *    the exact `outputDurationSec / 60` (2 decimals: 1 min 23 s = 1.38) once per editJobId, published or not (idempotent ledger), so callback redelivery never double-charges.
 *  - Basic Captions are never checked and never billable.
 */

import {env} from '../config/env.ts';
import type {AuthContext} from '../http/auth.ts';
import {EngineError} from './errors.ts';
import {logger} from './logger.ts';

export type EditMinutesBalance = {pointsRemaining: number; pointsLimit: number; usageMonth: string};

/** A paid (metered) edit: every mode except Free Basic Captions. */
export function isBillableEditMode(mode: string | undefined | null): boolean {
  return (mode ?? '') !== 'basic_captions';
}

/** Balance from the Creators API, or null when it cannot be read. Never throws. */
export async function fetchEditMinutesBalance(userId: string): Promise<EditMinutesBalance | null> {
  const base = env.CREATOR_API_URL.replace(/\/+$/, '');
  if (!base || !env.ENGINE_API_KEY) {
    return null;
  }
  try {
    const response = await fetch(`${base}/creator/internal/edit-minutes?userId=${encodeURIComponent(userId)}`, {
      headers: {Accept: 'application/json', 'x-engine-key': env.ENGINE_API_KEY},
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn({status: response.status}, 'edit minutes lookup failed');
      return null;
    }
    const body = (await response.json()) as Partial<EditMinutesBalance>;
    if (typeof body.pointsRemaining !== 'number' || !Number.isFinite(body.pointsRemaining)) {
      return null;
    }
    return {pointsRemaining: body.pointsRemaining, pointsLimit: Number(body.pointsLimit ?? 45), usageMonth: String(body.usageMonth ?? '')};
  } catch (error) {
    logger.warn({error}, 'edit minutes lookup error');
    return null;
  }
}

/** Refuses a new paid edit when this month's minutes are used up. Same exemptions as assertFullEditEntitlement except service-key callers. */
export async function assertEditMinutesAvailable(auth: Pick<AuthContext, 'userId' | 'via'>): Promise<void> {
  if (!env.ENTITLEMENT_ENFORCEMENT || auth.via === 'dev') {
    return;
  }
  const balance = await fetchEditMinutesBalance(auth.userId);
  if (balance && balance.pointsRemaining <= 0) {
    throw new EngineError('edit_minutes_exhausted', `You've used your ${balance.pointsLimit} edit minutes for this month. They renew when your subscription renews.`, {
      pointsRemaining: 0,
      pointsLimit: balance.pointsLimit,
      usageMonth: balance.usageMonth,
    });
  }
}
