/** Pro monthly edit minutes: start refusal at 0 (soft check, fails open), and the billable fields on the completion callback. */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  status: 200,
  body: {pointsRemaining: 45, pointsLimit: 45, usageMonth: '2026-11-01'} as Record<string, unknown>,
  urls: [] as string[],
  bodies: [] as Array<Record<string, unknown>>,
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, CREATOR_API_URL: 'https://creators.test', ENGINE_API_KEY: 'engine-key', ENTITLEMENT_ENFORCEMENT: true};
  return {...actual, env: state.env};
});

import {callbackEventId, notifyCreatorEditDone, waitForCallbackRetries} from '../http/notifyCreator.ts';
import {assertEditMinutesAvailable, isBillableEditMode} from './editMinutes.ts';
import {isEngineError} from './errors.ts';

beforeEach(() => {
  state.env.ENTITLEMENT_ENFORCEMENT = true;
  state.status = 200;
  state.body = {pointsRemaining: 45, pointsLimit: 45, usageMonth: '2026-11-01'};
  state.urls = [];
  state.bodies = [];
  vi.stubGlobal('fetch', async (url: string, init?: {body?: string}) => {
    state.urls.push(url);
    if (init?.body) state.bodies.push(JSON.parse(init.body));
    if (url.includes('/creator/internal/edit-done')) return new Response(JSON.stringify({ok: true, accepted: true}), {status: 200});
    return new Response(JSON.stringify({ok: true, ...state.body}), {status: state.status});
  });
});
afterEach(async () => { await waitForCallbackRetries(); vi.unstubAllGlobals(); });

const creator = {userId: 'u1', via: 'supabase-jwt' as const};

describe('assertEditMinutesAvailable', () => {
  it('allows a creator with minutes left and asks the Creators API with the service key', async () => {
    await expect(assertEditMinutesAvailable(creator)).resolves.toBeUndefined();
    expect(state.urls[0]).toBe('https://creators.test/creator/internal/edit-minutes?userId=u1');
  });

  it('refuses at 0 with edit_minutes_exhausted (403)', async () => {
    state.body = {pointsRemaining: 0, pointsLimit: 45, usageMonth: '2026-11-01'};
    const error = await assertEditMinutesAvailable(creator).catch(e => e);
    expect(isEngineError(error)).toBe(true);
    expect(error.code).toBe('edit_minutes_exhausted');
    expect(error.status).toBe(403);
    expect(error.message).toContain('45 edit minutes');
  });

  it('fails open when the balance cannot be read (HTTP error, bad body, network)', async () => {
    state.status = 503;
    await expect(assertEditMinutesAvailable(creator)).resolves.toBeUndefined();
    state.status = 200;
    state.body = {nope: true};
    await expect(assertEditMinutesAvailable(creator)).resolves.toBeUndefined();
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    await expect(assertEditMinutesAvailable(creator)).resolves.toBeUndefined();
  });

  it('dev auth and ENTITLEMENT_ENFORCEMENT=0 skip the lookup; service-key callers are still checked', async () => {
    state.body = {pointsRemaining: 0, pointsLimit: 45};
    await expect(assertEditMinutesAvailable({userId: 'u1', via: 'dev'})).resolves.toBeUndefined();
    state.env.ENTITLEMENT_ENFORCEMENT = false;
    await expect(assertEditMinutesAvailable(creator)).resolves.toBeUndefined();
    expect(state.urls).toHaveLength(0);
    state.env.ENTITLEMENT_ENFORCEMENT = true;
    await expect(assertEditMinutesAvailable({userId: 'u1', via: 'service-key'})).rejects.toMatchObject({code: 'edit_minutes_exhausted'});
  });
});

describe('billable completion callback', () => {
  it('only Basic Captions is free', () => {
    expect(isBillableEditMode('basic_captions')).toBe(false);
    expect(isBillableEditMode('full_edit')).toBe(true);
    expect(isBillableEditMode('captions')).toBe(true);
  });

  it('forwards billable + outputDurationSec, and omits them when absent', async () => {
    const paid = {userId: 'u1', editJobId: 'ed_1', status: 'done' as const, type: 'edit_done' as const, billable: true, outputDurationSec: 95.2};
    await notifyCreatorEditDone({...paid, eventId: callbackEventId(paid)});
    const free = {userId: 'u1', editJobId: 'ed_2', status: 'done' as const};
    await notifyCreatorEditDone({...free, eventId: callbackEventId(free)});
    expect(state.bodies[0]).toMatchObject({editJobId: 'ed_1', billable: true, outputDurationSec: 95.2});
    expect(state.bodies[1]).not.toHaveProperty('billable');
    expect(state.bodies[1]).not.toHaveProperty('outputDurationSec');
  });
});

describe('2026-11-27: edit minutes are charged on the RAW upload', () => {
  it('reads the original length through delivery shaping, else the blueprint source', async () => {
    const {rawSourceDurationSec, billableExtra} = await import('./editMinutes.ts');
    expect(rawSourceDurationSec({sourceDurationSec: 30.1, deliveryShaping: {timeRemap: {sourceDurationSec: 33}}})).toBe(33);
    expect(rawSourceDurationSec({sourceDurationSec: 33})).toBe(33);
    expect(rawSourceDurationSec({sourceDurationSec: 0})).toBeUndefined();
    expect(billableExtra({mode: 'full_edit', outputDurationSec: 28.2, sourceDurationSec: 33})).toEqual({billable: true, outputDurationSec: 28.2, sourceDurationSec: 33});
    expect(billableExtra({mode: 'basic_captions', sourceDurationSec: 33})).toEqual({});
  });
});
