/**
 * Durable store for full-edit jobs (public.creator_edit_jobs in the project's Supabase Postgres).
 *
 * Why: the engine KV (memory / Redis) expires job state after 24h and is lost on a restart, which is not
 * acceptable for an edit that can wait days for the creator's assets. KV stays the hot path (and holds
 * temporary locks); this table is the source of truth for `full_edit` jobs. Captions jobs never touch it.
 *
 * Access is PostgREST with the server-only service-role key: no new dependency, no new database.
 * The lease columns give "at most one worker advances a job" as one atomic UPDATE ... WHERE.
 */

import {env} from '../config/env.ts';
import {logger} from '../lib/logger.ts';
import type {CaptionsEditJob} from '../types/blueprint.ts';

export type DurableJob = {job: CaptionsEditJob; blueprint?: unknown};

export type DurableJobStore = {
  kind: 'postgrest' | 'memory';
  /** Insert or update the job (and, when given, the edit-plan snapshot). */
  upsert(job: CaptionsEditJob, blueprint?: unknown): Promise<void>;
  get(editJobId: string): Promise<DurableJob | null>;
  /** awaiting_upload / analyzing / rendering jobs idle for `idleMs` whose lease is free or expired (never awaiting_assets). */
  listRecoverable(opts: {idleMs: number; limit: number}): Promise<string[]>;
  /** Atomic: true only if this caller now holds the lease. */
  claimLease(editJobId: string, owner: string, leaseMs: number): Promise<boolean>;
  releaseLease(editJobId: string, owner: string): Promise<void>;
  /** Expire inactive jobs, delete old finished ones. */
  purge(): Promise<{expired: number; deleted: number}>;
};

