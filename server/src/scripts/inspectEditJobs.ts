/**
 * READ-ONLY: what did the latest full edits really run? Prints, for each recent job, the style / footage the app sent,
 * the status, how many B-roll asks the plan carried, and the pipeline diagnostics from the saved blueprint
 * (editing_pipeline, kinetic_engine / kinetic_composer, speaker box, matte, asset brief).
 *
 *   cd server && node --experimental-strip-types src/scripts/inspectEditJobs.ts [limit=3] [--all-warnings]
 *
 * Reads public.creator_edit_jobs through PostgREST with the server's own service key. No writes, no paid calls,
 * no secret is printed (only job ids, statuses and diagnostic strings).
 */
import {env} from '../config/env.ts';

const DIAG = /^(editing_pipeline:|style_|kinetic_|asset_brief:|refusal:|labeled_|broll_opportunit|v1_)/;

type Row = {edit_job_id: string; status: string; mode: string; created_at: string; asset_brief: unknown; job: Record<string, unknown>; blueprint?: Record<string, unknown> | null};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limit = Math.max(1, Math.min(20, Number(args.find(a => /^\d+$/.test(a)) ?? 3)));
  const all = args.includes('--all-warnings');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: this engine keeps no durable jobs to inspect.');
    process.exit(2);
  }
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/creator_edit_jobs?select=edit_job_id,status,mode,created_at,asset_brief,job,blueprint&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {headers: {apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
  if (!res.ok) {
    console.error(`query failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const rows = (await res.json()) as Row[];
  if (rows.length === 0) console.log('no full-edit jobs found');
  for (const row of rows) {
    const job = row.job ?? {};
    const bp = (row.blueprint ?? {}) as Record<string, unknown>;
    const warnings = Array.isArray(bp.warnings) ? (bp.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : [];
    const brief = (row.asset_brief ?? bp.assetBrief) as {slots?: Array<{label?: string; kind?: string}>} | null;
    const kinetic = bp.kinetic as {events?: unknown[]} | undefined;
    console.log('='.repeat(72));
    console.log(`${row.edit_job_id}  ${row.created_at}  status=${row.status}  mode=${row.mode}`);
    console.log(`  app sent: style=${String(job.style ?? '(none)')} footageKind=${String(job.footageKind ?? '(none)')} preset=${String(job.captionPreset ?? '(none)')}`);
    console.log(`  error: ${String(job.errorCode ?? '')} ${String(job.errorMessage ?? '')}`.trimEnd());
    console.log(`  blueprint saved: ${row.blueprint ? 'yes' : 'no'}  kinetic spec: ${kinetic ? `yes (${kinetic.events?.length ?? '?'} events)` : 'no'}`);
    console.log(`  B-roll asks: ${brief?.slots?.length ?? 0}${brief?.slots?.length ? `  [${brief.slots.map(s => `${s.kind}:${s.label}`).join(' | ')}]` : ''}`);
    console.log('  diagnostics:');
    for (const w of all ? warnings : warnings.filter(w => DIAG.test(w))) console.log(`    ${w.slice(0, 200)}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
