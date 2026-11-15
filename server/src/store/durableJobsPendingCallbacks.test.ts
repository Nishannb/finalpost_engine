/**
 * The REAL PostgREST adapter (createPostgrestJobStore) against a fake PostgREST that understands only the syntax the adapter uses. It proves what the adapter SENDS (URL, filter, headers,
 * body) and that a pending-callback record survives the adapter's write/read round trip and is found by the boot scan. It does NOT prove Supabase accepts the query: that needs a staging project.
 */
import {describe, expect, it} from 'vitest';

import {createPostgrestJobStore} from './durableJobs.ts';
import type {CaptionsEditJob} from '../types/blueprint.ts';

type Row = Record<string, any>;
function fakePostgrest() {
  const table = new Map<string, Row>();
  const requests: Array<{method: string; url: string; headers: Record<string, string>; body?: any}> = [];
  const fetchImpl = (async (url: string, init: {method?: string; headers: Record<string, string>; body?: string}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    requests.push({method, url, headers: init.headers, ...(init.body ? {body: JSON.parse(init.body)} : {})});
    if (!u.pathname.endsWith('/creator_edit_jobs')) return new Response('not found', {status: 404});
    if (method === 'POST') { const row = JSON.parse(init.body!); table.set(row.edit_job_id, {...(table.get(row.edit_job_id) ?? {}), ...row}); return new Response(null, {status: 201}); }
    let rows = [...table.values()];
    for (const [key, value] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      const m = /^eq\.(.*)$/.exec(value);
      if (!m) return new Response('unsupported filter', {status: 400});
      const path = key.split('->>'); // `job->>callbacksPending` compares the jsonb field as TEXT
      rows = rows.filter(r => String(path.length === 2 ? r[path[0]!]?.[path[1]!] : r[key]) === m[1]);
    }
    const limit = Number(u.searchParams.get('limit') ?? rows.length);
    const select = (u.searchParams.get('select') ?? '*').split(',');
    return new Response(JSON.stringify(rows.slice(0, limit).map(r => (select[0] === '*' ? r : Object.fromEntries(select.map(c => [c, r[c]]))))), {status: 200});
  }) as unknown as typeof fetch;
  return {table, requests, fetchImpl};
}
const job = (id: string, over: Partial<CaptionsEditJob> = {}): CaptionsEditJob => ({
  editJobId: id, userId: 'u1', status: 'failed', progress: 1, sourceKey: 'k', sourcePublicUrl: 'https://x', languageCode: 'en' as never, captionTemplate: 'basic' as never,
  createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z', mode: 'full_edit', ...over,
} as CaptionsEditJob);

describe('durable store: pending callbacks through the PostgREST adapter', () => {
  it('a pending callback record is written inside the job document and found by the boot scan; delivered / exhausted jobs are not', async () => {
    const pg = fakePostgrest();
    const store = createPostgrestJobStore({url: 'https://project.example', serviceKey: 'service-key-placeholder'}, pg.fetchImpl);
    const pendingRecord = {type: 'edit_failed', status: 'pending' as const, attempts: 1, lastCode: 503, firstAt: 'a', lastAt: 'b', nextAttemptAt: 'c', payload: {editJobId: 'j1', eventId: 'edit_failed:j1:0'}};
    await store.upsert(job('j1', {callbacksPending: true, callbacks: {'edit_failed:j1:0': pendingRecord}}));
    await store.upsert(job('j2', {callbacksPending: false, callbacks: {'edit_done:j2:0': {...pendingRecord, status: 'delivered'}}}));
    await store.upsert(job('j3', {callbacksPending: false, callbacks: {'edit_failed:j3:0': {...pendingRecord, status: 'exhausted'}}}));
    await store.upsert(job('j4')); // no callbacks at all
    expect(await store.listPendingCallbacks({limit: 50})).toEqual(['j1']);
    const stored = (await store.get('j1'))!.job;
    expect(stored.callbacks!['edit_failed:j1:0']).toMatchObject({status: 'pending', attempts: 1, payload: {eventId: 'edit_failed:j1:0'}});
    expect(stored.callbacksPending).toBe(true);
  });

  it('the scan request: jsonb text filter on the existing `job` column, no new column, service key as apikey + bearer, bounded limit', async () => {
    const pg = fakePostgrest();
    const store = createPostgrestJobStore({url: 'https://project.example/', serviceKey: 'service-key-placeholder'}, pg.fetchImpl);
    await store.listPendingCallbacks({limit: 7});
    const req = pg.requests.at(-1)!;
    const u = new URL(req.url);
    expect(req.method).toBe('GET');
    expect(u.origin + u.pathname).toBe('https://project.example/rest/v1/creator_edit_jobs');
    expect(u.searchParams.get('job->>callbacksPending')).toBe('eq.true');
    expect(u.searchParams.get('select')).toBe('edit_job_id');
    expect(u.searchParams.get('limit')).toBe('7');
    expect(req.headers.apikey).toBe('service-key-placeholder');
    expect(req.headers.Authorization).toBe('Bearer service-key-placeholder');
  });

  it('the write that carries the outbox is the SAME upsert as every job write (merge-duplicates on edit_job_id), with the job document in the `job` column', async () => {
    const pg = fakePostgrest();
    const store = createPostgrestJobStore({url: 'https://project.example', serviceKey: 'k'}, pg.fetchImpl);
    await store.upsert(job('j1', {callbacksPending: true, callbacks: {}}));
    const req = pg.requests.at(-1)!;
    expect(req.url).toContain('/creator_edit_jobs?on_conflict=edit_job_id');
    expect(req.headers.Prefer).toContain('resolution=merge-duplicates');
    expect(req.body.job.callbacksPending).toBe(true);
    expect(Object.keys(req.body)).not.toContain('callbacks_pending'); // no schema addition was needed
  });
});
