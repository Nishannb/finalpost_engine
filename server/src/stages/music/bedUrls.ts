import type {AudioDesign} from '../../types/blueprint.ts';

/** Every bed URL a render fetches. Lambda has no access to this machine's disk, so each must be a public HTTPS URL. */
const BED_URL_FIELDS = ['musicUrl', 'musicFullUrl', 'musicLoopUrl', 'musicCarvedUrl'] as const;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/i;

export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !PRIVATE_HOST.test(url.hostname) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** The bed URL fields that Lambda could not fetch (local path, file:, http:, dry-run:, private host). Empty means all good. */
export function nonPublicBedUrls(audio: Pick<AudioDesign, (typeof BED_URL_FIELDS)[number]> | undefined): Array<{field: string; value: string}> {
  if (!audio) return [];
  const bad: Array<{field: string; value: string}> = [];
  for (const field of BED_URL_FIELDS) {
    const value = audio[field];
    if (typeof value === 'string' && value !== '' && !isPublicHttpsUrl(value)) bad.push({field, value});
  }
  return bad;
}
