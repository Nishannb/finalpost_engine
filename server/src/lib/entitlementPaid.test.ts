/**
 * Kinetic paid-subscription rule. The fixture bodies are the Creators API contract
 * (`GET /creator/internal/entitlement`): plan, verified, source. Request-time and worker-time use the same predicate.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  body: {plan: 'free', verified: true, source: 'revenuecat'} as Record<string, unknown>,
  status: 200,
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, CREATOR_API_URL: 'https://creators.test', ENGINE_API_KEY: 'engine-key', ENTITLEMENT_ENFORCEMENT: true};
  return {...actual, env: state.env};
});

import {assertActiveProEntitlement, checkFullEditForWorker, checkPaidKineticForWorker, clearEntitlementCache, hasActivePaidSubscription} from './entitlement.ts';

const PAID_PRO = {plan: 'pro', verified: true, source: 'revenuecat'};
const PAID_PLUS = {plan: 'pro_plus', verified: true, source: 'revenuecat'};
const NEPAL = {plan: 'pro', verified: true, source: 'nepal_verified'};
const FREE = {plan: 'free', verified: true, source: 'revenuecat'};
const EXPIRED = {plan: 'free', verified: true, source: 'revenuecat'};
const CANCELLED = {plan: 'free', verified: true, source: 'revenuecat'};
const UNVERIFIED = {plan: 'free', verified: false, source: 'revenuecat_error'};
const UNKNOWN_SOURCE = {plan: 'pro', verified: true, source: 'somewhere_else'};

beforeEach(() => {
  clearEntitlementCache();
  state.env.ENTITLEMENT_ENFORCEMENT = true;
  state.status = 200;
  state.body = PAID_PRO;
  globalThis.fetch = (async () => new Response(JSON.stringify({ok: true, ...state.body}), {status: state.status})) as typeof fetch;
});

describe('hasActivePaidSubscription', () => {
  it('admits only a verified RevenueCat pro or pro_plus plan', () => {
    expect(hasActivePaidSubscription(PAID_PRO)).toBe(true);
    expect(hasActivePaidSubscription(PAID_PLUS)).toBe(true);
    for (const body of [NEPAL, FREE, EXPIRED, CANCELLED, UNVERIFIED, UNKNOWN_SOURCE]) {
      expect(hasActivePaidSubscription(body)).toBe(false);
    }
  });
});

describe('request and worker share the paid rule', () => {
  it.each([
    ['paid pro', PAID_PRO, 'allow'],
    ['paid pro plus', PAID_PLUS, 'allow'],
    ['nepal verified without a purchase', NEPAL, 'deny'],
    ['free', FREE, 'deny'],
    ['expired', EXPIRED, 'deny'],
    ['cancelled', CANCELLED, 'deny'],
    ['unknown source', UNKNOWN_SOURCE, 'deny'],
    ['unverifiable', UNVERIFIED, 'unavailable'],
  ] as const)('%s', async (_name, body, worker) => {
    state.body = body;
    const request = assertActiveProEntitlement('user-1');
    if (worker === 'allow') {
      await expect(request).resolves.toBeUndefined();
    } else if (worker === 'deny') {
      await expect(request).rejects.toMatchObject({code: 'pro_required'});
    } else {
      await expect(request).rejects.toMatchObject({code: 'entitlement_unavailable'});
    }
    clearEntitlementCache();
    await expect(checkPaidKineticForWorker('user-1')).resolves.toBe(worker);
  });

  it('ENTITLEMENT_ENFORCEMENT=0 still refuses an unpaid Kinetic worker and still allows other full edits', async () => {
    state.env.ENTITLEMENT_ENFORCEMENT = false;
    state.body = NEPAL;
    await expect(checkPaidKineticForWorker('user-1')).resolves.toBe('deny');
    clearEntitlementCache();
    state.body = FREE;
    await expect(checkPaidKineticForWorker('user-1')).resolves.toBe('deny');
    await expect(checkFullEditForWorker('user-1')).resolves.toBe('allow');
  });

  it('a failed lookup fails closed for both checks', async () => {
    state.status = 503;
    await expect(assertActiveProEntitlement('user-1')).rejects.toMatchObject({code: 'entitlement_unavailable'});
    await expect(checkPaidKineticForWorker('user-1')).resolves.toBe('unavailable');
  });
});
