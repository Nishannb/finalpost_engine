/**
 * Where the engine reads `.env` files from, and when it must NOT.
 *
 * `config/env.ts` loads the engine / Kinmel `.env` files with `override: true`: right for development and production, wrong for offline tests, which would silently run with real provider credentials and
 * real flag values (Phase 4.2 found a worktree `.env` changing 4 of 25 flag-off parity combinations). Under vitest (`VITEST=true`) no file is loaded. A deliberate live script (not a test) is unaffected;
 * a test that really needs the files must say so with `ENGINE_TEST_LOAD_DOTENV=1`.
 */
import {existsSync} from 'node:fs';

import dotenv from 'dotenv';

export type EnvLike = Record<string, string | undefined>;

/** false only under vitest without the explicit opt-in */
export function dotenvEnabled(processEnv: EnvLike = process.env): boolean {
  return processEnv.VITEST !== 'true' || processEnv.ENGINE_TEST_LOAD_DOTENV === '1';
}

/** Loads each existing candidate in order (later files override earlier ones, as before). Returns the files it loaded. */
export function loadDotenvFiles(candidates: readonly string[], processEnv: EnvLike = process.env, opts: {parseInto?: EnvLike} = {}): string[] {
  if (!dotenvEnabled(processEnv)) return [];
  const loaded: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    dotenv.config({path: candidate, quiet: true, override: true, ...(opts.parseInto ? {processEnv: opts.parseInto as Record<string, string>} : {})});
    loaded.push(candidate);
  }
  return loaded;
}
