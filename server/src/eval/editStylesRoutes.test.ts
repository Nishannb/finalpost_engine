/**
 * Edit styles over HTTP: GET /v1/edit-styles (catalog + per-creator lock state, fail closed) and the `style` field on
 * POST /v1/edits/captions (validation, entitlement, style-wins-over-mode, kill switch, mode-only unchanged).
 * Real express routes + the real entitlement guard; the plan comes from a fake Creators API and the edit runner is mocked.
 */
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';

import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  plans: new Map<string, {plan: string; verified: boolean; source?: string}>(),
  lookups: [] as string[],
  apiDown: false,
  created: [] as Array<Record<string, unknown>>,
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
    const job = {editJobId: `ed_${state.created.length}`, userId: input.userId, status: 'awaiting_upload', mode: input.mode ?? 'captions', style: input.style, degraded: input.degraded, sourcePublicUrl: 'https://cdn/src.mp4', sourceKey: 'k'};
    state.jobs.set(job.editJobId, job);
    return {job, uploadUrl: 'https://up'};
  },
  loadCaptionsEditJob: async (id: string) => state.jobs.get(id) ?? null,
  markCaptionsSourceUploaded: async (id: string) => state.jobs.get(id),
  submitFullEditAssets: async () => ({}),
  retryFullEdit: async () => ({}),
}));

import express from 'express';

import {clearEntitlementCache} from '../lib/entitlement.ts';
import {toEngineError} from '../lib/errors.ts';
import {editRoutes} from '../http/routes/editRoutes.ts';

let server: Server;
let base = '';
const realFetch = globalThis.fetch;

