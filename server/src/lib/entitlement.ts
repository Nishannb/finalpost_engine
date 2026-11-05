/**
 * Server-verified plan for the authenticated creator. The plan is NEVER read from the request: it is
 * resolved by the Creators API (Supabase Nepal-verified flag + RevenueCat REST) and fetched over the same
 * service-key channel the engine already uses for notifications.
 *
 * Fail closed: when no trusted source can answer, paid work is refused with `entitlement_unavailable`.
 */

import {env} from '../config/env.ts';
import type {AuthContext} from '../http/auth.ts';
import {EngineError} from './errors.ts';
import {logger} from './logger.ts';

export type CreatorPlan = 'free' | 'pro' | 'pro_plus';
export type Entitlement = {plan: CreatorPlan; verified: boolean; source: string};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, {until: number; value: Entitlement}>();

export function planHasFullEdit(plan: CreatorPlan): boolean {
  return plan === 'pro' || plan === 'pro_plus';
}

export function clearEntitlementCache(): void {
  cache.clear();
}

/** Plan lookup for a creator id (the verified JWT `sub`). Cached briefly; never throws. */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) {
    return hit.value;
  }
  const base = env.CREATOR_API_URL.replace(/\/+$/, '');
  if (!base || !env.ENGINE_API_KEY) {
    return {plan: 'free', verified: false, source: 'creator_api_unconfigured'};
  }
  try {
    const response = await fetch(`${base}/creator/internal/entitlement?userId=${encodeURIComponent(userId)}`, {
      headers: {Accept: 'application/json', 'x-engine-key': env.ENGINE_API_KEY},
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn({status: response.status}, 'entitlement lookup failed');
      return {plan: 'free', verified: false, source: 'creator_api_error'};
    }
    const body = (await response.json()) as Partial<Entitlement>;
    const plan: CreatorPlan = body.plan === 'pro' || body.plan === 'pro_plus' ? body.plan : 'free';
    const value: Entitlement = {plan, verified: body.verified === true, source: String(body.source ?? 'creator_api')};
    // Only a verified answer is held for a minute; an unverifiable one is retried on the next request.
    if (value.verified) {
      cache.set(userId, {until: Date.now() + CACHE_TTL_MS, value});
    }
    return value;
  } catch (error) {
    logger.warn({error}, 'entitlement lookup error');
    return {plan: 'free', verified: false, source: 'creator_api_error'};
  }
}

/**
 * Refuses unless the creator has a server-verified Pro / Pro Plus plan.
 *  - `service-key` callers are the trusted internal Python API: allowed.
 *  - `dev` auth (never active in production) is allowed.
 *  - ENTITLEMENT_ENFORCEMENT=0 is an explicit local-development switch.
 */
export async function assertFullEditEntitlement(auth: Pick<AuthContext, 'userId' | 'via'>): Promise<void> {
  if (!env.ENTITLEMENT_ENFORCEMENT || auth.via === 'service-key' || auth.via === 'dev') {
    return;
  }
  const entitlement = await resolveEntitlement(auth.userId);
  if (planHasFullEdit(entitlement.plan)) {
    return;
  }
  if (!entitlement.verified) {
    throw new EngineError('entitlement_unavailable', 'We could not confirm your FinalPost plan right now. Try again in a moment.', {
      reason: entitlement.source,
    });
  }
  throw new EngineError('pro_required', 'FinalPost Pro is required for the full AI edit.');
}

/**
 * Same check for a job worker that only has the creator id (no request): used right before expensive work
 * starts. `unavailable` means no trusted source answered (the worker fails the job as retryable, it never guesses).
 */
export async function checkFullEditForWorker(userId: string): Promise<'allow' | 'deny' | 'unavailable'> {
  if (!env.ENTITLEMENT_ENFORCEMENT) {
    return 'allow';
  }
  const entitlement = await resolveEntitlement(userId);
  if (planHasFullEdit(entitlement.plan)) {
    return 'allow';
  }
  return entitlement.verified ? 'deny' : 'unavailable';
}
