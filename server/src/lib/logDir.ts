/**
 * Phase 36E: where the engine's persistent log lives. Pure (no imports of the logger), so it can be tested without opening any log file.
 *
 * Default: the application's own `<repo>/logs` (unchanged). `ENGINE_LOG_DIR` may redirect it, and a redirect is VALIDATED, never silently ignored: it must be an
 * absolute, normalised path with no NUL and no `..` segments. An invalid value throws at logger import (fail closed). The override is how an isolated run keeps
 * its logs inside its own workspace instead of appending to the protected `logs/engine.log`.
 */
import path from 'node:path';

export function resolveLogDir(defaultDir: string, override: string | undefined): string {
  if (override === undefined || override.trim() === '') {
    return defaultDir;
  }
  const value = override.trim();
  const problem =
    value.includes('\0') ? 'contains a NUL byte'
    : !path.isAbsolute(value) ? 'is not an absolute path'
    : value.split(path.sep).includes('..') ? 'contains a ".." segment'
    : path.resolve(value) !== value.replace(/[\\/]+$/, '') ? 'is not normalised'
    : null;
  if (problem) {
    throw new Error(`ENGINE_LOG_DIR ${problem}; refusing to fall back to the default log directory`);
  }
  return path.resolve(value);
}
