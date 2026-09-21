/**
 * Pluggable subject mask for behind-subject overlays.
 *
 * The compositor asks providers in order and uses the first that returns a
 * usable mask. It must not depend on a specific extractor — chromakey, a
 * pre-made alpha video, or a future local segmentation module all implement
 * this interface.
 */

export type SpeakerCutoutRef = {
  available?: boolean;
  videoUrl?: string;
  speaker?: {x: number; y: number; w: number; h: number};
};

export type SubjectMask =
  | {kind: 'alpha_video'; videoUrl: string; providerId: string}
  | {kind: 'none'; providerId?: string};

export type SubjectMaskContext = {
  speakerCutout?: SpeakerCutoutRef;
  /** Optional pre-made matte / alpha video URL, independent of chromakey. */
  alphaVideoUrl?: string;
};

export interface SubjectMaskProvider {
  id: string;
  resolve(context: SubjectMaskContext): SubjectMask;
}

/** Pre-made matte or transparent video supplied on the blueprint. */
export const alphaVideoMaskProvider: SubjectMaskProvider = {
  id: 'alpha_video',
  resolve(context) {
    const url = context.alphaVideoUrl?.trim();
    if (!url) {
      return {kind: 'none', providerId: 'alpha_video'};
    }
    return {kind: 'alpha_video', videoUrl: url, providerId: 'alpha_video'};
  },
};

/** Existing ffmpeg chromakey WebM (speakerCutout.videoUrl). */
export const chromakeyMaskProvider: SubjectMaskProvider = {
  id: 'chromakey',
  resolve(context) {
    const url = context.speakerCutout?.videoUrl?.trim();
    if (!url) {
      return {kind: 'none', providerId: 'chromakey'};
    }
    return {kind: 'alpha_video', videoUrl: url, providerId: 'chromakey'};
  },
};

/**
 * Slot for an on-device / local segmentation module. Until one is registered
 * it always returns none. Add a provider that writes an alpha video and
 * returns `{kind:'alpha_video', videoUrl}` from here.
 */
export const localSegmentationMaskProvider: SubjectMaskProvider = {
  id: 'local_segmentation',
  resolve() {
    return {kind: 'none', providerId: 'local_segmentation'};
  },
};

const DEFAULT_PROVIDERS: SubjectMaskProvider[] = [
  alphaVideoMaskProvider,
  chromakeyMaskProvider,
  localSegmentationMaskProvider,
];

export function resolveSubjectMask(
  context: SubjectMaskContext,
  providers: SubjectMaskProvider[] = DEFAULT_PROVIDERS,
): SubjectMask {
  for (const provider of providers) {
    const mask = provider.resolve(context);
    if (mask.kind !== 'none') {
      return mask;
    }
  }
  return {kind: 'none'};
}

export function maskIsAvailable(mask: SubjectMask): boolean {
  return mask.kind === 'alpha_video' && Boolean(mask.videoUrl);
}

/** True only when chromakey actually produced a usable matte. */
export function keyedCutoutIsUsable(cutout?: SpeakerCutoutRef): boolean {
  return Boolean(cutout?.available && cutout.videoUrl?.trim());
}

export type OccupancyBox = {x: number; y: number; w: number; h: number};

export const DEFAULT_SPEAKER_BOX: OccupancyBox = {x: 0.16, y: 0.12, w: 0.68, h: 0.8};

/**
 * Soft person matte from occupancy. Used when chromakey is unavailable so the
 * overlay sits BEHIND the speaker instead of tinting their face.
 */
export function occupancySpeakerMaskStyle(
  speaker?: OccupancyBox | null,
): {
  WebkitMaskImage: string;
  maskImage: string;
} {
  const raw = speaker ?? DEFAULT_SPEAKER_BOX;
  const box = {
    x: raw.w > 0.84 ? Math.max(0.12, raw.x + (raw.w - 0.72) / 2) : raw.x,
    y: raw.y,
    w: Math.min(0.76, Math.max(0.42, raw.w)),
    h: Math.min(0.86, Math.max(0.52, raw.h)),
  };
  const cx = ((box.x + box.w / 2) * 100).toFixed(1);
  const cy = ((box.y + box.h * 0.34) * 100).toFixed(1);
  const rx = Math.min(80, Math.max(40, box.w * 112)).toFixed(0);
  const ry = Math.min(94, Math.max(52, box.h * 104)).toFixed(0);
  const gradient = `radial-gradient(ellipse ${rx}% ${ry}% at ${cx}% ${cy}%, #000 54%, transparent 80%)`;
  return {WebkitMaskImage: gradient, maskImage: gradient};
}
