/**
 * The SQL migrations cannot be executed in this test environment (no Postgres), so their security-relevant
 * statements are pinned as text. This does not replace running them against Supabase and trying the verification
 * statements in the migration comments.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const sql = (name: string) => readFileSync(resolve(REPO, 'supabase', 'migrations', name), 'utf8');

describe('20261105120100_protect_creator_entitlement_columns.sql', () => {
  const text = sql('20261105120100_protect_creator_entitlement_columns.sql');

  it('rejects a client changing is_nepal_verified on creators', () => {
    expect(text).toMatch(/before update on public\.creators/i);
    expect(text).toContain('is_nepal_verified');
    expect(text).toMatch(/current_user in \('anon', 'authenticated'\)/);
    expect(text).toMatch(/new\.is_nepal_verified is distinct from old\.is_nepal_verified/);
    expect(text).toMatch(/errcode = '42501'/);
  });

  it('is SECURITY INVOKER, so current_user is the request role and the service role stays allowed', () => {
    const fn = text.slice(text.indexOf('create or replace function'), text.indexOf('drop trigger'));
    expect(fn.toLowerCase()).not.toContain('security definer');
  });

  it('the creators table still has no client INSERT policy that could set the flag', () => {
    const base = sql('20260902120000_kinmel_creators_schema.sql');
    expect(base).not.toMatch(/create policy \w+ on public\.creators for insert/i);
  });
});

describe('20261105120000_creator_edit_jobs.sql', () => {
  const text = sql('20261105120000_creator_edit_jobs.sql');

  it('is service-role only: row security on, no policies, no client privileges', () => {
    expect(text).toMatch(/alter table public\.creator_edit_jobs enable row level security/i);
    expect(text).toMatch(/revoke all on public\.creator_edit_jobs from anon, authenticated/i);
    expect(text).not.toMatch(/create policy/i);
  });

  it('keeps the data a creator needs and the indexes recovery and retention use', () => {
    for (const column of ['edit_job_id text primary key', 'user_id text not null', 'status text not null', 'blueprint_id', 'input_video_url', 'output_url', 'asset_brief jsonb', 'job jsonb not null', 'blueprint jsonb', 'lease_until timestamptz', 'created_at', 'updated_at']) {
      expect(text).toContain(column);
    }
    expect(text).toMatch(/\(user_id, created_at desc\)/);
    expect(text).toMatch(/where status in \('awaiting_upload', 'analyzing', 'rendering'\)/);
    expect(text).toMatch(/\(status, updated_at\)/);
  });

  it('retention: expire inactive jobs after 30 days, delete finished ones after 90; the purge function is not callable by clients', () => {
    expect(text).toMatch(/inactive_days integer default 30/);
    expect(text).toMatch(/terminal_days integer default 90/);
    expect(text).toMatch(/revoke all on function public\.purge_creator_edit_jobs\(integer, integer\) from public, anon, authenticated/i);
  });
});
