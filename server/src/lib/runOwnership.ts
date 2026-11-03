/**
 * Phase 36E: proof of ownership for one run's files, so a later cleanup can be limited to what THAT invocation created.
 *
 * The run writes `run-manifest.json` into its freshly claimed output directory (exclusive create). Every path the run creates outside that directory (shared
 * scratch under the repository) is recorded with whether it already existed before the run touched it. `planOwnedCleanup` returns ONLY entries that are
 * recorded as created by this run, lie inside an allowed root, and (for the output directory) sit beside a manifest with the same run id. Nothing here deletes
 * anything on its own; `removeOwned` executes a plan and re-checks every path. The Phase 36E code never calls it.
 */
import {existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE = 'run-manifest.json';

export type OwnedEntry = {path: string; kind: 'file' | 'dir'; createdByThisRun: boolean};
export type RunManifest = {schema: 1; runId: string; mode: string; outDir: string; createdAt: string; pid: number; owned: OwnedEntry[]};

export function createRunOwnership(outDir: string, meta: {runId: string; mode: string}) {
  const manifest: RunManifest = {schema: 1, runId: meta.runId, mode: meta.mode, outDir, createdAt: new Date().toISOString(), pid: process.pid, owned: []};
  const file = path.join(outDir, MANIFEST_FILE);
  writeFileSync(file, JSON.stringify(manifest, null, 1), {flag: 'wx'}); // exclusive: never replaces an existing manifest
  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest, null, 1));
    renameSync(tmp, file);
  };
  return {
    manifest,
    /** Call BEFORE creating `target`: `existedBefore` decides whether this run may ever remove it. */
    record(target: string, kind: OwnedEntry['kind'], existedBefore: boolean = existsSync(target)) {
      manifest.owned.push({path: path.resolve(target), kind, createdByThisRun: !existedBefore});
      save();
    },
    save,
  };
}

export function readManifest(outDir: string): RunManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(outDir, MANIFEST_FILE), 'utf8')) as RunManifest;
    return parsed.schema === 1 && typeof parsed.runId === 'string' && Array.isArray(parsed.owned) ? parsed : null;
  } catch {
    return null;
  }
}

const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export type CleanupPlan = {remove: string[]; skipped: Array<{path: string; reason: string}>};

export function planOwnedCleanup(manifest: RunManifest, allowedRoots: string[]): CleanupPlan {
  const plan: CleanupPlan = {remove: [], skipped: []};
  const roots = allowedRoots.map(root => path.resolve(root));
  for (const entry of manifest.owned) {
    const target = path.resolve(entry.path);
    if (!path.isAbsolute(entry.path) || target !== path.normalize(entry.path).replace(/[\\/]+$/, '')) plan.skipped.push({path: entry.path, reason: 'not an absolute normalised path'});
    else if (!entry.createdByThisRun) plan.skipped.push({path: target, reason: 'existed before this run; not owned'});
    else if (!roots.some(root => inside(root, target))) plan.skipped.push({path: target, reason: 'outside every allowed root'});
    else plan.remove.push(target);
  }
  return plan;
}

/** Executes a plan. Re-validates every path: it must still be inside an allowed root and must not be a symlink. Returns what it removed. */
export function removeOwned(plan: CleanupPlan, allowedRoots: string[]): string[] {
  const roots = allowedRoots.map(root => path.resolve(root));
  const removed: string[] = [];
  for (const target of plan.remove) {
    if (!roots.some(root => inside(root, target))) continue;
    try {
      if (lstatSync(target).isSymbolicLink()) continue;
    } catch {
      continue; // already gone
    }
    rmSync(target, {recursive: true, force: false});
    removed.push(target);
  }
  return removed;
}
