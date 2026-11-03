/**
 * Print the edit lifecycle of a saved run.
 *
 *   npm run ledger -- <run dir> [...more run dirs]
 *
 * A run dir is anything with `director/` inside (e.g. remotion/out/phase7-content-profile/hi).
 * Runs made after the ledger existed have `director/06-edit-ledger.json` (exact reasons);
 * older runs are reconstructed from `01-gemini-director.json` + `03-engine-visual-plan.json`,
 * and every cause that was never recorded is shown as `unknown_cause_not_recorded`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {outcomeOf, summarizeLedger, type LedgerDump} from '../lib/editLedger.ts';
import {backfillLedger, type SavedDirectorResponse, type SavedVisualPlan} from '../lib/ledgerBackfill.ts';

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

export async function loadLedger(runDir: string): Promise<{dump: LedgerDump; source: 'ledger' | 'backfill'} | null> {
  const dir = path.join(runDir, 'director');
  const exact = await readJson<LedgerDump>(path.join(dir, '06-edit-ledger.json'));
  if (exact) {
    return {dump: exact, source: 'ledger'};
  }
  const response = await readJson<{parsed?: SavedDirectorResponse}>(path.join(dir, '01-gemini-director.json'));
  const plan = await readJson<SavedVisualPlan>(path.join(dir, '03-engine-visual-plan.json'));
  return response?.parsed && plan ? {dump: backfillLedger(response.parsed, plan), source: 'backfill'} : null;
}

function render(runDir: string, loaded: NonNullable<Awaited<ReturnType<typeof loadLedger>>>): string {
  const {dump, source} = loaded;
  const summary = summarizeLedger(dump.edits, {stageContext: dump.stageContext, trackTheme: dump.trackTheme, profile: dump.contentProfile});
  const lines = [`== ${runDir}  (${source === 'ledger' ? 'exact ledger' : 'reconstructed from saved dumps; causes may be unknown'})`];
  const types = Object.keys(summary.proposedByType).sort();
  lines.push('type'.padEnd(18) + 'proposed  accepted  lost');
  for (const type of types) {
    lines.push(type.padEnd(18) + String(summary.proposedByType[type]).padEnd(10) + String(summary.acceptedByType[type] ?? 0).padEnd(10) + String(Object.values(summary.lostByTypeAndReason[type] ?? {}).reduce((a, b) => a + b, 0)));
  }
  const lost = Object.entries(summary.lostByTypeAndReason).flatMap(([type, reasons]) => Object.entries(reasons).map(([reason, count]) => `  ${type}: ${reason} ×${count}`));
  lines.push(lost.length > 0 ? 'lost:' : 'lost: none', ...lost);
  lines.push(`outcomes: ${Object.entries(summary.outcomes).filter(([, count]) => count > 0).map(([name, count]) => `${name}=${count}`).join(' ')}`);
  lines.push(`reached renderer: ${Object.entries(summary.reachedRendererByTrack).map(([track, count]) => `${track}=${count}`).join(' ') || 'n/a'}`);
  lines.push(`conflicts: temporal=${summary.conflicts.temporal} spatial=${summary.conflicts.spatial}`);
  lines.push(`content profile: ${summary.profilePresent ? `present (${dump.contentProfile.contentType ?? '?'})` : 'absent'}; stages: ${Object.entries(summary.stageContext).map(([stage, ctx]) => `${stage}[profile=${ctx.profile ? 'y' : 'n'},theme=${ctx.theme ? 'y' : 'n'}]`).join(' ') || 'n/a'}`);
  lines.push(`theme reached: ${Object.entries(summary.trackTheme).map(([track, themed]) => `${track}=${themed ? 'y' : 'n'}`).join(' ') || 'n/a'}`);
  const proposedOnly = dump.edits.filter(entry => outcomeOf(entry) === 'proposed_only').length;
  if (proposedOnly > 0) {
    lines.push(`WARNING: ${proposedOnly} edit(s) have no disposition`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dirs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (dirs.length === 0) {
    throw new Error('usage: ledgerSummary.ts <run dir> [...]');
  }
  for (const dir of dirs) {
    const loaded = await loadLedger(path.resolve(dir));
    console.log(loaded ? render(dir, loaded) : `== ${dir}: no director dumps found`, '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
