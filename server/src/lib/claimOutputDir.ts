/**
 * Phase 36C: claim a brand-new output directory for one experiment run, or refuse.
 *
 * `mkdirSync` WITHOUT `recursive` is atomic in the kernel: of any number of processes racing for the same path, exactly one create succeeds and the rest get
 * EEXIST. There is no separate "does it exist?" check, so there is no time-of-check/time-of-use window on the directory itself. An existing path of ANY kind
 * (empty directory, populated directory, file, symlink) is refused and never modified, deleted or cleaned. Only missing PARENT directories are created.
 */
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export class OutputDirExistsError extends Error {
  readonly dir: string;
  constructor(dir: string) {
    super(`output path already exists: ${dir}. Refusing to reuse it (earlier reports, dumps, frames or MP4s would be overwritten or mixed into this run). Choose a NEW, unique destination; nothing was modified.`);
    this.name = 'OutputDirExistsError';
    this.dir = dir;
  }
}

export function claimOutputDir(dir: string): string {
  const resolved = path.resolve(dir);
  mkdirSync(path.dirname(resolved), {recursive: true});
  try {
    mkdirSync(resolved); // atomic: EEXIST for an existing path of any kind
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OutputDirExistsError(resolved);
    throw error;
  }
  return resolved;
}
