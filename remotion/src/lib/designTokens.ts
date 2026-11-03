/**
 * Design tokens: which design object a render uses (Phase 31 migration, dual-read).
 *
 * A blueprint can carry the design under the preferred key `designTokens` and, during the compatibility window, under the legacy key
 * `northStarDesign`. Rules:
 *   1. a valid `designTokens` wins;
 *   2. otherwise a valid `northStarDesign` is used;
 *   3. otherwise there is no design (a malformed object is never treated as a design);
 *   4. if both are valid but differ, `designTokens` wins, the objects are NEVER merged, and a `design_fields_conflict` diagnostic is returned.
 *
 * "Valid" = passes the design schema AND the four fields that are defined as colours are 6-digit hex (#RRGGBB). Non-colour fields get no
 * colour validation. A render does not apply the zod schema to its input props (measured), so this function is the real validation.
 *
 * Pure and framework-free. No content taxonomy, no default theme: it only chooses between objects that already exist.
 */

import {designTokensSchema, type DesignTokens} from '../blueprintSchema';

/** The fields explicitly defined as colours. */
export const DESIGN_COLOUR_FIELDS = ['primaryColor', 'secondaryColor', 'inkColor', 'surfaceColor'] as const;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export type DesignSource = 'designTokens' | 'northStarDesign' | 'none';
export type DesignDiagnosticCode = 'design_fields_conflict' | 'design_tokens_invalid_ignored' | 'design_legacy_invalid_ignored';
export type DesignDiagnostic = {code: DesignDiagnosticCode; message: string};

export type DesignValidation = {ok: true; tokens: DesignTokens} | {ok: false; reasons: string[]};

export function validateDesignTokens(value: unknown): DesignValidation {
  const parsed = designTokensSchema.safeParse(value);
  if (!parsed.success) {
    return {ok: false, reasons: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)};
  }
  const bad = DESIGN_COLOUR_FIELDS.filter(field => !HEX6.test(parsed.data[field]));
  if (bad.length > 0) {
    return {ok: false, reasons: bad.map(field => `${field}: not a 6-digit hex colour`)};
  }
  // Return the caller's own object (not zod's copy) so a valid legacy design renders exactly as it always did.
  return {ok: true, tokens: value as DesignTokens};
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item));

/** Names of the fields whose values differ between two designs (sorted). */
export function differingDesignFields(a: object, b: object): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(key => canonical(x[key]) !== canonical(y[key])).sort();
}

export type DesignResolution = {tokens: DesignTokens | undefined; source: DesignSource; conflict: boolean; diagnostics: DesignDiagnostic[]};

export function resolveDesignTokens(blueprint: {designTokens?: unknown; northStarDesign?: unknown}): DesignResolution {
  const diagnostics: DesignDiagnostic[] = [];
  // `undefined` is "absent". `null` and anything else is PRESENT and must be valid, or it is reported and ignored.
  const hasNew = blueprint.designTokens !== undefined;
  const hasOld = blueprint.northStarDesign !== undefined;
  const nw = hasNew ? validateDesignTokens(blueprint.designTokens) : undefined;
  const old = hasOld ? validateDesignTokens(blueprint.northStarDesign) : undefined;
  if (nw && !nw.ok) {
    diagnostics.push({code: 'design_tokens_invalid_ignored', message: `designTokens is not a valid design and was ignored (${nw.reasons.join('; ')})`});
  }
  if (old && !old.ok) {
    diagnostics.push({code: 'design_legacy_invalid_ignored', message: `northStarDesign is not a valid design and was ignored (${old.reasons.join('; ')})`});
  }
  if (nw?.ok) {
    let conflict = false;
    if (old?.ok) {
      const fields = differingDesignFields(nw.tokens, old.tokens);
      if (fields.length > 0) {
        conflict = true;
        diagnostics.push({code: 'design_fields_conflict', message: `designTokens and northStarDesign are both valid but differ in: ${fields.join(', ')}; designTokens is used and nothing is merged`});
      }
    }
    return {tokens: nw.tokens, source: 'designTokens', conflict, diagnostics};
  }
  if (old?.ok) {
    return {tokens: old.tokens, source: 'northStarDesign', conflict: false, diagnostics};
  }
  return {tokens: undefined, source: 'none', conflict: false, diagnostics};
}

const reported = new Set<string>();
/** Emits each distinct diagnostic once per process (a render evaluates the blueprint on every frame). `sink` is injectable for tests. */
export function reportDesignDiagnostics(diagnostics: DesignDiagnostic[], sink: (message: string) => void = message => console.warn(message)): void {
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}|${diagnostic.message}`;
    if (!reported.has(key)) {
      reported.add(key);
      sink(`[design-tokens] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
}
export function resetReportedDesignDiagnosticsForTest(): void {
  reported.clear();
}
