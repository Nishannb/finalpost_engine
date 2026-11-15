import {describe, expect, it, vi} from 'vitest';

vi.mock('../../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  return {...actual, env: {...actual.env, REDIS_URL: '', DEV_AUTH_BYPASS: false, NODE_ENV: 'test'}};
});

import {readMonthlyUsage} from '../../store/engineStore.ts';
import {recordRender, refundFailedRender} from './renderBudget.ts';

describe('render usage: metered at start, returned once when the render fails', () => {
  it('a failed render is refunded exactly once, however many times the failure is observed; a retry is metered afresh', async () => {
    const u = 'refund-user';
    await recordRender(u, 43.292);
    expect(await readMonthlyUsage(u, 'renderSeconds')).toBe(44);
    expect(await refundFailedRender(u, 'rn_a', 43.292)).toBe(true);
    expect(await refundFailedRender(u, 'rn_a', 43.292)).toBe(false);
    expect(await refundFailedRender(u, 'rn_a', 43.292)).toBe(false);
    expect(await readMonthlyUsage(u, 'renderSeconds')).toBe(0);
    await recordRender(u, 43.292); // the retry's render
    expect(await readMonthlyUsage(u, 'renderSeconds')).toBe(44);
  });
  it('concurrent observers of one failure refund once', async () => {
    const u = 'refund-user-2';
    await recordRender(u, 10);
    const results = await Promise.all([1, 2, 3, 4].map(() => refundFailedRender(u, 'rn_b', 10)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readMonthlyUsage(u, 'renderSeconds')).toBe(0);
  });
});
