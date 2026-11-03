/**
 * WP29: ANTI-PATTERN GATE for flat-color stills. PURE: no I/O, no env, no logger.
 *
 * WP28 proved the asset loop but failed craft: solid green / blue / orange fixture "logos" were scheduled as full-frame `brollClips`, so the edit showed flat color as a world. The reference
 * (editref.md) never does that: every plate is real media. This module gives the planner three things:
 *   1. `analyzeRgbSamples`: decide from a tiny RGB sample grid (what ffmpeg gives us in the describe path) whether a still is solid / near-solid.
 *   2. `isSolidFixtureUrl`: a conservative URL / filename heuristic for fixtures and flat fills when no pixels are available.
 *   3. `fullFrameStillPolicy` + `stripFullFrameStillClips`: where a user still may go. Solid -> refused everywhere full-frame; a real still -> a media card (never a `brollClips` entry).
 */

/** Per-channel standard deviation (0-255) at or below which a still counts as a flat fill. A photo / logo on a background sits far above this. */
export const SOLID_MAX_STDDEV = 6;
/** Fraction of samples within `SOLID_BAND` of the mean color above which a still counts as near-solid (a tiny mark on a flat field). */
export const NEAR_SOLID_DOMINANT_FRACTION = 0.97;
const SOLID_BAND = 12;

export type SolidVerdict = {solid: boolean; maxStd: number; dominantFraction: number; reason: 'flat_fill' | 'near_solid' | 'varied' | 'no_samples'};

/** `rgb` is packed R,G,B bytes (format=rgb24), e.g. a 16x16 downscale of the still. */
export function analyzeRgbSamples(rgb: ArrayLike<number>): SolidVerdict {
  const count = Math.floor(rgb.length / 3);
  if (count < 4) return {solid: false, maxStd: 0, dominantFraction: 0, reason: 'no_samples'};
  const mean = [0, 0, 0];
  for (let i = 0; i < count; i += 1) for (let c = 0; c < 3; c += 1) mean[c]! += rgb[i * 3 + c]!;
  for (let c = 0; c < 3; c += 1) mean[c]! /= count;
  const variance = [0, 0, 0];
  let near = 0;
  for (let i = 0; i < count; i += 1) {
    let within = true;
    for (let c = 0; c < 3; c += 1) {
      const delta = rgb[i * 3 + c]! - mean[c]!;
      variance[c]! += delta * delta;
      if (Math.abs(delta) > SOLID_BAND) within = false;
    }
    if (within) near += 1;
  }
  const maxStd = Math.max(...variance.map(v => Math.sqrt(v / count)));
  const dominantFraction = near / count;
  if (maxStd <= SOLID_MAX_STDDEV) return {solid: true, maxStd, dominantFraction, reason: 'flat_fill'};
  if (dominantFraction >= NEAR_SOLID_DOMINANT_FRACTION) return {solid: true, maxStd, dominantFraction, reason: 'near_solid'};
  return {solid: false, maxStd, dominantFraction, reason: 'varied'};
}

/** The WP28 fixture bucket path plus explicit "flat / solid / placeholder" filenames. Conservative: real uploads are named by the creator's device or `labeled-<ts>-<n>` outside a fixture folder. */
const SOLID_URL_PATTERNS: readonly RegExp[] = [
  /(^|[/_.-])(solid|flat[-_]?fill|swatch|placeholder|color[-_]?block|colou?r[-_]?fill)([/_.-]|$)/i,
  /\/wp\d+[a-z]?\/labeled-\d+-\d+\.(png|jpe?g|webp)(\?|#|$)/i,
  /(^|[/_.-])fixture[-_]?(logo|still|asset)/i,
];

export function isSolidFixtureUrl(url: string): boolean {
  return SOLID_URL_PATTERNS.some(pattern => pattern.test(url));
}

export type StillLike = {url: string; kind?: string; mediaKind?: 'image' | 'video'; solidLike?: boolean};

const isStillAsset = (asset: StillLike): boolean => (asset.mediaKind ? asset.mediaKind === 'image' : asset.kind === 'photo' || asset.kind === 'document' || (!asset.kind && !/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(asset.url)));

/** True when the asset is a still that is (or looks) solid / near-solid. Pixel evidence (`solidLike`) wins over the URL heuristic when it says "varied". */
export function isSolidStill(asset: StillLike): boolean {
  if (!isStillAsset(asset)) return false;
  if (asset.solidLike === true) return true;
  if (asset.solidLike === false) return false;
  return isSolidFixtureUrl(asset.url);
}

export type FullFrameStillPolicy =
  /** not a still (a video clip): the existing cutaway path stands */
  | 'clip_ok'
  /** a real still: placed as a framed media card overlay, never as a `brollClips` entry */
  | 'media_card'
  /** a solid / near-solid still: refused as a full-frame world (warning `solid_still_refused`) */
  | 'refuse_solid';

export function fullFrameStillPolicy(asset: StillLike): FullFrameStillPolicy {
  if (!isStillAsset(asset)) return 'clip_ok';
  return isSolidStill(asset) ? 'refuse_solid' : 'media_card';
}

export const SOLID_STILL_REFUSED = 'solid_still_refused';

/**
 * Backstop on the final clip list: a `brollClips` entry must be a VIDEO. A still URL (png / jpg / webp / gif) that reached the clip list is dropped, solid or not: stills belong to ImageRun / media cards.
 * Returns the survivors plus a warning per dropped clip kind.
 */
export function stripFullFrameStillClips<T extends {assetUrl: string; start: number; end: number; provider?: string}>(clips: readonly T[], solidUrls: ReadonlySet<string> = new Set()): {clips: T[]; dropped: Array<{assetUrl: string; reason: 'solid_still' | 'still_clip'}>} {
  const dropped: Array<{assetUrl: string; reason: 'solid_still' | 'still_clip'}> = [];
  const kept = clips.filter(clip => {
    const isUser = clip.provider === 'user';
    const isStillUrl = /\.(png|jpe?g|webp|bmp|avif)(\?|#|$)/i.test(clip.assetUrl);
    if (isUser && (solidUrls.has(clip.assetUrl) || (isStillUrl && isSolidFixtureUrl(clip.assetUrl)))) {
      dropped.push({assetUrl: clip.assetUrl, reason: 'solid_still'});
      return false;
    }
    if (isUser && isStillUrl) {
      dropped.push({assetUrl: clip.assetUrl, reason: 'still_clip'});
      return false;
    }
    return true;
  });
  return {clips: kept, dropped};
}

export const solidStillWarnings = (dropped: ReadonlyArray<{reason: 'solid_still' | 'still_clip'}>): string[] => {
  const solid = dropped.filter(item => item.reason === 'solid_still').length;
  const still = dropped.length - solid;
  return [...(solid > 0 ? [`${SOLID_STILL_REFUSED}:clip:${solid}`] : []), ...(still > 0 ? [`still_clip_refused:${still}`] : [])];
};
