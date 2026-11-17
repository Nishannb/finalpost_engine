/**
 * V1 Kinetic access over HTTP: POST /v1/edits/captions, GET /v1/edit-styles, POST /v1/edits/:id/retry and /assets, with the REAL express routes, the REAL entitlement guard and the REAL
 * access policy (lib/kineticAccess.ts). The plan comes from a fake Creators API (no network); the edit runner is mocked and records what it was asked to do.
 * Synthetic ids only (00000000-…). Nothing here reads a secret or a real account.
 */
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';

import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  plans: new Map<string, {plan: string; verified: boolean; source?: string}>(),
  lookups: [] as string[],
  created: [] as Array<Record<string, unknown>>,
  retried: [] as Array<Record<string, unknown>>,
  assets: [] as Array<Record<string, unknown>>,
  jobs: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, CREATOR_API_URL: 'https://creators.test', ENGINE_API_KEY: 'engine-key', ENTITLEMENT_ENFORCEMENT: true};
  return {...actual, env: state.env};
});
vi.mock('../pipeline/captionsEditRunner.ts', () => ({
  createCaptionsEditJob: async (input: Record<string, unknown>) => {
    state.created.push(input);
    const job = {editJobId: `ed_${state.created.length}`, userId: input.userId, status: 'awaiting_upload', mode: input.mode ?? 'captions', style: input.style};
    state.jobs.set(job.editJobId, job);
    return {job, uploadUrl: 'https://up'};
  },
  loadCaptionsEditJob: async (id: string) => state.jobs.get(id) ?? null,
  markCaptionsSourceUploaded: async (id: string) => state.jobs.get(id),
  submitFullEditAssets: async (input: Record<string, unknown>) => { state.assets.push(input); return {editJobId: input.editJobId}; },
  retryFullEdit: async (input: Record<string, unknown>) => { state.retried.push(input); return {editJobId: input.editJobId, status: 'analyzing'}; },
  redeliverCallbacks: async () => 0,
}));

import express from 'express';

import {clearEntitlementCache} from '../lib/entitlement.ts';
import {toEngineError} from '../lib/errors.ts';
import {logger} from '../lib/logger.ts';
import {editRoutes} from '../http/routes/editRoutes.ts';

const LISTED_PRO = '00000000-0000-4000-8000-000000000001';
const SECOND_LISTED = '00000000-0000-4000-8000-000000000002';
const OUTSIDE_PRO = '00000000-0000-4000-8000-000000000003';
const NEPAL_PRO = '00000000-0000-4000-8000-000000000004';
const LISTED_FREE = '00000000-0000-4000-8000-000000000005';
const FREE = '00000000-0000-4000-8000-000000000006';
const EXPIRED = '00000000-0000-4000-8000-000000000007';
const CANCELLED = '00000000-0000-4000-8000-000000000008';
const ALL_IDS = [LISTED_PRO, SECOND_LISTED, OUTSIDE_PRO, NEPAL_PRO, LISTED_FREE, FREE, EXPIRED, CANCELLED];

const BASE = {contentType: 'video/mp4', languageCode: 'en'};
const PRO_KINETIC = {...BASE, style: 'kinetic_typography', mode: 'full_edit', captionTemplate: 'basic', footageKind: 'camera', captionPreset: 'punchline'};
const BASIC = {...BASE, mode: 'basic_captions', style: 'basic_captions', captionPreset: 'spotlight', captionTemplate: 'karaoke', footageKind: 'camera'};

let server: Server;
let base = '';
const realFetch = globalThis.fetch;
const logged: string[] = [];

