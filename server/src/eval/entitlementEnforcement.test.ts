/**
 * Server-side plan enforcement. The plan is resolved by the Creators API (mocked here as a fake `fetch`) and is
 * never read from the request. Real express routes + the real guard; the edit runner and the engine pipelines are mocked.
 */
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';

import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  plans: new Map<string, {plan: string; verified: boolean; source?: string}>(),
  lookups: [] as string[],
  created: [] as Array<Record<string, unknown>>,
  submitted: [] as Array<Record<string, unknown>>,
  jobs: new Map<string, {editJobId: string; userId: string; mode: string; status: string; outputUrl?: string}>(),
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, CREATOR_API_URL: 'https://creators.test', ENGINE_API_KEY: 'engine-key', ENTITLEMENT_ENFORCEMENT: true};
  return {...actual, env: state.env};
});
vi.mock('../pipeline/captionsEditRunner.ts', () => ({
  createCaptionsEditJob: async (input: Record<string, unknown>) => {
    state.created.push(input);
    return {job: {editJobId: 'ed_new', sourcePublicUrl: 'https://cdn/src.mp4', sourceKey: 'k'}, uploadUrl: 'https://up'};
  },
  loadCaptionsEditJob: async (id: string) => state.jobs.get(id) ?? null,
  markCaptionsSourceUploaded: async (id: string) => state.jobs.get(id),
  submitFullEditAssets: async (input: Record<string, unknown>) => {
    state.submitted.push(input);
    return {editJobId: input.editJobId, status: 'analyzing'};
  },
  retryFullEdit: async (input: Record<string, unknown>) => ({editJobId: input.editJobId, status: 'rendering'}),
}));
vi.mock('../pipeline/analysisRunner.ts', () => ({startAnalysis: async () => ({analysisJobId: 'an_1'})}));
vi.mock('../pipeline/renderRunner.ts', () => ({
  startRender: async () => ({renderJobId: 'r_1'}),
  loadRenderJob: async () => null,
  refreshRenderJob: async (job: unknown) => job,
  renderAvailable: () => true,
}));

import express from 'express';

import {clearEntitlementCache} from '../lib/entitlement.ts';
import {toEngineError} from '../lib/errors.ts';
import {analyzeRoutes} from '../http/routes/analyzeRoutes.ts';
import {editRoutes} from '../http/routes/editRoutes.ts';
import {renderRoutes} from '../http/routes/renderRoutes.ts';
import {brollLibraryRoutes} from '../http/routes/brollLibraryRoutes.ts';
import {createMattingRoutes} from '../http/routes/mattingRoutes.ts';
import {templateRoutes} from '../http/routes/templateRoutes.ts';

let server: Server;
let base = '';
const realFetch = globalThis.fetch;

function post(path: string, user: string, body: unknown, headers: Record<string, string> = {}, via = 'supabase-jwt') {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-test-user': user, 'x-test-via': via, ...headers},
    body: JSON.stringify(body),
  });
}
const get = (path: string, user: string) => realFetch(`${base}${path}`, {headers: {'x-test-user': user}});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stands in for requireAuth: the verified identity comes from the (test) token, never from the plan.
  app.use((req, res, next) => {
    res.locals.auth = {userId: String(req.headers['x-test-user']), via: String(req.headers['x-test-via'] ?? 'supabase-jwt')};
    next();
  });
  app.use('/v1', editRoutes);
  app.use('/v1', analyzeRoutes);
  app.use('/v1', renderRoutes);
  app.use('/v1', brollLibraryRoutes);
  app.use('/v1', createMattingRoutes());
  app.use('/v1', templateRoutes);
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
});

