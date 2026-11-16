/**
 * V1 release gate over HTTP (real express routes + real entitlement guard + real style resolution; the edit runner is mocked and records what it was asked to run).
 * Each accepted request is followed through the real `resolveStyleRun` to prove WHICH pipeline would run.
 * (Harness copied from editStylesRoutes.test.ts.) Original header:
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
  retried: [] as Array<Record<string, unknown>>,
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
    const job = {editJobId: `ed_${state.created.length}`, userId: input.userId, status: 'awaiting_upload', mode: input.mode ?? 'captions', style: input.style, degraded: input.degraded, degradedReasons: input.degradedReasons, sourcePublicUrl: 'https://cdn/src.mp4', sourceKey: 'k'};
    state.jobs.set(job.editJobId, job);
    return {job, uploadUrl: 'https://up'};
  },
  loadCaptionsEditJob: async (id: string) => state.jobs.get(id) ?? null,
  markCaptionsSourceUploaded: async (id: string) => state.jobs.get(id),
  submitFullEditAssets: async () => ({}),
  retryFullEdit: async (input: Record<string, unknown>) => { state.retried.push(input); return {editJobId: input.editJobId, status: 'analyzing'}; },
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
  Object.assign(state.env, {ENTITLEMENT_ENFORCEMENT: true, EDIT_STYLES_ENABLED: true, EDIT_STYLES_AVAILABLE: '', EDIT_STYLES_ORDER: '', EDIT_STYLES_ENGINE_FLAGS: true});
  // This file tests the release gate itself (footage, style, fail-closed pipeline), not who may start Kinetic: that is eval/kineticAccessRoutes.test.ts. No environment defaults to global access, so say so explicitly (non-production).
  Object.assign(state.env, {NODE_ENV: 'test', V1_KINETIC_ACCESS: 'all', V1_KINETIC_ALLOWED_USER_IDS: ''});
  state.created.length = 0;
  state.retried.length = 0;
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


import {EDIT_STYLES} from '../lib/editStyles.ts';
import {kineticFailClosed, resolveStyleRun} from '../lib/styleRun.ts';
import type {EffectiveFlagsEnv} from '../lib/effectiveFlags.ts';

const BASE = {contentType: 'video/mp4', languageCode: 'en'};
const PRO_KINETIC = {...BASE, style: 'kinetic_typography', mode: 'full_edit', captionTemplate: 'basic', footageKind: 'camera', captionPreset: 'punchline'};
const FLAGS_OFF_ENV = Object.fromEntries(['MOTION_GRAPHICS_ENABLED', 'POLISH_FACELESS_DOC', 'POLISH_NEWSROOM_MG', 'POLISH_EXPLAINER_SKILL', 'POLISH_TEXTUAL_MG', 'POLISH_MOTION_TEMPLATES', 'POLISH_KINETIC_LED', 'POLISH_KINETIC_ENGINE', 'POLISH_KINETIC_ENGINE_3D', 'POLISH_KINETIC_ENGINE_ADAPTIVE', 'POLISH_KINETIC_ENGINE_MOTION', 'POLISH_KINETIC_ENGINE_MATTE', 'POLISH_KINETIC_MATCHCUT_SHUTTER', 'POLISH_SUBJECT_STAGE'].map(k => [k, false]).concat([['POLISH_DEFAULT_EDITS', 'lean']])) as unknown as EffectiveFlagsEnv;
/** the pipeline the analysis stage would really run for the job the route created */
const pipelineOf = (job: Record<string, unknown>) =>
  resolveStyleRun({style: job.style as keyof typeof EDIT_STYLES, engineFlags: Boolean(state.env.EDIT_STYLES_ENGINE_FLAGS), envProfile: 'polish', env: FLAGS_OFF_ENV, envGeminiMaxRequests: 0, release: Boolean(state.env.V1_KINETIC_RELEASE)});

