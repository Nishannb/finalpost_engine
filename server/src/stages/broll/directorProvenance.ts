/**
 * Phase 36I: strict-mode provenance. Pure (no imports, no I/O, no environment): safe to unit-test without the logger, `.env` or any provider SDK.
 *
 * The problem it solves: the Director parser completes its own result from the deterministic fallback (`ensureMotionCoverage`) and the planner fills empty zooms and
 * moments, so "this field is populated" says nothing about who produced it. Provenance is therefore captured from the RAW Director record and the parser's own
 * Director-only counts, before any fallback runs, and is never inferred from a final object.
 *
 *   origin 'director'  the Director supplied at least one item that survived parsing
 *   origin 'rejected'  the Director supplied items but every one was discarded by the parser
 *   origin 'absent'    the Director supplied nothing (key missing, null, or an empty list) and nothing was substituted at capture time
 *   origin 'fallback'  the Director supplied nothing usable and the parser's completed result is non-empty: the content is deterministic
 *
 * `keyPresent` records whether the Director's JSON mentioned the field at all, so an explicit empty list (a choice) is distinguishable from an omission.
 * Observation only: nothing here changes the plan. Activation: analyzeVideo's `strictProvenance` option (default off) captures it and `assertStrictProvenance` enforces it.
 */

export const PROVENANCE_FIELDS = ['openingPlan', 'zooms', 'moments', 'motionGraphics', 'semanticEmphasis', 'mediaContainers', 'frameInsets'] as const;
export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];
export type FieldOrigin = 'director' | 'rejected' | 'absent' | 'fallback';

export type FieldProvenance = {
  origin: FieldOrigin;
  /** The Director's JSON mentioned this field (even as an empty list). */
  keyPresent: boolean;
  /** Items the Director supplied before parsing (arrays: length; opening plan: 1 when a non-null value was given). */
  rawCount: number;
  /** Items the Director supplied that survived parsing, counted WITHOUT any fallback. */
  directorCount: number;
  /** Items in the parser's completed result at capture time (may include fallback items). */
  completedCount: number;
};

export type DirectorProvenance = {version: 1; fields: Record<ProvenanceField, FieldProvenance>};

/** The JSON keys (both spellings the parsers accept) that carry each field. */
export const FIELD_KEYS: Record<ProvenanceField, readonly string[]> = {
  openingPlan: ['opening_plan'],
  zooms: ['zooms'],
  moments: ['moments'],
  motionGraphics: ['motion_graphics', 'motionGraphics'],
  semanticEmphasis: ['semantic_emphasis', 'semanticEmphasis'],
  mediaContainers: ['media_containers', 'mediaContainers'],
  frameInsets: ['frame_insets', 'frameInsets'],
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function rawValueOf(raw: unknown, field: ProvenanceField): {keyPresent: boolean; rawCount: number} {
  if (!isRecord(raw)) return {keyPresent: false, rawCount: 0};
  const key = FIELD_KEYS[field].find(name => name in raw);
  if (key === undefined) return {keyPresent: false, rawCount: 0};
  const value = raw[key];
  if (value === null || value === undefined) return {keyPresent: true, rawCount: 0};
  if (field === 'openingPlan') return {keyPresent: true, rawCount: value === false || value === '' || value === 0 ? 0 : 1};
  return {keyPresent: true, rawCount: Array.isArray(value) ? value.length : 0};
}

export function classifyField(input: {keyPresent: boolean; rawCount: number; directorCount: number; completedCount: number}): FieldOrigin {
  if (input.directorCount > 0) return 'director';
  if (input.completedCount > 0) return 'fallback';
  if (input.rawCount > 0) return 'rejected';
  return 'absent';
}

/**
 * Build provenance from the Director's raw JSON record and the parser's counts. `directorCounts` must come from parsing WITHOUT fallback completion;
 * `completedCounts` from the parser's final result. A field missing from either map counts as 0 (never as supplied).
 */
export function buildProvenance(input: {
  raw: unknown;
  directorCounts: Partial<Record<ProvenanceField, number>>;
  completedCounts: Partial<Record<ProvenanceField, number>>;
}): DirectorProvenance {
  const fields = {} as Record<ProvenanceField, FieldProvenance>;
  for (const field of PROVENANCE_FIELDS) {
    const raw = rawValueOf(input.raw, field);
    const directorCount = Math.max(0, input.directorCounts[field] ?? 0);
    // The opening plan is never completed by the parser: its Director count is its raw count (validation happens in the resolver).
    const effectiveDirector = field === 'openingPlan' ? raw.rawCount : directorCount;
    // The opening plan is never completed by any fallback, so a caller-supplied completed count for it is ignored (it could otherwise turn a missing plan into 'fallback').
    const completedCount = field === 'openingPlan' ? effectiveDirector : Math.max(effectiveDirector, input.completedCounts[field] ?? 0);
    fields[field] = {...raw, directorCount: effectiveDirector, completedCount, origin: classifyField({...raw, directorCount: effectiveDirector, completedCount})};
  }
  return {version: 1, fields};
}

export type ProvenanceViolation = {field: ProvenanceField; origin: FieldOrigin; reason: string};

/**
 * Strict judgement. A field violates when its content is fallback-made, when the Director's items were all rejected, or when it is in `requiredFromDirector` and the
 * Director did not supply it. Malformed provenance (wrong version, missing field) is itself a violation for every field: it fails closed.
 */
export function judgeProvenance(provenance: unknown, options: {requiredFromDirector?: readonly ProvenanceField[]} = {}): ProvenanceViolation[] {
  const required = new Set(options.requiredFromDirector ?? []);
  const violations: ProvenanceViolation[] = [];
  const valid = isRecord(provenance) && provenance.version === 1 && isRecord(provenance.fields);
  for (const field of PROVENANCE_FIELDS) {
    const entry = valid ? (provenance.fields as Record<string, unknown>)[field] : undefined;
    if (!isRecord(entry) || !['director', 'rejected', 'absent', 'fallback'].includes(entry.origin as string)) {
      violations.push({field, origin: 'absent', reason: 'provenance missing or malformed'});
      continue;
    }
    const origin = entry.origin as FieldOrigin;
    if (origin === 'fallback') violations.push({field, origin, reason: 'deterministic fallback content stands in for a field the Director did not supply'});
    else if (origin === 'rejected') violations.push({field, origin, reason: 'every item the Director supplied was discarded by the parser'});
    else if (origin === 'absent' && required.has(field)) violations.push({field, origin, reason: 'required from the Director and not supplied'});
  }
  return violations;
}
