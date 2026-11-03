/**
 * Provenance helpers (Phase 28, Step 1a): record where a design value came from, at the point where that is still knowable, and carry
 * it through the stages that rebuild an object. Metadata only: no decision reads it yet, and it never serialises (non-enumerable symbol key,
 * see types/blueprint.ts).
 *
 * Rules:
 *  - stamp where the value is CREATED (parser, compiler, fallback, profile). Never infer "director" from a value's presence downstream.
 *  - a stage that builds a new object from an old one must call carryProvenance; object spread drops the metadata on purpose.
 *  - a missing entry means unknown, which is different from every state.
 */

import {PROVENANCE, type Provenance, type ProvenanceMap} from '../types/blueprint.ts';

type Carrier = {[PROVENANCE]?: ProvenanceMap};

const mapOf = (item: object): ProvenanceMap | undefined => (item as Carrier)[PROVENANCE];

/** Records the origin of one or more fields. Merges with what is already there; returns the same object. */
export function stampProvenance<T extends object>(item: T, entries: ProvenanceMap): T {
  const next: ProvenanceMap = {...(mapOf(item) ?? {}), ...entries};
  Object.defineProperty(item, PROVENANCE, {value: next, enumerable: false, writable: true, configurable: true});
  return item;
}

/** Origin of a field, or undefined when unknown. */
export function provenanceOf(item: object | null | undefined, field: string): Provenance | undefined {
  return item ? mapOf(item)?.[field] : undefined;
}

/** A plain copy of the whole map (for tests and reports), or undefined when the object carries none. */
export function provenanceSnapshot(item: object | null | undefined): ProvenanceMap | undefined {
  const map = item ? mapOf(item) : undefined;
  return map ? {...map} : undefined;
}

/** Copies the metadata of `from` onto `to` (a rebuilt version of the same edit). `to`'s own entries win. Returns `to`. */
export function carryProvenance<T extends object>(from: object | null | undefined, to: T): T {
  if (!from || from === to) {
    return to;
  }
  const map = mapOf(from);
  return map ? stampProvenance(to, {...map, ...(mapOf(to) ?? {})}) : to;
}

/**
 * For a stage that REWRITES some fields on a rebuilt object. `rewrites` maps each field the stage may rewrite to the origin of the
 * value it writes: a field whose value CHANGED is stamped with that origin (the rewriting stage is now the source of the value); a
 * field whose value is unchanged keeps its previous origin.
 */
export function carryProvenanceAfterRewrite<T extends object>(before: object, after: T, rewrites: Readonly<Record<string, Provenance>>): T {
  carryProvenance(before, after);
  const changed: ProvenanceMap = {};
  for (const [field, origin] of Object.entries(rewrites)) {
    if ((before as Record<string, unknown>)[field] !== (after as Record<string, unknown>)[field]) {
      changed[field] = origin;
    }
  }
  return Object.keys(changed).length > 0 ? stampProvenance(after, changed) : after;
}

/**
 * Forwarding a rebuilt edit through a stage that may recolour it (North Star): provenance is carried for every field whose value is
 * unchanged. A field the stage CHANGED has no knowable single origin (a rule, a thesis token), so its entry is removed and reads as
 * unknown: never `director`, never invented.
 */
export function carryProvenanceUnlessChanged<T extends object>(before: object, after: T): T {
  const map = mapOf(before);
  if (!map || before === after) {
    return after;
  }
  const kept: ProvenanceMap = {};
  for (const [field, origin] of Object.entries(map)) {
    if ((before as Record<string, unknown>)[field] === (after as Record<string, unknown>)[field]) {
      kept[field] = origin;
    }
  }
  return Object.keys(kept).length > 0 ? stampProvenance(after, kept) : after;
}

/**
 * Whether a colour value is one the harmonisation maths can work with: a 6-digit hex. (Its contrast and luminance helpers read
 * #RRGGBB; a 3-digit hex gives NaN and a colour name gives nothing.) Provenance says who wrote a value; this says whether it may be kept.
 */
export function isProtectableColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** True only for a value the Director explicitly wrote for this field AND that is usable as is. Unknown provenance is never true. */
export function isDirectorColor(item: object | null | undefined, field: string): boolean {
  return provenanceOf(item, field) === 'director' && isProtectableColor((item as Record<string, unknown> | null | undefined)?.[field]);
}

/** Origin of a colour read from untrusted model output: a valid #RGB / #RRGGBB the model wrote is `director`; anything else is the constant used instead. */
export function colorOrigin(raw: unknown): Provenance {
  return typeof raw === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.trim()) ? 'director' : 'default';
}