beforeEach(() => {
  clearEntitlementCache();
  state.env.ENTITLEMENT_ENFORCEMENT = true;
  state.created.length = 0;
  state.submitted.length = 0;
  state.lookups.length = 0;
  state.jobs.clear();
  state.plans.clear();
  state.plans.set('free-user', {plan: 'free', verified: true, source: 'revenuecat'});
  state.plans.set('pro-user', {plan: 'pro', verified: true, source: 'revenuecat'});
  state.plans.set('plus-user', {plan: 'pro_plus', verified: true, source: 'revenuecat'});
  state.plans.set('nepal-user', {plan: 'pro', verified: true, source: 'nepal_verified'});
  state.plans.set('unverified-user', {plan: 'free', verified: false, source: 'revenuecat_unconfigured'});
  // The Creators API is the only thing that answers entitlement lookups; everything else is the real network.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://creators.test/creator/internal/entitlement')) {
      const userId = new URL(url).searchParams.get('userId') ?? '';
      state.lookups.push(userId);
      expect((init?.headers as Record<string, string>)['x-engine-key']).toBe('engine-key');
      const plan = state.plans.get(userId) ?? {plan: 'free', verified: true};
      return new Response(JSON.stringify({ok: true, ...plan}), {status: 200});
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const FULL = {mode: 'full_edit', contentType: 'video/mp4', languageCode: 'en'};

describe('full AI editing needs a server-verified Pro / Pro Plus plan', () => {
  it('free creators cannot start a full edit', async () => {
    const response = await post('/v1/edits/captions', 'free-user', FULL);
    expect(response.status).toBe(403);
    expect(((await response.json()) as {code: string}).code).toBe('pro_required');
    expect(state.created).toHaveLength(0);
  });

  it('Pro and Pro Plus creators can', async () => {
    for (const user of ['pro-user', 'plus-user', 'nepal-user']) {
      const response = await post('/v1/edits/captions', user, FULL);
      expect(response.status, user).toBe(202);
    }
    expect(state.created.map(c => c.mode)).toEqual(['full_edit', 'full_edit', 'full_edit']);
  });

  it('free creators keep the basic captions path', async () => {
    const response = await post('/v1/edits/captions', 'free-user', {mode: 'basic_captions', contentType: 'video/mp4', languageCode: 'en'});
    expect(response.status).toBe(202);
    expect(state.created[0]!.mode).toBe('basic_captions');
    expect(state.lookups).toEqual([]); // basic captions never needs a plan lookup
  });

  it('every other edit mode (captions with cuts, teleprompter clean, no mode at all) is Pro only', async () => {
    for (const body of [
      {contentType: 'video/mp4', languageCode: 'en'},
      {mode: 'captions', contentType: 'video/mp4', languageCode: 'en'},
      {mode: 'teleprompter_clean', contentType: 'video/mp4', languageCode: 'en'},
    ]) {
      expect((await post('/v1/edits/captions', 'free-user', body)).status).toBe(403);
    }
    expect(state.created).toHaveLength(0);
  });

  it('a client cannot talk its way past the server: a claimed plan in the body, headers or query is ignored', async () => {
    const response = await post(
      '/v1/edits/captions?plan=pro&creatorPlan=pro',
      'free-user',
      {...FULL, plan: 'pro', creatorPlan: 'pro_plus', entitlement: 'finalpost_pro', isPro: true},
      {'x-plan': 'pro', 'x-creator-plan': 'pro_plus', 'x-entitlement': 'finalpost_pro'},
    );
    expect(response.status).toBe(403);
    expect(state.created).toHaveLength(0);
    expect(state.lookups).toEqual(['free-user']); // the decision came from the server lookup
  });

  it('fails closed when no trusted source can confirm the plan', async () => {
    const response = await post('/v1/edits/captions', 'unverified-user', FULL);
    expect(response.status).toBe(503);
    expect(((await response.json()) as {code: string}).code).toBe('entitlement_unavailable');
    expect(state.created).toHaveLength(0);
  });

  it('fails closed when the Creators API is unreachable', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://creators.test')) throw new Error('connect ECONNREFUSED');
      return original(input, init);
    }) as typeof fetch;
    const response = await post('/v1/edits/captions', 'pro-user', FULL);
    expect(response.status).toBe(503);
  });

  it('the internal service key (the trusted Python API) is not asked for a plan', async () => {
    const response = await post('/v1/edits/captions', 'someone', FULL, {}, 'service-key');
    expect(response.status).toBe(202);
    expect(state.lookups).toEqual([]);
  });

  it('enforcement can only be switched off explicitly (local development)', async () => {
    state.env.ENTITLEMENT_ENFORCEMENT = false;
    expect((await post('/v1/edits/captions', 'free-user', FULL)).status).toBe(202);
  });

  it('a verified lookup is cached briefly (one Creators API call for repeat requests)', async () => {
    await post('/v1/edits/captions', 'pro-user', FULL);
    await post('/v1/edits/captions', 'pro-user', FULL);
    expect(state.lookups).toEqual(['pro-user']);
  });
});