const post = (path: string, user: string, body: unknown, via = 'supabase-jwt') =>
  realFetch(`${base}${path}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-test-user': user, 'x-test-via': via}, body: JSON.stringify(body)});
const get = (path: string, user: string, via = 'supabase-jwt') => realFetch(`${base}${path}`, {headers: {'x-test-user': user, 'x-test-via': via}});
const bodyOf = async (response: Response) => (await response.json()) as Record<string, unknown> & {code?: string; styles?: Array<Record<string, unknown>>; job?: Record<string, unknown>};

const configure = (cfg: {release?: boolean; nodeEnv?: string; mode?: string; ids?: string}) => {
  Object.assign(state.env, {V1_KINETIC_RELEASE: cfg.release ?? true, NODE_ENV: cfg.nodeEnv ?? 'production', V1_KINETIC_ACCESS: cfg.mode ?? '', V1_KINETIC_ALLOWED_USER_IDS: cfg.ids ?? ''});
};
const allowlist = (...ids: string[]) => configure({mode: 'allowlist', ids: ids.join(',')});

beforeAll(async () => {
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    const original = logger[level].bind(logger);
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
      return (original as (...a: unknown[]) => void)(...args);
    }) as never);
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.auth = {userId: String(req.headers['x-test-user']), via: String(req.headers['x-test-via'] ?? 'supabase-jwt')};
    next();
  });
  app.use('/v1', editRoutes);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = toEngineError(error);
    res.status(e.status).json(e.toJSON());
  });
  await new Promise<void>(resolve => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearEntitlementCache();
  Object.assign(state.env, {ENTITLEMENT_ENFORCEMENT: true, EDIT_STYLES_ENABLED: true, EDIT_STYLES_AVAILABLE: '', EDIT_STYLES_ORDER: '', EDIT_STYLES_ENGINE_FLAGS: true});
  configure({});
  state.created.length = 0;
  state.retried.length = 0;
  state.assets.length = 0;
  state.lookups.length = 0;
  state.jobs.clear();
  logged.length = 0;
  state.plans.clear();
  state.plans.set(LISTED_PRO, {plan: 'pro', verified: true, source: 'revenuecat'});
  state.plans.set(SECOND_LISTED, {plan: 'pro', verified: true, source: 'revenuecat'});
  state.plans.set(OUTSIDE_PRO, {plan: 'pro', verified: true, source: 'revenuecat'});
  state.plans.set(NEPAL_PRO, {plan: 'pro', verified: true, source: 'nepal_verified'});
  state.plans.set(LISTED_FREE, {plan: 'free', verified: true, source: 'revenuecat'});
  state.plans.set(FREE, {plan: 'free', verified: true, source: 'revenuecat'});
  // Flask collapses an expired entitlement and a cancelled entitlement past its period to the same verified free answer.
  state.plans.set(EXPIRED, {plan: 'free', verified: true, source: 'revenuecat'});
  state.plans.set(CANCELLED, {plan: 'free', verified: true, source: 'revenuecat'});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://creators.test/creator/internal/entitlement')) {
      const userId = new URL(url).searchParams.get('userId') ?? '';
      state.lookups.push(userId);
      return new Response(JSON.stringify({ok: true, ...(state.plans.get(userId) ?? {plan: 'free', verified: true})}), {status: 200});
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const expectNoIds = (extra: unknown[] = []) => {
  const haystack = JSON.stringify([logged, extra]);
  for (const id of ALL_IDS) expect(haystack, `an account id leaked (${id.slice(-2)})`).not.toContain(id);
};
const refused = async (response: Response) => {
  expect(response.status).toBe(503);
  const body = await bodyOf(response);
  expect(body.code).toBe('kinetic_unavailable');
  return body;
};

describe('POST /v1/edits/captions (Kinetic)', () => {
  it('an allowlisted Pro account starts Kinetic', async () => {
    allowlist(LISTED_PRO, SECOND_LISTED);
    const response = await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC);
    expect(response.status).toBe(202);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({userId: LISTED_PRO, style: 'kinetic_typography'});
    expect(state.lookups).toEqual([LISTED_PRO]); // Pro is still verified for the account
  });

  it('a Pro account that is NOT on the list is refused with the generic error, before any plan lookup, and nothing is created', async () => {
    allowlist(LISTED_PRO);
    const body = await refused(await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC));
    expect(JSON.stringify(body)).toContain('kinetic_access');
    expect(state.created).toHaveLength(0);
    expect(state.lookups).toEqual([]);
  });

  it('a NON-Pro account that is on the list is still refused by entitlement (being listed never grants Pro)', async () => {
    allowlist(LISTED_FREE);
    const response = await post('/v1/edits/captions', LISTED_FREE, PRO_KINETIC);
    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).not.toBe('kinetic_unavailable');
    expect(state.lookups).toEqual([LISTED_FREE]);
    expect(state.created).toHaveLength(0);
  });

  it('a Nepal-verified Pro account outside the list is refused (Pro without a purchase is not access)', async () => {
    allowlist(LISTED_PRO);
    await refused(await post('/v1/edits/captions', NEPAL_PRO, PRO_KINETIC));
    expect(state.created).toHaveLength(0);
  });

  it('a Nepal-verified Pro account that IS on the list is admitted', async () => {
    allowlist(NEPAL_PRO);
    expect((await post('/v1/edits/captions', NEPAL_PRO, PRO_KINETIC)).status).toBe(202);
  });

  it.each([
    ['allowlist mode with the list missing', {mode: 'allowlist'}],
    ['allowlist mode with an empty list', {mode: 'allowlist', ids: ''}],
    ['access mode missing entirely (production)', {}],
    ['access mode missing with a list present', {ids: LISTED_PRO}],
    ['a malformed UUID', {mode: 'allowlist', ids: 'not-a-uuid'}],
    ['one malformed entry among valid entries', {mode: 'allowlist', ids: `${LISTED_PRO},${SECOND_LISTED.slice(0, -2)},${OUTSIDE_PRO}`}],
    ['an unknown access mode', {mode: 'everyone', ids: LISTED_PRO}],
    ['explicit global access in PRODUCTION', {mode: 'all', ids: LISTED_PRO}],
  ])('%s: nobody can start Kinetic, not even a listed Pro account', async (_name, cfg) => {
    configure({...cfg});
    for (const user of [LISTED_PRO, OUTSIDE_PRO, NEPAL_PRO]) await refused(await post('/v1/edits/captions', user, PRO_KINETIC));
    expect(state.created).toHaveLength(0);
    expectNoIds();
  });

  it('explicit global access outside production works (for development and tests); a Pro account is still required', async () => {
    configure({nodeEnv: 'test', mode: 'all'});
    expect((await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC)).status).toBe(202);
    expect((await post('/v1/edits/captions', FREE, PRO_KINETIC)).status).toBe(403);
  });

  it('with no access settings outside production Kinetic is ALSO refused (no environment defaults to global access)', async () => {
    configure({nodeEnv: 'development'});
    await refused(await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC));
  });

  it('the dev auth path gets no exemption: with the allowlist on, a non-listed dev identity is refused', async () => {
    allowlist(LISTED_PRO);
    await refused(await post('/v1/edits/captions', 'dev-user', PRO_KINETIC, 'dev'));
    await refused(await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC, 'service-key'));
    expect((await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC, 'service-key')).status).toBe(202); // the account the service key acts for is the one checked
  });

  it('the access gate only applies while the V1 release is on (release off: the existing 503 gate-off refusal, unchanged)', async () => {
    configure({release: false, mode: 'allowlist', ids: LISTED_PRO});
    const body = await refused(await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC));
    expect(JSON.stringify(body)).toContain('v1_release_off');
  });
});

describe('Free Basic Captions are unaffected', () => {
  it.each([
    ['allowlist without the account', {mode: 'allowlist', ids: LISTED_PRO}],
    ['no configuration at all', {}],
    ['invalid configuration', {mode: 'allowlist', ids: 'oops'}],
    ['global access in production (invalid)', {mode: 'all'}],
    ['an unknown mode', {mode: 'nope'}],
    ['entitlement mode', {mode: 'entitlement'}],
  ])('%s: a Free account starts Basic Captions, no entitlement lookup', async (_name, cfg) => {
    configure({...cfg});
    const response = await post('/v1/edits/captions', FREE, BASIC);
    expect(response.status).toBe(202);
    expect(state.created[0]).toMatchObject({mode: 'basic_captions', style: 'basic_captions'});
    expect(state.lookups).toEqual([]);
  });
  it('an older Free app (mode only, no style) still starts with the release on and no access settings', async () => {
    configure({});
    expect((await post('/v1/edits/captions', FREE, {...BASE, mode: 'basic_captions', captionPreset: 'punchline'})).status).toBe(202);
  });
});

describe('GET /v1/edit-styles', () => {
  const kinetic = async (user: string) => ((await bodyOf(await get('/v1/edit-styles', user))).styles ?? []).find(s => s.id === 'kinetic_typography');
  it('marks Kinetic available only for accounts that may start it; Basic Captions stay available for everyone', async () => {
    allowlist(LISTED_PRO);
    expect(await kinetic(LISTED_PRO)).toMatchObject({available: true, locked: false});
    expect(await kinetic(OUTSIDE_PRO)).toMatchObject({available: false});
    expect(await kinetic(NEPAL_PRO)).toMatchObject({available: false});
    const styles = ((await bodyOf(await get('/v1/edit-styles', FREE))).styles ?? []).map(s => [s.id, s.available]);
    expect(styles).toContainEqual(['basic_captions', true]);
  });
  it('invalid or missing configuration: Kinetic unavailable for everyone, Basic Captions still listed', async () => {
    for (const cfg of [{}, {mode: 'allowlist'}, {mode: 'allowlist', ids: `${LISTED_PRO},bad`}, {mode: 'all'}]) {
      configure(cfg);
      expect(await kinetic(LISTED_PRO)).toMatchObject({available: false});
      const styles = ((await bodyOf(await get('/v1/edit-styles', LISTED_PRO))).styles ?? []).map(s => s.id);
      expect(styles).toContain('basic_captions');
    }
  });
  it('a listed account that is not Pro sees Kinetic available but locked (the plan lock is unchanged)', async () => {
    allowlist(LISTED_FREE);
    expect(await kinetic(LISTED_FREE)).toMatchObject({available: true, locked: true});
  });
});

describe('POST /v1/edits/:id/retry and /assets for an existing Kinetic job', () => {
  it('retry works while the owner has access', async () => {
    allowlist(LISTED_PRO);
    const created = await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC);
    const jobId = String((await bodyOf(created)).job?.editJobId);
    expect((await post(`/v1/edits/${jobId}/retry`, LISTED_PRO, {})).status).toBe(202);
    expect(state.retried).toEqual([{editJobId: jobId, userId: LISTED_PRO}]);
  });

  it('retry of a previously created Kinetic job is REFUSED once access is revoked (list changed, emptied or malformed): no retry reaches the runner', async () => {
    allowlist(LISTED_PRO);
    const jobId = String((await bodyOf(await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC))).job?.editJobId);
    for (const revoke of [() => allowlist(SECOND_LISTED), () => configure({mode: 'allowlist', ids: ''}), () => configure({mode: 'allowlist', ids: `${LISTED_PRO},bad`}), () => configure({})]) {
      revoke();
      await refused(await post(`/v1/edits/${jobId}/retry`, LISTED_PRO, {}));
    }
    expect(state.retried).toHaveLength(0);
    expectNoIds();
  });

  it('asset submission for an existing Kinetic job follows the same rule', async () => {
    allowlist(LISTED_PRO);
    const jobId = String((await bodyOf(await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC))).job?.editJobId);
    expect((await post(`/v1/edits/${jobId}/assets`, LISTED_PRO, {skipAll: true})).status).toBe(202);
    allowlist(SECOND_LISTED);
    await refused(await post(`/v1/edits/${jobId}/assets`, LISTED_PRO, {skipAll: true}));
    expect(state.assets).toHaveLength(1);
  });

  it('retry of a Basic Captions job is unaffected, and a Free account still cannot use the Pro retry route (403, unchanged)', async () => {
    configure({mode: 'allowlist', ids: LISTED_PRO});
    state.jobs.set('ed_basic', {editJobId: 'ed_basic', userId: LISTED_PRO, mode: 'full_edit', style: 'basic_captions'});
    expect((await post('/v1/edits/ed_basic/retry', LISTED_PRO, {})).status).toBe(202);
    expect((await post('/v1/edits/ed_basic/retry', FREE, {})).status).toBe(403);
  });

  it('another account\'s job, or an unknown job, falls through to the route\'s normal handling (the access check adds no new existence oracle)', async () => {
    allowlist(LISTED_PRO);
    const jobId = String((await bodyOf(await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC))).job?.editJobId);
    allowlist(SECOND_LISTED);
    expect((await post(`/v1/edits/${jobId}/retry`, SECOND_LISTED, {})).status).toBe(202); // the mocked runner decides ownership; the access check did not interfere
    expect(state.retried).toEqual([{editJobId: jobId, userId: SECOND_LISTED}]);
  });
});

describe('V1_KINETIC_ACCESS=entitlement (production)', () => {
  const entitlement = (ids = 'not-a-uuid') => configure({mode: 'entitlement', ids});

  it('an active paid pro or pro_plus subscription can start Kinetic, and the UUID list is ignored', async () => {
    entitlement(`${LISTED_PRO},not-a-uuid`);
    state.plans.set(SECOND_LISTED, {plan: 'pro_plus', verified: true, source: 'revenuecat'});
    for (const user of [LISTED_PRO, SECOND_LISTED, OUTSIDE_PRO]) {
      expect((await post('/v1/edits/captions', user, PRO_KINETIC)).status).toBe(202);
    }
    expect(state.created.map(job => job.userId)).toEqual([LISTED_PRO, SECOND_LISTED, OUTSIDE_PRO]);
    expect(state.lookups).toEqual([LISTED_PRO, SECOND_LISTED, OUTSIDE_PRO]);
  });

  it('a Nepal-verified account without a paid subscription is refused', async () => {
    entitlement();
    const response = await post('/v1/edits/captions', NEPAL_PRO, PRO_KINETIC);
    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).toBe('pro_required');
    expect(state.created).toHaveLength(0);
    expect(state.lookups).toEqual([NEPAL_PRO]);
  });

  it('expired and cancelled subscriptions are refused', async () => {
    entitlement();
    for (const user of [EXPIRED, CANCELLED]) {
      const response = await post('/v1/edits/captions', user, PRO_KINETIC);
      expect(response.status).toBe(403);
      expect((await bodyOf(response)).code).toBe('pro_required');
    }
    expect(state.created).toHaveLength(0);
  });

  it('a verified Free account is refused with pro_required, and nothing is created', async () => {
    entitlement();
    const response = await post('/v1/edits/captions', FREE, PRO_KINETIC);
    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).toBe('pro_required');
    expect(state.created).toHaveLength(0);
    expect(state.lookups).toEqual([FREE]);
  });

  it('a listed Free account is still refused: the UUID list never grants Pro', async () => {
    entitlement(LISTED_FREE);
    const response = await post('/v1/edits/captions', LISTED_FREE, PRO_KINETIC);
    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).toBe('pro_required');
    expect(state.created).toHaveLength(0);
  });

  it('a failed plan lookup fails closed with entitlement_unavailable', async () => {
    entitlement();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://creators.test/creator/internal/entitlement')) {
        state.lookups.push('down');
        return new Response('no', {status: 503});
      }
      return realFetch(input, init);
    }) as typeof fetch;
    const response = await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC);
    expect(response.status).toBe(503);
    expect((await bodyOf(response)).code).toBe('entitlement_unavailable');
    expect(state.created).toHaveLength(0);
  });

  it('service-key and dev callers get no bypass: the account they act for must be Pro', async () => {
    entitlement();
    expect((await post('/v1/edits/captions', FREE, PRO_KINETIC, 'service-key')).status).toBe(403);
    expect((await post('/v1/edits/captions', 'dev-user', PRO_KINETIC, 'dev')).status).toBe(403);
    expect((await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC, 'service-key')).status).toBe(202);
    expect((await post('/v1/edits/captions', NEPAL_PRO, PRO_KINETIC, 'dev')).status).toBe(403);
    expect(state.created.map(job => job.userId)).toEqual([OUTSIDE_PRO]);
  });

  it('ENTITLEMENT_ENFORCEMENT=0 does not open Kinetic to a Free account', async () => {
    entitlement();
    state.env.ENTITLEMENT_ENFORCEMENT = false;
    const response = await post('/v1/edits/captions', FREE, PRO_KINETIC);
    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).toBe('pro_required');
    expect(state.lookups).toEqual([FREE]);
    expect(state.created).toHaveLength(0);
  });

  it('the catalog lists Kinetic for everyone and locks it unless the subscription is paid', async () => {
    entitlement();
    const kinetic = async (user: string) => ((await bodyOf(await get('/v1/edit-styles', user))).styles ?? []).find(s => s.id === 'kinetic_typography');
    expect(await kinetic(OUTSIDE_PRO)).toMatchObject({available: true, locked: false});
    expect(await kinetic(NEPAL_PRO)).toMatchObject({available: true, locked: true});
    expect(await kinetic(FREE)).toMatchObject({available: true, locked: true});
    expect(await kinetic(EXPIRED)).toMatchObject({available: true, locked: true});
    expect(await kinetic(CANCELLED)).toMatchObject({available: true, locked: true});
    expect(await kinetic(LISTED_FREE)).toMatchObject({available: true, locked: true});
  });

  it('retry and assets follow the current plan, not a UUID list', async () => {
    entitlement();
    const jobId = String((await bodyOf(await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC))).job?.editJobId);
    expect((await post(`/v1/edits/${jobId}/retry`, OUTSIDE_PRO, {})).status).toBe(202);
    expect((await post(`/v1/edits/${jobId}/assets`, OUTSIDE_PRO, {skipAll: true})).status).toBe(202);
    state.plans.set(OUTSIDE_PRO, {plan: 'free', verified: true, source: 'revenuecat'});
    clearEntitlementCache();
    const retry = await post(`/v1/edits/${jobId}/retry`, OUTSIDE_PRO, {});
    expect(retry.status).toBe(403);
    expect((await bodyOf(retry)).code).toBe('pro_required');
    const assets = await post(`/v1/edits/${jobId}/assets`, OUTSIDE_PRO, {skipAll: true});
    expect(assets.status).toBe(403);
    expect(state.retried).toHaveLength(1);
    expect(state.assets).toHaveLength(1);
  });

  it('`all` is still refused in production', async () => {
    configure({mode: 'all'});
    await refused(await post('/v1/edits/captions', OUTSIDE_PRO, PRO_KINETIC));
    expect(state.created).toHaveLength(0);
  });
});

describe('no identifiers in logs or responses', () => {
  it('refusals, allowed requests and the catalog never expose an account id', async () => {
    allowlist(LISTED_PRO, SECOND_LISTED);
    const responses: unknown[] = [];
    for (const user of [OUTSIDE_PRO, NEPAL_PRO, LISTED_PRO, FREE]) {
      const r = await post('/v1/edits/captions', user, PRO_KINETIC);
      // a successful create returns the caller's own job (existing behaviour, not part of this change): only its status is recorded here
      responses.push(r.status, r.status === 202 ? 'accepted' : await r.json());
    }
    for (const user of [OUTSIDE_PRO, LISTED_PRO]) responses.push(await (await get('/v1/edit-styles', user)).json());
    configure({mode: 'allowlist', ids: `${LISTED_PRO},bad`});
    responses.push(await (await post('/v1/edits/captions', LISTED_PRO, PRO_KINETIC)).json());
    expect(logged.some(line => line.includes('kinetic access refused'))).toBe(true); // the refusals are logged...
    expectNoIds(responses); // ...without any id, and no response body carries one
    // and nothing in the log lines names the configured list either
    expect(logged.join('\n')).not.toMatch(/00000000-0000-4000-8000-0000000000/);
  });
});
