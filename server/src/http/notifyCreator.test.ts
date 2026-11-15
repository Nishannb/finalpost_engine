import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {callbackBackoffMs, callbackEventId, notifyCreatorEditDone, waitForCallbackRetries} from './notifyCreator.ts';

const e = env as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const calls: Array<{url: string; headers: Record<string, string>; body: Record<string, unknown>}> = [];
let script: Array<number | 'network' | {code: number; body: unknown}> = [];
const ok = (push = 'sent') => ({code: 200, body: {ok: true, accepted: true, push: {status: push}}});

beforeEach(() => {
  for (const k of ['CREATOR_API_URL', 'ENGINE_API_KEY', 'CALLBACK_MAX_ATTEMPTS', 'CALLBACK_BACKOFF_BASE_MS', 'CALLBACK_BACKOFF_MAX_MS', 'CALLBACK_TIMEOUT_MS']) saved[k] = e[k];
  Object.assign(e, {CREATOR_API_URL: 'http://creators.test', ENGINE_API_KEY: 'secret-key-value', CALLBACK_MAX_ATTEMPTS: 5, CALLBACK_BACKOFF_BASE_MS: 1, CALLBACK_BACKOFF_MAX_MS: 4, CALLBACK_TIMEOUT_MS: 500});
  calls.length = 0; script = [];
  vi.stubGlobal('fetch', async (url: string, init: {headers: Record<string, string>; body: string}) => {
    calls.push({url, headers: init.headers, body: JSON.parse(init.body)});
    const step = script.shift() ?? ok();
    if (step === 'network') throw new Error('ECONNREFUSED');
    const {code, body} = typeof step === 'number' ? {code: step, body: {ok: false}} : step;
    return new Response(JSON.stringify(body), {status: code});
  });
});
afterEach(async () => { await waitForCallbackRetries(); vi.unstubAllGlobals(); Object.assign(e, saved); });

const event = {userId: 'u1', editJobId: 'ed_1', status: 'done' as const, type: 'edit_done' as const, outputUrl: 'https://x/y.mp4'};
const records: Array<[string, any]> = [];
const run = async (input = event) => { records.length = 0; const first = await notifyCreatorEditDone({...input, eventId: callbackEventId(input)}, {onRecord: (id, r) => { records.push([id, r]); }}); await waitForCallbackRetries(); return first; };

describe('completion callback delivery', () => {
  it('delivered on the first acknowledged attempt; carries the event identity and the key; no retry', async () => {
    await run();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://creators.test/creator/internal/edit-done');
    expect(calls[0]!.headers['x-engine-key']).toBe('secret-key-value');
    expect(calls[0]!.body).toMatchObject({editJobId: 'ed_1', eventId: 'edit_done:ed_1:0', type: 'edit_done', outputUrl: 'https://x/y.mp4'});
    expect(typeof calls[0]!.body.occurredAt).toBe('string');
    expect(records.at(-1)![1]).toMatchObject({status: 'delivered', attempts: 1, lastCode: 200, pushStatus: 'sent'});
  });
  it('HTTP 500 then success: retried, delivered on attempt 2, same event id both times', async () => {
    script = [500];
    await run();
    expect(calls.map(c => c.body.eventId)).toEqual(['edit_done:ed_1:0', 'edit_done:ed_1:0']);
    expect(records.map(r => [r[1].status, r[1].attempts, r[1].lastCode])).toEqual([['pending', 1, 500], ['delivered', 2, 200]]);
  });
  it('connection failure then success', async () => {
    script = ['network', 'network'];
    await run();
    expect(records.map(r => [r[1].status, r[1].attempts, r[1].lastCode])).toEqual([['pending', 1, 0], ['pending', 2, 0], ['delivered', 3, 200]]);
    expect(records[0]![1].lastError).toContain('ECONNREFUSED');
  });
  it('authentication failure (401) is permanent: one attempt, rejected, never retried', async () => {
    script = [401];
    await run();
    expect(calls).toHaveLength(1);
    expect(records.at(-1)![1]).toMatchObject({status: 'rejected', attempts: 1, lastCode: 401});
  });
  it('other permanent 4xx (400 invalid payload, 404) stop at once; 408 / 425 / 429 are transient', async () => {
    for (const code of [400, 403, 404, 422]) { calls.length = 0; script = [code]; await run(); expect(calls, String(code)).toHaveLength(1); }
    for (const code of [408, 425, 429, 502, 503]) { calls.length = 0; script = [code]; await run(); expect(calls, String(code)).toHaveLength(2); }
  });
  it('bounded: never more than CALLBACK_MAX_ATTEMPTS, then exhausted with the last response kept', async () => {
    script = Array(20).fill(503);
    await run();
    expect(calls).toHaveLength(5);
    expect(records.at(-1)![1]).toMatchObject({status: 'exhausted', attempts: 5, lastCode: 503});
    e.CALLBACK_MAX_ATTEMPTS = 2; calls.length = 0; script = Array(20).fill('network'); await run();
    expect(calls).toHaveLength(2);
  });
  it('exponential backoff, capped', () => {
    e.CALLBACK_BACKOFF_BASE_MS = 1000; e.CALLBACK_BACKOFF_MAX_MS = 30000;
    expect([1, 2, 3, 4, 5, 6, 7].map(callbackBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it('acknowledged but the push failed: the callback is delivered, the push state is recorded separately, and a bounded redelivery re-attempts the push', async () => {
    script = [ok('failed'), ok('sent')];
    await run();
    expect(calls).toHaveLength(2);
    expect(records.map(r => [r[1].status, r[1].pushStatus])).toEqual([['pending', 'failed'], ['delivered', 'sent']]);
  });
  it('a push that stays failed ends delivered (the callback arrived) with pushStatus failed, within the attempt bound', async () => {
    script = Array(20).fill(ok('failed'));
    await run();
    expect(calls).toHaveLength(5);
    expect(records.at(-1)![1]).toMatchObject({status: 'delivered', pushStatus: 'failed', attempts: 5});
  });
  it('a duplicate acknowledgement is delivered and recorded as such', async () => {
    script = [{code: 200, body: {ok: true, accepted: true, duplicate: true, push: {status: 'sent'}}}];
    await run();
    expect(records.at(-1)![1]).toMatchObject({status: 'delivered', duplicate: true});
  });
  it('the key never appears in a delivery record', async () => {
    script = [500, 401];
    await run();
    expect(JSON.stringify(records)).not.toContain('secret-key-value');
  });
  it('unconfigured URL or key: skipped, nothing sent', async () => {
    e.CREATOR_API_URL = ''; expect(await run()).toBeNull(); e.CREATOR_API_URL = 'http://creators.test'; e.ENGINE_API_KEY = ''; expect(await run()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
