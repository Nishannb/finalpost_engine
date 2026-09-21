/**
 * LUT catalog for the director and the post-edit picker.
 *
 * `name` MUST match the .cube basename in ai-video-engine/luts/ (no extension).
 * Leave this list empty until looks are graded; Neutral is always shown first
 * in the app, then the director's ranked ids, then the rest of this catalog.
 *
 * Example row:
 * {
 *   name: 'CELLULOID_01_FU_LOW',
 *   gamma: 'Blackmagic BMD Film 4K',
 *   color: 'Blue',
 *   key: 'Neutral',
 *   style: 'cine drama',
 * }
 */

export type LutCatalogEntry = {
  name: string;
  gamma: string;
  color: string;
  key: string;
  style: string;
};

/** Fake / empty until looks are added. */
export const LUT_CATALOG: LutCatalogEntry[] = [];

export const LUT_RANK_LIMIT = 10;

export function lutCatalogIds(): string[] {
  return LUT_CATALOG.map(entry => entry.name).filter(Boolean);
}

export function lutCatalogEntries(): LutCatalogEntry[] {
  return LUT_CATALOG.filter(entry => Boolean(entry.name.trim()));
}

export function formatLutsForDirectorPrompt(entries: LutCatalogEntry[]): string {
  if (entries.length === 0) {
    return '(none — leave preferred_lut empty and suggested_luts [])';
  }
  return entries
    .map(
      entry =>
        `${entry.name}\nGamma: ${entry.gamma}\nColor: ${entry.color}\nKey: ${entry.key}\nStyle: ${entry.style}`,
    )
    .join('\n\n');
}

export function coerceLutId(
  raw: unknown,
  available: Set<string> | string[],
): string {
  const id = String(raw ?? '').trim();
  if (!id) {
    return '';
  }
  const set = available instanceof Set ? available : new Set(available);
  return set.has(id) ? id : '';
}

export function parseSuggestedLutIds(
  raw: unknown,
  available: string[],
  limit = LUT_RANK_LIMIT,
): string[] {
  const set = new Set(available);
  const rows = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const row of rows) {
    const id = coerceLutId(row, set);
    if (id && !out.includes(id)) {
      out.push(id);
    }
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/** Kept for older call sites; catalog is the only source now. */
export function shortlistLutsForDirector(): LutCatalogEntry[] {
  return lutCatalogEntries();
}
