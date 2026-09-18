/**
 * LUT catalog metadata for the creative director.
 *
 * Ids match .cube basenames under ai-video-engine/luts/.
 * Keep blurbs short — the full list is only embedded in the Gemini prompt
 * while the catalog is small. When the library grows (1000+), call
 * `shortlistLutsForDirector` with cheap look tags instead of dumping all.
 */

import {listAvailableLuts} from './luts.ts';

export type LutCatalogEntry = {
  id: string;
  title: string;
  blurb: string;
  /** Coarse tags for future non-LLM shortlisting. */
  tags: string[];
};

const KNOWN: Record<string, Omit<LutCatalogEntry, 'id'>> = {
  CELLULOID_01_FU_LOW: {
    title: 'Celluloid',
    blurb: 'Soft film density, gentle contrast, skin-safe',
    tags: ['warm', 'soft', 'film', 'skin-safe', 'daylight'],
  },
  'CineStill-800-T-V1.0--N125': {
    title: 'CineStill 800T',
    blurb: 'Night tungsten glow, cool shadows',
    tags: ['cool', 'night', 'tungsten', 'cinematic'],
  },
  Cinematic_for_Flog: {
    title: 'Cinematic',
    blurb: 'Teal-orange short-form look, punchy',
    tags: ['teal', 'orange', 'contrast', 'social'],
  },
  Colorist_Factory_Severn_LUT: {
    title: 'Severn',
    blurb: 'Clean colorist polish, neutral',
    tags: ['neutral', 'clean', 'skin-safe', 'daylight'],
  },
  TL_R709_V2: {
    title: 'Rec.709',
    blurb: 'Broadcast-safe contrast, natural',
    tags: ['neutral', 'natural', 'broadcast', 'skin-safe'],
  },
  'Vintage_Warmth_1.C0427': {
    title: 'Vintage Warmth',
    blurb: 'Sun-faded amber tones, lifestyle',
    tags: ['warm', 'vintage', 'soft', 'lifestyle'],
  },
};

/** Max LUT cards embedded in a single director prompt (token guard). */
export const LUT_DIRECTOR_PROMPT_CAP = 40;

export function lutCatalogEntries(): LutCatalogEntry[] {
  const onDisk = listAvailableLuts();
  return onDisk.map(id => {
    const known = KNOWN[id];
    if (known) {
      return {id, ...known};
    }
    return {
      id,
      title: id.replace(/[_-]+/g, ' ').slice(0, 28),
      blurb: 'Color grade look',
      tags: tokenizeLutId(id),
    };
  });
}

function tokenizeLutId(id: string): string[] {
  return id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(part => part.length > 2)
    .slice(0, 8);
}

/**
 * Entries to show the director. Today the catalog is tiny so we send all.
 * Later: filter by look tags (warm/cool/…) before this call — never send 4000.
 */
export function shortlistLutsForDirector(opts?: {
  lookTags?: string[];
  cap?: number;
}): LutCatalogEntry[] {
  const cap = Math.max(3, Math.min(LUT_DIRECTOR_PROMPT_CAP, opts?.cap ?? LUT_DIRECTOR_PROMPT_CAP));
  const all = lutCatalogEntries();
  const tags = (opts?.lookTags || []).map(t => t.toLowerCase()).filter(Boolean);
  if (tags.length === 0 || all.length <= cap) {
    return all.slice(0, cap);
  }
  const scored = all
    .map(entry => {
      const hay = `${entry.title} ${entry.blurb} ${entry.tags.join(' ')}`.toLowerCase();
      const hits = tags.reduce((n, tag) => n + (hay.includes(tag) ? 1 : 0), 0);
      return {entry, hits};
    })
    .sort((a, b) => b.hits - a.hits || a.entry.title.localeCompare(b.entry.title));
  const picked = scored.filter(row => row.hits > 0).map(row => row.entry);
  if (picked.length >= 3) {
    return picked.slice(0, cap);
  }
  return all.slice(0, cap);
}

export function formatLutsForDirectorPrompt(entries: LutCatalogEntry[]): string {
  if (entries.length === 0) {
    return '(none — leave preferred_lut empty)';
  }
  return entries
    .map(entry => `- ${entry.id} | ${entry.title}: ${entry.blurb}`)
    .join('\n');
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
  limit = 3,
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
