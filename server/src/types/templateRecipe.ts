/**
 * Server copy of the mobile TemplateRecipe — keep fields in sync with
 * `src/lib/videoTemplateRecipe.ts`.
 */

import {CAPTION_TEMPLATES, HOOK_STYLES} from './blueprint.ts';
import {listAvailableLuts, normalizeLutId} from '../stages/color/luts.ts';

export const TEMPLATE_ENERGIES = [
  'calm',
  'educational',
  'hype',
  'sales',
  'story',
] as const;
export type TemplateEnergy = (typeof TEMPLATE_ENERGIES)[number];

export type VideoTemplateRecipe = {
  version: 1;
  summary: string;
  energy: TemplateEnergy;
  captionTemplate: (typeof CAPTION_TEMPLATES)[number];
  hookStyle: (typeof HOOK_STYLES)[number];
  preferredLutId: string;
  suggestedLutIds: string[];
  brollDensity: number;
  zoomDensity: number;
  trimSilence: boolean;
  directorNotes: string;
  /** Full generative prompt for Seedance / video models. */
  seedancePrompt: string;
};

const WATERMARK_NOTE =
  'Ignore any Instagram, Facebook, TikTok, or Meta watermarks in the reference. Never burn platform watermarks into the output.';

const DEFAULT_SEEDANCE_PROMPT =
  'Create a vertical 9:16 social short with punchy kinetic captions, clean talking-head framing, light B-roll accents, and a cinematic grade. No platform watermarks or UI chrome.';

export function defaultVideoTemplateRecipe(
  partial?: Partial<VideoTemplateRecipe>,
): VideoTemplateRecipe {
  return {
    version: 1,
    summary: 'Clean talking-head social edit',
    energy: 'sales',
    captionTemplate: 'hormozi',
    hookStyle: 'impact',
    preferredLutId: 'CELLULOID_01_FU_LOW',
    suggestedLutIds: ['CELLULOID_01_FU_LOW'],
    brollDensity: 0.55,
    zoomDensity: 0.5,
    trimSilence: true,
    directorNotes: WATERMARK_NOTE,
    seedancePrompt: DEFAULT_SEEDANCE_PROMPT,
    ...partial,
  };
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, n));
}

export function coerceVideoTemplateRecipe(raw: unknown): VideoTemplateRecipe {
  const base = defaultVideoTemplateRecipe();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const record = raw as Record<string, unknown>;
  const available = listAvailableLuts();
  const availableSet = new Set(available);
  const suggestedRaw = Array.isArray(record.suggestedLutIds)
    ? record.suggestedLutIds
    : Array.isArray(record.suggested_luts)
      ? record.suggested_luts
      : [];
  const suggestedLutIds = suggestedRaw
    .map(item => normalizeLutId(String(item ?? '')))
    .filter(id => id && availableSet.has(id))
    .filter((id, index, arr) => arr.indexOf(id) === index)
    .slice(0, 3);
  let preferredLutId = normalizeLutId(
    String(record.preferredLutId ?? record.preferred_lut ?? ''),
  );
  if (preferredLutId && !availableSet.has(preferredLutId)) {
    preferredLutId = '';
  }
  if (!preferredLutId && suggestedLutIds[0]) {
    preferredLutId = suggestedLutIds[0];
  }
  if (preferredLutId && !suggestedLutIds.includes(preferredLutId)) {
    suggestedLutIds.unshift(preferredLutId);
  }
  const captionRaw = String(
    record.captionTemplate ?? record.caption_template ?? '',
  )
    .trim()
    .toLowerCase();
  const captionTemplate = (CAPTION_TEMPLATES as readonly string[]).includes(
    captionRaw,
  )
    ? (captionRaw as VideoTemplateRecipe['captionTemplate'])
    : base.captionTemplate;
  const hookRaw = String(record.hookStyle ?? record.hook_style ?? '')
    .trim()
    .toLowerCase();
  const hookStyle = (HOOK_STYLES as readonly string[]).includes(hookRaw)
    ? (hookRaw as VideoTemplateRecipe['hookStyle'])
    : base.hookStyle;
  const energyRaw = String(record.energy ?? '')
    .trim()
    .toLowerCase();
  const energy = (TEMPLATE_ENERGIES as readonly string[]).includes(energyRaw)
    ? (energyRaw as TemplateEnergy)
    : base.energy;
  const notes = String(
    record.directorNotes ?? record.director_notes ?? '',
  ).trim();
  const seedancePrompt = String(
    record.seedancePrompt ??
      record.seedance_prompt ??
      record.prompt ??
      '',
  )
    .trim()
    .slice(0, 4000);
  return {
    version: 1,
    summary:
      String(record.summary ?? base.summary).trim().slice(0, 160) ||
      base.summary,
    energy,
    captionTemplate,
    hookStyle,
    preferredLutId,
    suggestedLutIds: suggestedLutIds.slice(0, 3),
    brollDensity: clamp01(
      record.brollDensity ?? record.broll_density,
      base.brollDensity,
    ),
    zoomDensity: clamp01(
      record.zoomDensity ?? record.zoom_density,
      base.zoomDensity,
    ),
    trimSilence:
      record.trimSilence === false || record.trim_silence === false
        ? false
        : true,
    directorNotes: notes.includes('watermark')
      ? notes
      : `${notes ? `${notes} ` : ''}${WATERMARK_NOTE}`.trim(),
    seedancePrompt: seedancePrompt || base.seedancePrompt,
  };
}