const TERMINAL = new Set(['done', 'failed']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

// ---------------------------------------------------------------------------
// PostgREST implementation
// ---------------------------------------------------------------------------

type Row = {
  edit_job_id: string;
  user_id: string;
  mode: string;
  status: string;
  blueprint_id: string | null;
  input_video_url: string | null;
  output_url: string | null;
  error_code: string | null;
  error_message: string | null;
  asset_brief: unknown;
  job: CaptionsEditJob;
  blueprint?: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function toRow(job: CaptionsEditJob, blueprint?: unknown): Partial<Row> {
  return {
    edit_job_id: job.editJobId,
    user_id: job.userId,
    mode: job.mode ?? 'captions',
    status: job.status,
    blueprint_id: job.blueprintId ?? null,
    input_video_url: job.sourcePublicUrl ?? null,
    output_url: job.outputUrl ?? null,
    error_code: job.errorCode ?? null,
    error_message: job.errorMessage ?? null,
    asset_brief: job.assetBrief ?? null,
    job,
    ...(blueprint !== undefined ? {blueprint} : {}),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    completed_at: isTerminalStatus(job.status) ? job.updatedAt : null,
  };
}

export function createPostgrestJobStore(
  config: {url: string; serviceKey: string},
  fetchImpl: typeof fetch = fetch,
): DurableJobStore {
  const base = `${config.url.replace(/\/+$/, '')}/rest/v1`;
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  });
  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const response = await fetchImpl(`${base}${path}`, {...init, signal: AbortSignal.timeout(10_000)});
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`durable jobs ${init.method ?? 'GET'} ${path.split('?')[0]} failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return response;
  };

  return {
    kind: 'postgrest',
    async upsert(job, blueprint) {
      await call('/creator_edit_jobs?on_conflict=edit_job_id', {
        method: 'POST',
        headers: headers({Prefer: 'resolution=merge-duplicates,return=minimal'}),
        body: JSON.stringify(toRow(job, blueprint)),
      });
    },
    async get(editJobId) {
      const response = await call(`/creator_edit_jobs?edit_job_id=eq.${encodeURIComponent(editJobId)}&select=job,blueprint&limit=1`, {
        method: 'GET',
        headers: headers(),
      });
      const rows = (await response.json()) as Array<{job: CaptionsEditJob; blueprint?: unknown}>;
      return rows[0] ? {job: rows[0].job, ...(rows[0].blueprint ? {blueprint: rows[0].blueprint} : {})} : null;
    },
    async listRecoverable({idleMs, limit}) {
      const now = new Date().toISOString();
      const idleBefore = new Date(Date.now() - idleMs).toISOString();
      const response = await call(
        `/creator_edit_jobs?select=edit_job_id&status=in.(awaiting_upload,analyzing,rendering)&updated_at=lt.${encodeURIComponent(idleBefore)}` +
          `&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(now)})&order=updated_at.asc&limit=${limit}`,
        {method: 'GET', headers: headers()},
      );
      return ((await response.json()) as Array<{edit_job_id: string}>).map(row => row.edit_job_id);
    },
    async claimLease(editJobId, owner, leaseMs) {
      const now = new Date().toISOString();
      const until = new Date(Date.now() + leaseMs).toISOString();
      // One UPDATE: it only matches when the lease is free, expired, or already ours (a renewal).
      const response = await call(
        `/creator_edit_jobs?edit_job_id=eq.${encodeURIComponent(editJobId)}` +
          `&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(now)},lease_owner.eq.${encodeURIComponent(owner)})` +
          `&status=not.in.(done,failed)&select=edit_job_id`,
        {
          method: 'PATCH',
          headers: headers({Prefer: 'return=representation'}),
          body: JSON.stringify({lease_owner: owner, lease_until: until}),
        },
      );
      return ((await response.json()) as unknown[]).length > 0;
    },
    async releaseLease(editJobId, owner) {
      await call(`/creator_edit_jobs?edit_job_id=eq.${encodeURIComponent(editJobId)}&lease_owner=eq.${encodeURIComponent(owner)}`, {
        method: 'PATCH',
        headers: headers({Prefer: 'return=minimal'}),
        body: JSON.stringify({lease_owner: null, lease_until: null}),
      });
    },
    async purge() {
      const response = await call('/rpc/purge_creator_edit_jobs', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({inactive_days: env.EDIT_JOB_INACTIVE_DAYS, terminal_days: env.EDIT_JOB_TERMINAL_DAYS}),
      });
      const result = (await response.json()) as {expired?: number; deleted?: number};
      return {expired: result.expired ?? 0, deleted: result.deleted ?? 0};
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; the same contract as the table)
// ---------------------------------------------------------------------------

export function createMemoryJobStore(now: () => number = Date.now): DurableJobStore & {rows: Map<string, Record<string, unknown>>} {
  type MemRow = {job: CaptionsEditJob; blueprint?: unknown; leaseOwner: string | null; leaseUntil: number};
  const rows = new Map<string, MemRow>();
  return {
    kind: 'memory',
    rows: rows as never,
    async upsert(job, blueprint) {
      const current = rows.get(job.editJobId);
      rows.set(job.editJobId, {
        job: structuredClone(job),
        blueprint: blueprint !== undefined ? structuredClone(blueprint) : current?.blueprint,
        leaseOwner: current?.leaseOwner ?? null,
        leaseUntil: current?.leaseUntil ?? 0,
      });
    },
    async get(editJobId) {
      const row = rows.get(editJobId);
      return row ? {job: structuredClone(row.job), ...(row.blueprint ? {blueprint: structuredClone(row.blueprint)} : {})} : null;
    },
    async listRecoverable({idleMs, limit}) {
      return [...rows.values()]
        .filter(
          row =>
            (row.job.status === 'awaiting_upload' || row.job.status === 'analyzing' || row.job.status === 'rendering') &&
            Date.parse(row.job.updatedAt) < now() - idleMs &&
            row.leaseUntil < now(),
        )
        .sort((a, b) => Date.parse(a.job.updatedAt) - Date.parse(b.job.updatedAt))
        .slice(0, limit)
        .map(row => row.job.editJobId);
    },
    async claimLease(editJobId, owner, leaseMs) {
      const row = rows.get(editJobId);
      if (!row || isTerminalStatus(row.job.status)) {
        return false;
      }
      if (row.leaseUntil >= now() && row.leaseOwner !== owner) {
        return false;
      }
      row.leaseOwner = owner;
      row.leaseUntil = now() + leaseMs;
      return true;
    },
    async releaseLease(editJobId, owner) {
      const row = rows.get(editJobId);
      if (row && row.leaseOwner === owner) {
        row.leaseOwner = null;
        row.leaseUntil = 0;
      }
    },
    async purge() {
      const inactiveMs = env.EDIT_JOB_INACTIVE_DAYS * 86_400_000;
      const terminalMs = env.EDIT_JOB_TERMINAL_DAYS * 86_400_000;
      let expired = 0;
      let deleted = 0;
      for (const [id, row] of rows) {
        const age = now() - Date.parse(row.job.updatedAt);
        if (isTerminalStatus(row.job.status)) {
          if (age > terminalMs) {
            rows.delete(id);
            deleted += 1;
          }
        } else if (age > inactiveMs) {
          row.job = {...row.job, status: 'failed', errorCode: 'expired', errorMessage: 'This edit expired. Start it again.', updatedAt: new Date(now()).toISOString()};
          expired += 1;
        }
      }
      return {expired, deleted};
    },
  };
}

// ---------------------------------------------------------------------------

let injected: DurableJobStore | null | undefined;
let configured: DurableJobStore | null | undefined;

/** The durable store, or null when no service-role key is configured (local development: KV only). */
export function getDurableJobStore(): DurableJobStore | null {
  if (injected !== undefined) {
    return injected;
  }
  if (configured === undefined) {
    configured =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? createPostgrestJobStore({url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY})
        : null;
    if (!configured) {
      logger.warn('durable edit jobs disabled: SUPABASE_SERVICE_ROLE_KEY is not set (full edits live in KV only, 24h)');
    }
  }
  return configured;
}

/** Tests: `undefined` restores the configured store. */
export function setDurableJobStoreForTests(store: DurableJobStore | null | undefined): void {
  injected = store;
}