describe('the other paid pipelines are guarded too', () => {
  it('free creators cannot call the old client-driven analyze / render entry points', async () => {
    for (const path of ['/v1/analyze', '/v1/render']) {
      const response = await post(path, 'free-user', {});
      expect(response.status, path).toBe(403);
    }
  });

  it('Pro creators pass the guard (a bad body then fails validation, not entitlement)', async () => {
    for (const path of ['/v1/analyze', '/v1/render']) {
      const response = await post(path, 'pro-user', {});
      expect(response.status, path).toBe(400);
    }
  });

  const PRO_ONLY_AI_ROUTES = [
    '/v1/matting/jobs',
    '/v1/templates/extract-style',
    '/v1/templates/extract-caption-style',
    '/v1/templates/design',
    '/v1/templates/seedance-edit',
    '/v1/broll/describe',
  ];

  it('free creators cannot start the remaining Pro-only AI work (background removal, template design, Seedance, B-roll description)', async () => {
    for (const path of PRO_ONLY_AI_ROUTES) {
      const response = await post(path, 'free-user', {});
      expect(response.status, path).toBe(403);
      expect(((await response.json()) as {code: string}).code, path).toBe('pro_required');
    }
  });

  it('Pro and Pro Plus creators pass the guard on those routes (a bad body then fails validation)', async () => {
    for (const user of ['pro-user', 'plus-user']) {
      for (const path of PRO_ONLY_AI_ROUTES) {
        expect((await post(path, user, {})).status, `${user} ${path}`).not.toBe(403);
      }
    }
  });

  it('the thumbnail-theme extraction stays open to free creators (a profile feature, rate limited)', async () => {
    const response = await post('/v1/templates/extract-thumbnail-theme', 'free-user', {});
    expect(response.status).not.toBe(403);
    expect(state.lookups).toEqual([]);
  });

  it('free creators cannot answer the asset gate or retry a full edit', async () => {
    expect((await post('/v1/edits/ed_1/assets', 'free-user', {skipAll: true})).status).toBe(403);
    expect((await post('/v1/edits/ed_1/retry', 'free-user', {})).status).toBe(403);
    expect(state.submitted).toHaveLength(0);
    expect((await post('/v1/edits/ed_1/assets', 'pro-user', {skipAll: true})).status).toBe(202);
    expect(state.submitted).toHaveLength(1);
  });
});

describe("a creator cannot reach another creator's job", () => {
  it('only the owner can read it; everyone else gets not_found (the output url is never exposed)', async () => {
    state.jobs.set('ed_9', {editJobId: 'ed_9', userId: 'pro-user', mode: 'full_edit', status: 'done', outputUrl: 'https://cdn/private-out.mp4'});
    const owner = await get('/v1/edits/ed_9', 'pro-user');
    expect(owner.status).toBe(200);
    expect(((await owner.json()) as {job: {outputUrl: string}}).job.outputUrl).toBe('https://cdn/private-out.mp4');

    for (const intruder of ['plus-user', 'free-user']) {
      const response = await get('/v1/edits/ed_9', intruder);
      expect(response.status, intruder).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain('private-out');
    }
  });

  it('GET is read-only: it never starts, retries or advances a job', async () => {
    state.jobs.set('ed_5', {editJobId: 'ed_5', userId: 'pro-user', mode: 'full_edit', status: 'rendering'});
    await get('/v1/edits/ed_5', 'pro-user');
    await get('/v1/edits/ed_5', 'pro-user');
    expect(state.created).toHaveLength(0);
    expect(state.submitted).toHaveLength(0);
    expect(state.jobs.get('ed_5')!.status).toBe('rendering');
  });
});
