/**
 * Resolve .cube LUTs shipped under ai-video-engine/luts/.
 *
 * Callers pass a short id (basename without extension), e.g. CELLULOID_01_FU_LOW.
 */

import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const LUTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../luts',
);

export function lutsDirectory(): string {
  return LUTS_DIR;
}

export function listAvailableLuts(): string[] {
  if (!existsSync(LUTS_DIR)) {
    return [];
  }
  return readdirSync(LUTS_DIR)
    .filter(name => /\.cube$/i.test(name))
    .map(name => name.replace(/\.cube$/i, ''))
    .sort((a, b) => a.localeCompare(b));
}

/** Accepts id, filename, or absolute path. Returns absolute .cube path or null. */
export function resolveLutPath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) {
    return null;
  }
  if (path.isAbsolute(value) && existsSync(value) && /\.cube$/i.test(value)) {
    return value;
  }
  const asFile = value.replace(/\.cube$/i, '');
  const candidate = path.join(LUTS_DIR, `${asFile}.cube`);
  if (existsSync(candidate)) {
    return candidate;
  }
  const loose = path.join(LUTS_DIR, value);
  if (existsSync(loose) && /\.cube$/i.test(loose)) {
    return loose;
  }
  return null;
}

export function normalizeLutId(raw: string | null | undefined): string {
  const resolved = resolveLutPath(raw);
  if (!resolved) {
    return '';
  }
  return path.basename(resolved).replace(/\.cube$/i, '');
}
