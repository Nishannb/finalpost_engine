/** Stable JSON for golden comparison: sorted keys, numbers rounded to 1e-4, volatile fields removed. */

const VOLATILE_KEYS = new Set(['estimatedCostUsd', 'createdAt', 'blueprintId']);

export function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : String(value);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || VOLATILE_KEYS.has(key)) {
        continue;
      }
      out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 1);
}
