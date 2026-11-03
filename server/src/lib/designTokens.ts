/**
 * Design tokens, server side (Phase 31 migration): the writer for the new blueprint key and the render-time diagnostics.
 *
 * Mirrors `remotion/src/lib/designTokens.ts` (the reader). The two are kept separate on purpose (the server does not import the renderer
 * package) and a test pins that they agree on a table of cases. Rules are identical: schema-valid AND the four colour fields are 6-digit hex.
 * Non-colour fields get no colour validation. This module only chooses and checks existing design objects: no taxonomy, no default theme.
 */

import {NORTH_STAR_DISPLAY_FONTS, NORTH_STAR_MOTION_PRESETS, type DesignTokens, type TimelineBlueprint} from '../types/blueprint.ts';

export const DESIGN_COLOUR_FIELDS = ['primaryColor', 'secondaryColor', 'inkColor', 'surfaceColor'] as const;
export const DESIGN_CONTENT_TYPES = ['educational_tips', 'story', 'sales_pitch', 'opinion', 'tutorial', 'announcement', 'testimonial', 'comedy', 'other'] as const;
export const DESIGN_DENSITIES = ['restrained', 'balanced', 'expressive'] as const;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

const oneOf = (list: readonly string[], value: unknown): boolean => typeof value === 'string' && list.includes(value);

/** Reasons a value is not a usable design; empty when it is one. */
export function designTokenProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['not an object'];
  }
  const item = value as Record<string, unknown>;
  const problems: string[] = [];
  if (item.enabled !== true) problems.push('enabled: expected true');
  if (!oneOf(DESIGN_CONTENT_TYPES, item.contentType)) problems.push('contentType: not a supported value');
  if (!oneOf(NORTH_STAR_DISPLAY_FONTS, item.displayFont)) problems.push('displayFont: not a supported value');
  if (!oneOf(NORTH_STAR_MOTION_PRESETS, item.motionPreset)) problems.push('motionPreset: not a supported value');
  if (!oneOf(DESIGN_DENSITIES, item.density)) problems.push('density: not a supported value');
  if (typeof item.cornerRadius !== 'number' || !Number.isFinite(item.cornerRadius)) problems.push('cornerRadius: expected a finite number');
  for (const field of DESIGN_COLOUR_FIELDS) {
    if (typeof item[field] !== 'string') problems.push(`${field}: expected a string`);
    else if (!HEX6.test(item[field] as string)) problems.push(`${field}: not a 6-digit hex colour`);
  }
  return problems;
}

export const isValidDesignTokens = (value: unknown): value is DesignTokens => designTokenProblems(value).length === 0;

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item));

export function differingDesignFields(a: object, b: object): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(key => canonical(x[key]) !== canonical(y[key])).sort();
}

export type DesignDiagnosticCode = 'design_fields_conflict' | 'design_tokens_invalid_ignored' | 'design_legacy_invalid_ignored';
export type DesignDiagnostic = {code: DesignDiagnosticCode; message: string};
export type DesignSource = 'designTokens' | 'northStarDesign' | 'none';

/** The same decision the renderer makes, reported with diagnostics. `undefined` is absent; anything else present must be valid. */
export function resolveDesignTokens(blueprint: {designTokens?: unknown; northStarDesign?: unknown}): {tokens: DesignTokens | undefined; source: DesignSource; conflict: boolean; diagnostics: DesignDiagnostic[]} {
  const diagnostics: DesignDiagnostic[] = [];
  const newProblems = blueprint.designTokens !== undefined ? designTokenProblems(blueprint.designTokens) : undefined;
  const oldProblems = blueprint.northStarDesign !== undefined ? designTokenProblems(blueprint.northStarDesign) : undefined;
  if (newProblems && newProblems.length > 0) {
    diagnostics.push({code: 'design_tokens_invalid_ignored', message: `designTokens is not a valid design and was ignored (${newProblems.join('; ')})`});
  }
  if (oldProblems && oldProblems.length > 0) {
    diagnostics.push({code: 'design_legacy_invalid_ignored', message: `northStarDesign is not a valid design and was ignored (${oldProblems.join('; ')})`});
  }
  if (newProblems && newProblems.length === 0) {
    let conflict = false;
    if (oldProblems && oldProblems.length === 0) {
      const fields = differingDesignFields(blueprint.designTokens as object, blueprint.northStarDesign as object);
      if (fields.length > 0) {
        conflict = true;
        diagnostics.push({code: 'design_fields_conflict', message: `designTokens and northStarDesign are both valid but differ in: ${fields.join(', ')}; designTokens is used and nothing is merged`});
      }
    }
    return {tokens: blueprint.designTokens as DesignTokens, source: 'designTokens', conflict, diagnostics};
  }
  if (oldProblems && oldProblems.length === 0) {
    return {tokens: blueprint.northStarDesign as DesignTokens, source: 'northStarDesign', conflict: false, diagnostics};
  }
  return {tokens: undefined, source: 'none', conflict: false, diagnostics};
}

/**
 * The writer. Dual-write: a valid design is written under BOTH keys from the SAME object, so they cannot disagree. No design: neither key is
 * written (the blueprint is byte-identical to before). A design that is not valid is NOT copied into the new key; the legacy key keeps the
 * previous behaviour (written as is) and a warning code is returned for the blueprint's warnings.
 */
export function designFieldsForBlueprint(design: DesignTokens | undefined): {fields: Pick<TimelineBlueprint, 'designTokens' | 'northStarDesign'>; warning?: string} {
  if (design === undefined) {
    return {fields: {}};
  }
  const problems = designTokenProblems(design);
  if (problems.length > 0) {
    return {fields: {northStarDesign: design}, warning: `design_tokens_not_written:${problems[0]}`};
  }
  return {fields: {designTokens: design, northStarDesign: design}};
}

/** Render-time diagnostics for a stored blueprint (a conflict, an ignored invalid design). Never throws and never blocks a render. */
export function designDiagnosticsFor(blueprint: Pick<TimelineBlueprint, 'designTokens' | 'northStarDesign'>): DesignDiagnostic[] {
  try {
    return resolveDesignTokens(blueprint).diagnostics;
  } catch {
    return [];
  }
}