describe('V1 release gate over HTTP', () => {
  describe('Free Basic Captions (independent of the Pro gate)', () => {
    for (const release of [false, true]) {
      it(`gate ${release ? 'ON' : 'OFF'}: starts as basic_captions with the selected preset, no entitlement lookup, never the Kinetic pipeline`, async () => {
        state.env.V1_KINETIC_RELEASE = release;
        const response = await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'basic_captions', style: 'basic_captions', captionPreset: 'spotlight', captionTemplate: 'karaoke', footageKind: 'camera'});
        expect(response.status).toBe(202);
        expect(state.created[0]).toMatchObject({mode: 'basic_captions', style: 'basic_captions', captionPreset: 'spotlight'});
        expect(state.lookups).toEqual([]);
        const run = pipelineOf(state.created[0]!);
        expect(run.pipeline).not.toBe('kinetic_v2');
        expect(run.flags.kineticEngine).toBe(false);
      });
    }
    it('an older Free app (mode only, no style) still starts with the gate ON', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      expect((await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'basic_captions', captionPreset: 'punchline'})).status).toBe(202);
    });
  });

  describe('Pro Kinetic Typography', () => {
    it('gate OFF: 503 kinetic_unavailable with reason v1_release_off, nothing created, no job that could run an older path', async () => {
      state.env.V1_KINETIC_RELEASE = false;
      const response = await post('/v1/edits/captions', 'pro-user', PRO_KINETIC);
      expect(response.status).toBe(503);
      const body = (await json(response)) as Record<string, unknown> & {details?: {reason?: string}};
      expect(body.code).toBe('kinetic_unavailable');
      expect(JSON.stringify(body)).toContain('v1_release_off');
      expect(state.created).toHaveLength(0);
    });

    it('gate ON + camera footage + Pro: 202, runs the Kinetic V2 pipeline (engine + shutter flags on), and the selected preset reaches the job', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      const response = await post('/v1/edits/captions', 'pro-user', PRO_KINETIC);
      expect(response.status).toBe(202);
      expect(state.created[0]).toMatchObject({mode: 'full_edit', style: 'kinetic_typography', captionPreset: 'punchline', footageKind: 'camera'});
      const run = pipelineOf(state.created[0]!);
      expect(run.pipeline).toBe('kinetic_v2');
      expect(run.flags).toMatchObject({kineticEngine: true, matchCutShutter: true, kineticEngineMatte: false, subjectStage: false});
    });

    it('Pro Plus is treated as Pro', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      expect((await post('/v1/edits/captions', 'plus-user', PRO_KINETIC)).status).toBe(202);
    });

    it('invalid caption preset: 400 on Free and on Pro, nothing created', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      expect((await post('/v1/edits/captions', 'pro-user', {...PRO_KINETIC, captionPreset: 'no-such-preset'})).status).toBe(400);
      expect((await post('/v1/edits/captions', 'free-user', {...BASE, mode: 'basic_captions', style: 'basic_captions', captionPreset: 'no-such-preset'})).status).toBe(400);
      expect(state.created).toHaveLength(0);
    });

    it('missing caption preset on Pro: accepted (an older app); Kinetic then uses its own look and no preset is stored', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      const {captionPreset: _omit, ...noPreset} = PRO_KINETIC;
      expect((await post('/v1/edits/captions', 'pro-user', noPreset)).status).toBe(202);
      expect(state.created[0]!.captionPreset).toBeUndefined();
    });

    it('missing or unknown footage classification: 422 footage_unsupported before any upload; screen recording too', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      const {footageKind: _omit, ...noKind} = PRO_KINETIC;
      for (const body of [noKind, {...PRO_KINETIC, footageKind: 'unknown'}, {...PRO_KINETIC, footageKind: 'screen_recording'}]) {
        const response = await post('/v1/edits/captions', 'pro-user', body);
        expect(response.status).toBe(422);
        expect((await json(response)).code).toBe('footage_unsupported');
      }
      expect(state.created).toHaveLength(0);
    });

    it('missing entitlement: a Free creator gets 403 pro_required; an unverifiable plan fails closed with 503 entitlement_unavailable', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      const free = await post('/v1/edits/captions', 'free-user', PRO_KINETIC);
      expect(free.status).toBe(403);
      expect((await json(free)).code).toBe('pro_required');
      state.apiDown = true;
      clearEntitlementCache();
      const down = await post('/v1/edits/captions', 'pro-user', PRO_KINETIC);
      expect(down.status).toBe(503);
      expect((await json(down)).code).toBe('entitlement_unavailable');
      expect(state.created).toHaveLength(0);
    });

    it('unsupported editing style: ai_clean_cut / explainer / subject_stage are not startable with the gate ON; an unknown style is 400; no style on a Pro mode is 400 style_required', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      for (const style of ['ai_clean_cut', 'explainer', 'subject_stage']) {
        const response = await post('/v1/edits/captions', 'pro-user', {...PRO_KINETIC, style});
        expect(response.status, style).toBe(409);
        expect((await json(response)).code).toBe('style_unavailable');
      }
      expect((await post('/v1/edits/captions', 'pro-user', {...PRO_KINETIC, style: 'nope'})).status).toBe(400);
      const {style: _s, ...noStyle} = PRO_KINETIC;
      const response = await post('/v1/edits/captions', 'pro-user', noStyle);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await json(response))).toContain('style_required');
      expect(state.created).toHaveLength(0);
    });
  });

  describe('Kinetic failure and retry', () => {
    it('a Kinetic job that did not get its V2 spec fails closed as retryable kinetic_unavailable (503), is never saved as another edit, and the retry route re-runs the SAME job', async () => {
      state.env.V1_KINETIC_RELEASE = true;
      const created = await post('/v1/edits/captions', 'pro-user', PRO_KINETIC);
      expect(created.status).toBe(202);
      const jobId = String((await json(created)).job?.editJobId);
      // what analysisRunner does when the engine produced no spec (a template path result is never reported as Kinetic)
      const failure = kineticFailClosed({release: true, run: pipelineOf(state.created[0]!), warnings: ['kinetic_engine_failed:no_spec'], hasKineticSpec: false});
      expect(failure).toMatchObject({code: 'kinetic_unavailable'});
      expect(toEngineError(Object.assign(new Error(failure!.message), {code: failure!.code})).status).toBeGreaterThan(0);
      // retry: same job id, entitlement checked, no new job created (idempotent)
      const retry = await post(`/v1/edits/${jobId}/retry`, 'pro-user', {});
      expect(retry.status).toBe(202);
      expect(state.retried).toEqual([{editJobId: jobId, userId: 'pro-user'}]);
      expect(state.created).toHaveLength(1);
      const freeRetry = await post(`/v1/edits/${jobId}/retry`, 'free-user', {});
      expect(freeRetry.status).toBe(403);
      expect(state.retried).toHaveLength(1);
    });

    it('a footage-skipped Kinetic job is footage_unsupported (retrying cannot fix it), a flags-off job is retryable kinetic_unavailable', () => {
      const run = {...pipelineOf({style: 'kinetic_typography'})};
      expect(kineticFailClosed({release: true, run, warnings: ['kinetic_engine:skipped_footage:screen_recording'], hasKineticSpec: false})).toMatchObject({code: 'footage_unsupported'});
      expect(kineticFailClosed({release: true, run: {...run, engineFlags: false}, warnings: [], hasKineticSpec: false})).toMatchObject({code: 'kinetic_unavailable'});
    });
  });
});
