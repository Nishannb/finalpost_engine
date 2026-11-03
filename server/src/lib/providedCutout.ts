/**
 * A client-provided transparent talking-head asset (the RVM matting job's `outputUrl`) handed to analyze as `subjectCutoutUrl`.
 *
 * PURE decisions only (no env, no I/O) so analyzeVideo stays a thin caller. When a URL is provided, analyze does NOT extract a cutout (`extractSpeakerCutout`) and does NOT run the
 * person matte (RVM): the provided asset is the matte. When it is absent every one of those paths is exactly as before.
 */

/** The URL when it is a non-empty http(s) URL, else '' (file:, data:, relative paths, junk and non-strings all mean "not provided"). */
export function normalizeProvidedCutoutUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : '';
  } catch {
    return '';
  }
}

/** The current cutout object plus `available: true` and the provided URL. Returns a new object; the input is not mutated. */
export function applyProvidedCutout<T extends {available?: boolean; videoUrl?: string}>(cutout: T, url: string): T & {available: true; videoUrl: string} {
  return {...cutout, available: true, videoUrl: url};
}

export type ProvidedForeground = {videoUrl: string; spans: Array<{start: number; end: number}>};

/**
 * The full-frame person layer for a provided cutout: one span over the whole output. An already-set foreground (e.g. the WP55 kinetic type host layer) always wins and is returned unchanged;
 * with no URL and no existing foreground the answer is undefined.
 */
export function providedForeground(existing: ProvidedForeground | undefined, url: string, outputDurationSec: number): ProvidedForeground | undefined {
  if (existing) return existing;
  if (!url || !(outputDurationSec > 0)) return undefined;
  return {videoUrl: url, spans: [{start: 0, end: outputDurationSec}]};
}