const post = (path: string, user: string, body: unknown, via = 'supabase-jwt') =>
  realFetch(`${base}${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-test-user': user, 'x-test-via': via},
    body: JSON.stringify(body),
  });
const get = (path: string, user: string, via = 'supabase-jwt') => realFetch(`${base}${path}`, {headers: {'x-test-user': user, 'x-test-via': via}});
const json = async (response: Response) => (await response.json()) as Record<string, unknown> & {code?: string; styles?: Array<Record<string, unknown>>; job?: Record<string, unknown>};

beforeAll(async () => {
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
});

beforeEach(() => {
  clearEntitlementCache();
  Object.assign(state.env, {ENTITLEMENT_ENFORCEMENT: true, EDIT_STYLES_ENABLED: true, EDIT_STYLES_AVAILABLE: '', EDIT_STYLES_ORDER: ''});
  state.created.length = 0;
  state.lookups.length = 0;
  state.jobs.clear();
  state.apiDown = false;
  state.plans.clear();
  state.plans.set('free-user', {plan: 'free', verified: true, source: 'revenuecat'});
  state.plans.set('pro-user', {plan: 'pro', verified: true, source: 'revenuecat'});
  state.plans.set('plus-user', {plan: 'pro_plus', verified: true, source: 'revenuecat'});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://creators.test/creator/internal/entitlement')) {
      const userId = new URL(url).searchParams.get('userId') ?? '';
      state.lookups.push(userId);
      if (state.apiDown) {
        return new Response('down', {status: 503});
      }
      const plan = state.plans.get(userId) ?? {plan: 'free', verified: true};
      return new Response(JSON.stringify({ok: true, ...plan}), {status: 200});
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const BASE = {contentType: 'video/mp4', languageCode: 'en'};
const ids = (styles: Array<Record<string, unknown>> = []) => styles.map(s => s.id);
const locked = (styles: Array<Record<string, unknown>> = []) => Object.fromEntries(styles.map(s => [s.id, s.locked]));

describe('GET /v1/edit-styles', () => {
  it('free plan: the four styles, Pro ones locked, Kinetic and Explainer unavailable', async () => {
    const response = await get('/v1/edit-styles', 'free-user');
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(ids(body.styles)).toEqual(['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer']);
    expect(locked(body.styles)).toEqual({basic_captions: false, ai_clean_cut: true, kinetic_typography: true, explainer: true});
    expect(body.styles?.map(s => s.available)).toEqual([true, true, false, false]);
    expect(body.styles?.[0]).toEqual(expect.objectContaining({name: 'Basic Captions', tier: 'free', previewAsset: 'basic_captions', sortOrder: 10}));
    expect(body.plan).toBe('free');
  });

  it('Pro and Pro Plus: nothing locked', async () => {
    for (const user of ['pro-user', 'plus-user']) {
      const body = await json(await get('/v1/edit-styles', user));
      expect(Object.values(locked(body.styles)), user).toEqual([false, false, false, false]);
    }
  });

  it('plan lookup failure: still 200, Pro styles locked (fail closed), and the failure is held briefly', async () => {
    state.apiDown = true;
    const first = await get('/v1/edit-styles', 'pro-user');
    expect(first.status).toBe(200);
    const body = await json(first);
    expect(locked(body.styles)).toEqual({basic_captions: false, ai_clean_cut: true, kinetic_typography: true, explainer: true});
    expect(body.planVerified).toBe(false);
    await get('/v1/edit-styles', 'pro-user');
    expect(state.lookups.filter(u => u === 'pro-user')).toHaveLength(1);
  });

  it('a verified plan is reused from the entitlement cache', async () => {
    await get('/v1/edit-styles', 'pro-user');
    await get('/v1/edit-styles', 'pro-user');
    expect(state.lookups).toEqual(['pro-user']);
  });

  it('service-key callers and ENTITLEMENT_ENFORCEMENT=0 see everything unlocked, with no lookup', async () => {
    expect(Object.values(locked((await json(await get('/v1/edit-styles', 'svc', 'service-key'))).styles))).toEqual([false, false, false, false]);
    state.env.ENTITLEMENT_ENFORCEMENT = false;
    expect(Object.values(locked((await json(await get('/v1/edit-styles', 'free-user'))).styles))).toEqual([false, false, false, false]);
    expect(state.lookups).toEqual([]);
  });

  it('env overrides availability and order (no app release)', async () => {
    Object.assign(state.env, {EDIT_STYLES_AVAILABLE: 'basic_captions,ai_clean_cut,kinetic_typography', EDIT_STYLES_ORDER: 'kinetic_typography'});
    const body = await json(await get('/v1/edit-styles', 'pro-user'));
    expect(ids(body.styles)).toEqual(['kinetic_typography', 'basic_captions', 'ai_clean_cut', 'explainer']);
    expect(body.styles?.map(s => s.available)).toEqual([true, true, true, false]);
  });

  it('?refresh=1 after a purchase skips the cached plan, at most once per 10 s per creator', async () => {
    const user = `upgrader-${Date.now()}`;
    state.plans.set(user, {plan: 'free', verified: true, source: 'revenuecat'});
    expect(locked((await json(await get('/v1/edit-styles', user))).styles).ai_clean_cut).toBe(true);
    state.plans.set(user, {plan: 'pro', verified: true, source: 'revenuecat'}); // the purchase lands at the Creators API
    expect(locked((await json(await get('/v1/edit-styles', user))).styles).ai_clean_cut).toBe(true); // still the cached free plan
    const refreshed = await json(await get('/v1/edit-styles?refresh=1', user));
    expect(refreshed.refreshed).toBe(true);
    expect(locked(refreshed.styles).ai_clean_cut).toBe(false);
    expect(state.lookups.filter(u => u === user)).toHaveLength(2);
    // a second refresh inside the window is served from the cache (no error, no extra lookup)
    const limited = await get('/v1/edit-styles?refresh=1', user);
    expect(limited.status).toBe(200);
    expect((await json(limited)).refreshed).toBe(false);
    expect(state.lookups.filter(u => u === user)).toHaveLength(2);
    // and the fresh plan also reaches the paid route right away
    expect((await post('/v1/edits/captions', user, {...BASE, style: 'ai_clean_cut'})).status).toBe(202);
  });

  it('refresh=0 (or any value other than 1 / true) is not a refresh', async () => {
    const body = await json(await get('/v1/edit-styles?refresh=0', 'pro-user'));
    expect(body.refreshed).toBe(false);
  });

  it('kill switch off: 404 (the app then uses its bundled manifest and mode-only requests)', async () => {
    state.env.EDIT_STYLES_ENABLED = false;
    const response = await get('/v1/edit-styles', 'pro-user');
    expect(response.status).toBe(404);
    expect((await json(response)).code).toBe('not_found');
  });
});

describe('POST /v1/edits/captions with `style`', () => {
  it('unknown style: 400, nothing created', async () => {
    const response = await post('/v1/edits/captions', 'pro-user', {...BASE, style: 'faceless_documentary'});
    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe('bad_request');
    expect(state.created).toHaveLength(0);
  });

  it('unavailable style: 409 style_unavailable, nothing created (Pro or not)', async () => {
    for (const style of ['kinetic_typography', 'explainer']) {
      const response = await post('/v1/edits/captions', 'pro-user', {...BASE, style});
      expect(response.status, style).toBe(409);
      expect((await json(response)).code).toBe('style_unavailable');
    }
    expect(state.created).toHaveLength(0);
  });

  it('free creator + Pro style: 403 pro_required, nothing created, even with mode basic_captions', async () => {
    for (const body of [{...BASE, style: 'ai_clean_cut'}, {...BASE, style: 'ai_clean_cut', mode: 'basic_captions'}]) {
      const response = await post('/v1/edits/captions', 'free-user', body);
      expect(response.status).toBe(403);
      expect((await json(response)).code).toBe('pro_required');
    }
    expect(state.created).toHaveLength(0);
  });

  it('free creator + basic_captions: 202, mode derived and style stored', async () => {
    const response = await post('/v1/edits/captions', 'free-user', {...BASE, style: 'basic_captions', captionPreset: undefined});
    expect(response.status).toBe(202);
    expect(state.created[0]).toEqual(expect.objectContaining({mode: 'basic_captions', style: 'basic_captions'}));
    expect(state.created[0]).not.toHaveProperty('degraded');
    expect((await json(response)).job).toEqual(expect.objectContaining({style: 'basic_captions', mode: 'basic_captions'}));
  });

  it('style wins over mode: Pro + style ai_clean_cut + mode basic_captions runs full_edit and keeps fullEdit options', async () => {
    const fullEdit = {renderFlags: {brollEnabled: true, zoomEnabled: true, trimEnabled: true}};
    const response = await post('/v1/edits/captions', 'pro-user', {...BASE, mode: 'basic_captions', style: 'ai_clean_cut', fullEdit});
    expect(response.status).toBe(202);
    expect(state.created[0]).toEqual(expect.objectContaining({mode: 'full_edit', style: 'ai_clean_cut', fullEdit}));
    // and the other way: Pro + style basic_captions + mode full_edit is a Basic Captions job (no fullEdit options)
    await post('/v1/edits/captions', 'pro-user', {...BASE, mode: 'full_edit', style: 'basic_captions', fullEdit});
    expect(state.created[1]).toEqual(expect.objectContaining({mode: 'basic_captions', style: 'basic_captions'}));
    expect(state.created[1]).not.toHaveProperty('fullEdit');
  });

  it('a pending style made available runs as Clean Cut and is recorded as degraded on the job', async () => {
    state.env.EDIT_STYLES_AVAILABLE = 'basic_captions,ai_clean_cut,kinetic_typography';
    const response = await post('/v1/edits/captions', 'pro-user', {...BASE, style: 'kinetic_typography'});
    expect(response.status).toBe(202);
    expect(state.created[0]).toEqual(
      expect.objectContaining({mode: 'full_edit', style: 'kinetic_typography', degraded: {reason: 'engine_style_pending', appliedAs: 'ai_clean_cut'}}),
    );
    const editJobId = String((await json(response)).job?.editJobId);
    const status = await json(await get(`/v1/edits/${editJobId}`, 'pro-user'));
    expect(status.job).toEqual(expect.objectContaining({style: 'kinetic_typography', degraded: {reason: 'engine_style_pending', appliedAs: 'ai_clean_cut'}}));
  });

  it('mode-only requests (older apps) are unchanged', async () => {
    expect((await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'basic_captions'})).status).toBe(202);
    const freeFull = await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'full_edit'});
    expect(freeFull.status).toBe(403);
    expect((await post('/v1/edits/captions', 'free-user', BASE)).status).toBe(403); // default `captions` mode stays Pro
    expect((await post('/v1/edits/captions', 'pro-user', {...BASE, mode: 'full_edit'})).status).toBe(202);
    expect(state.created.map(c => [c.mode, 'style' in c])).toEqual([
      ['basic_captions', false],
      ['full_edit', false],
    ]);
  });

  it('kill switch off: `style` is ignored entirely (even unknown or unavailable ids) and mode decides', async () => {
    state.env.EDIT_STYLES_ENABLED = false;
    expect((await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'basic_captions', style: 'ai_clean_cut'})).status).toBe(202);
    expect((await post('/v1/edits/captions', 'pro-user', {...BASE, mode: 'full_edit', style: 'not-a-style'})).status).toBe(202);
    expect((await post('/v1/edits/captions', 'pro-user', {...BASE, mode: 'full_edit', style: 'kinetic_typography'})).status).toBe(202);
    expect(state.created.map(c => [c.mode, c.style])).toEqual([
      ['basic_captions', undefined],
      ['full_edit', undefined],
      ['full_edit', undefined],
    ]);
  });
});
