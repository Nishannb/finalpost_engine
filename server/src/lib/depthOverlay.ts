/**
 * Behind-subject overlay (depth_overlay): params, deterministic motion, and
 * Director guardrails. The renderer owns compositing; this module is the
 * shared contract for clamp/validate/animate.
 */

export const DEPTH_OVERLAY_TYPE = 'depth_overlay' as const;

export const DEPTH_OVERLAY_DIRECTIONS = ['up', 'down'] as const;
export type DepthOverlayDirection = (typeof DEPTH_OVERLAY_DIRECTIONS)[number];

export const DEPTH_OVERLAY_FITS = ['fit', 'fill'] as const;
export type DepthOverlayFit = (typeof DEPTH_OVERLAY_FITS)[number];

export const DEPTH_OVERLAY_EASINGS = [
  'linear',
  'easeOutCubic',
  'easeInOutCubic',
  'easeOutQuad',
  'easeInCubic',
] as const;
export type DepthOverlayEasing = (typeof DEPTH_OVERLAY_EASINGS)[number];

export const DEPTH_OVERLAY_BLEND_MODES = ['normal'] as const;
export type DepthOverlayBlendMode = (typeof DEPTH_OVERLAY_BLEND_MODES)[number];

export const DEPTH_OVERLAY_MIN_DURATION_SEC = 1.5;
export const DEPTH_OVERLAY_MAX_DURATION_SEC = 6;
export const DEPTH_OVERLAY_MIN_GAP_SEC = 4;
export const DEPTH_OVERLAY_MAX_SHARE = 0.35;
export const DEPTH_OVERLAY_MIN_ASSET_EDGE = 400;

export type DepthOverlayRegion = {
  /** Normalized top of the overlay band (0 = top of frame). */
  y: number;
  /** Normalized height of the overlay band. */
  height: number;
  fit: DepthOverlayFit;
};

export type DepthOverlayEdgeMask = {
  /** Bottom-edge fade as a fraction of overlay height (0.15–0.25). */
  feather: number;
  rounded: boolean;
};

export type DepthOverlayAnimation = {
  direction: DepthOverlayDirection;
  duration: number;
  easing: DepthOverlayEasing;
  exit: boolean;
};

export type DepthOverlayParams = {
  region: DepthOverlayRegion;
  opacity: number;
  edgeMask: DepthOverlayEdgeMask;
  blendMode: DepthOverlayBlendMode;
  animation: DepthOverlayAnimation;
};

export type DepthOverlayDecision = {
  style: typeof DEPTH_OVERLAY_TYPE;
  assetId: string;
  start: number;
  end: number;
  direction: DepthOverlayDirection;
  opacity?: number;
  duration?: number;
  reason: string;
};

export type DepthOverlayClip = {
  type: typeof DEPTH_OVERLAY_TYPE;
  assetId: string;
  assetUrl: string;
  mediaKind: 'video' | 'image';
  start: number;
  end: number;
  params: DepthOverlayParams;
  reason?: string;
  keyword?: string;
  provider?: 'pexels' | 'pixabay' | 'generated' | 'user';
  width?: number;
  height?: number;
  durationSec?: number;
};

export type OverlayTransform = {
  /** TranslateY in overlay-heights. 0 = parked; -1 = fully above; +1 = fully below. */
  y: number;
  opacity: number;
};

export const DEFAULT_DEPTH_OVERLAY_PARAMS: DepthOverlayParams = {
  region: {y: 0, height: 0.58, fit: 'fill'},
  opacity: 1,
  edgeMask: {feather: 0.22, rounded: false},
  blendMode: 'normal',
  animation: {
    direction: 'down',
    duration: 0.75,
    easing: 'easeInOutCubic',
    exit: false,
  },
};

export type DepthOverlayViolation = {
  code: string;
  elementId?: string;
  reason: string;
};

type TimeRange = {start: number; end: number};

export function clamp01(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function defaultDepthOverlayParams(
  partial?: Partial<DepthOverlayParams> & {
    direction?: DepthOverlayDirection;
    opacity?: number;
    duration?: number;
    exit?: boolean;
    fit?: DepthOverlayFit;
    easing?: DepthOverlayEasing;
    feather?: number;
    rounded?: boolean;
  },
): DepthOverlayParams {
  const base = DEFAULT_DEPTH_OVERLAY_PARAMS;
  const region = partial?.region ?? base.region;
  const edge = partial?.edgeMask ?? base.edgeMask;
  const animation = partial?.animation ?? base.animation;
  return clampDepthOverlayParams({
    region: {
      y: region.y ?? base.region.y,
      height: region.height ?? base.region.height,
      fit: partial?.fit ?? region.fit ?? base.region.fit,
    },
    opacity: 1,
    edgeMask: {
      feather: partial?.feather ?? edge.feather,
      rounded: partial?.rounded ?? edge.rounded,
    },
    blendMode: 'normal',
    animation: {
      direction: partial?.direction ?? animation.direction,
      duration: partial?.duration ?? animation.duration,
      easing: partial?.easing ?? animation.easing,
      exit: partial?.exit ?? true,
    },
  });
}

export function clampDepthOverlayParams(params: DepthOverlayParams): DepthOverlayParams {
  const fit: DepthOverlayFit = params.region.fit === 'fit' ? 'fit' : 'fill';
  const direction: DepthOverlayDirection =
    params.animation.direction === 'up' ? 'up' : 'down';
  const easing = (DEPTH_OVERLAY_EASINGS as readonly string[]).includes(
    params.animation.easing,
  )
    ? params.animation.easing
    : 'easeOutCubic';
  const height = clampRange(params.region.height, 0.45, 0.7, 0.58);
  const y = clampRange(params.region.y, 0, Math.max(0, 1 - height), 0);
  return {
    region: {y, height, fit},
    opacity: clampRange(params.opacity, 0.88, 1, 1),
    edgeMask: {
      feather: clampRange(params.edgeMask.feather, 0.15, 0.25, 0.2),
      rounded: Boolean(params.edgeMask.rounded),
    },
    blendMode: 'normal',
    animation: {
      direction,
      duration: clampRange(params.animation.duration, 0.5, 1.15, 0.75),
      easing,
      exit: Boolean(params.animation.exit),
    },
  };
}

/**
 * Pure function of local time. Seeking and export share this path.
 * `localTime` is `currentTime - clip.startTime`.
 */
export function getOverlayTransform(
  localTime: number,
  clipDuration: number,
  params: DepthOverlayParams = DEFAULT_DEPTH_OVERLAY_PARAMS,
): OverlayTransform {
  const clamped = clampDepthOverlayParams(params);
  const hold = Math.max(clamped.animation.duration, clipDuration);
  const t = Number.isFinite(localTime) ? localTime : 0;
  if (t <= 0) {
    return startState(clamped);
  }
  if (t >= hold) {
    return clamped.animation.exit ? startState(clamped) : parkedState(clamped);
  }

  const enterDur = Math.min(clamped.animation.duration, hold);
  const exitDur = clamped.animation.exit
    ? Math.min(clamped.animation.duration, Math.max(0, hold - enterDur))
    : 0;
  const travel = clamped.animation.direction === 'down' ? -1 : 1;

  if (t < enterDur) {
    const p = applyEasing(t / Math.max(0.001, enterDur), clamped.animation.easing);
    return {
      y: travel * (1 - p),
      opacity: clamped.opacity * p,
    };
  }
  if (exitDur > 0 && t > hold - exitDur) {
    const p = applyEasing(
      (hold - t) / Math.max(0.001, exitDur),
      clamped.animation.easing,
    );
    return {
      y: travel * (1 - p),
      opacity: clamped.opacity * p,
    };
  }
  return parkedState(clamped);
}

function startState(params: DepthOverlayParams): OverlayTransform {
  return {
    y: params.animation.direction === 'down' ? -1 : 1,
    opacity: 0,
  };
}

function parkedState(params: DepthOverlayParams): OverlayTransform {
  return {y: 0, opacity: params.opacity};
}

export function applyEasing(t: number, easing: DepthOverlayEasing): number {
  const x = clamp01(t);
  if (easing === 'linear') {
    return x;
  }
  if (easing === 'easeOutQuad') {
    return 1 - (1 - x) * (1 - x);
  }
  if (easing === 'easeInCubic') {
    return x * x * x;
  }
  if (easing === 'easeInOutCubic') {
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
  return 1 - (1 - x) ** 3;
}

export function rangesOverlap(a: TimeRange, b: TimeRange, gap = 0): boolean {
  return a.start < b.end + gap && b.start < a.end + gap;
}

export function speakerFramingAllowsDepthOverlay(speaker?: {
  x: number;
  y: number;
  w: number;
  h: number;
} | null): boolean {
  if (!speaker) {
    return true;
  }
  const centerX = speaker.x + speaker.w / 2;
  const tooTight = speaker.w > 0.88 || speaker.y < 0.02;
  const tooSmall = speaker.w < 0.22 || speaker.h < 0.28;
  const offCenter = centerX < 0.22 || centerX > 0.78;
  return !tooTight && !tooSmall && !offCenter;
}

export function speakerVisibleRanges(
  slices: Array<{
    atSec: number;
    occupancy: {speaker: {x: number; y: number; w: number; h: number}; source?: string};
  }>,
  durationSec = 9999,
): TimeRange[] {
  if (slices.length === 0) {
    return [{start: 0, end: durationSec}];
  }
  const flags = slices.map(slice => ({
    at: slice.atSec,
    ok:
      slice.occupancy.source === 'fallback' ||
      speakerFramingAllowsDepthOverlay(slice.occupancy.speaker),
  }));
  const ranges: TimeRange[] = [];
  let current: TimeRange | null = null;
  for (let i = 0; i < flags.length; i += 1) {
    const item = flags[i]!;
    const isLast = i === flags.length - 1;
    const nextAt = isLast
      ? Math.max(item.at + 0.5, durationSec)
      : (flags[i + 1]?.at ?? durationSec);
    if (item.ok) {
      if (!current) {
        current = {start: item.at, end: nextAt};
      } else {
        current.end = nextAt;
      }
    } else if (current) {
      ranges.push(current);
      current = null;
    }
  }
  if (current) {
    ranges.push(current);
  }
  return ranges;
}

export function rangeCoveredBy(target: TimeRange, allowed: TimeRange[]): boolean {
  if (allowed.length === 0) {
    return true;
  }
  const mid = (target.start + target.end) / 2;
  return allowed.some(range => mid >= range.start && mid <= range.end);
}

export type DepthOverlayValidateInput = {
  clips: Array<{
    id?: string;
    start: number;
    end: number;
    direction: DepthOverlayDirection;
    reason?: string;
    assetId?: string;
    width?: number;
    height?: number;
    params?: DepthOverlayParams;
  }>;
  outputDurationSec: number;
  maskAvailable: boolean;
  brollRanges?: TimeRange[];
  speakerVisible?: TimeRange[];
  minAssetEdge?: number;
};

export type DepthOverlayValidateResult = {
  clips: Array<{
    id?: string;
    start: number;
    end: number;
    direction: DepthOverlayDirection;
    reason?: string;
    assetId?: string;
    width?: number;
    height?: number;
    params: DepthOverlayParams;
  }>;
  violations: DepthOverlayViolation[];
  coercions: string[];
  drops: string[];
};

/**
 * Hard guardrails for Director output. Invalid clips are dropped (no effect),
 * never merged into B-roll. Params are clamped rather than rejected.
 */
export function validateDepthOverlays(
  input: DepthOverlayValidateInput,
): DepthOverlayValidateResult {
  const violations: DepthOverlayViolation[] = [];
  const coercions: string[] = [];
  const drops: string[] = [];
  const kept: DepthOverlayValidateResult['clips'] = [];
  const durationSec = Math.max(0.1, input.outputDurationSec);
  const minEdge = input.minAssetEdge ?? DEPTH_OVERLAY_MIN_ASSET_EDGE;
  const broll = input.brollRanges ?? [];
  const visible = input.speakerVisible ?? [];

  if (!input.maskAvailable && input.clips.length > 0) {
    for (const clip of input.clips) {
      violations.push({
        code: 'depth_overlay_no_mask',
        elementId: clip.id,
        reason: 'Subject mask is not available; depth_overlay was dropped.',
      });
      drops.push(`drop:${clip.id ?? clip.assetId ?? 'depth_overlay'}:no_mask`);
    }
    return {clips: [], violations, coercions, drops};
  }

  const ordered = [...input.clips].sort((a, b) => a.start - b.start);
  for (const clip of ordered) {
    const id = clip.id ?? clip.assetId ?? 'depth_overlay';
    let start = Number(clip.start);
    let end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      violations.push({
        code: 'depth_overlay_invalid_window',
        elementId: id,
        reason: `Invalid window ${clip.start}–${clip.end}`,
      });
      drops.push(`drop:${id}:invalid_window`);
      continue;
    }
    start = Math.max(0, start);
    end = Math.min(durationSec, end);
    let hold = end - start;
    if (hold < DEPTH_OVERLAY_MIN_DURATION_SEC) {
      violations.push({
        code: 'depth_overlay_too_short',
        elementId: id,
        reason: `Hold ${hold.toFixed(2)}s is under ${DEPTH_OVERLAY_MIN_DURATION_SEC}s`,
      });
      drops.push(`drop:${id}:too_short`);
      continue;
    }
    if (hold > DEPTH_OVERLAY_MAX_DURATION_SEC) {
      end = start + DEPTH_OVERLAY_MAX_DURATION_SEC;
      hold = DEPTH_OVERLAY_MAX_DURATION_SEC;
      coercions.push(`clamp_duration:${id}`);
    }

    const candidate = {start, end};
    if (broll.some(range => rangesOverlap(candidate, range))) {
      violations.push({
        code: 'depth_overlay_broll_overlap',
        elementId: id,
        reason: 'Overlaps a B-roll / cutaway / split / cutout window',
      });
      drops.push(`drop:${id}:broll_overlap`);
      continue;
    }
    if (kept.some(other => rangesOverlap(candidate, other))) {
      violations.push({
        code: 'depth_overlay_overlap',
        elementId: id,
        reason: 'Overlaps another depth_overlay clip',
      });
      drops.push(`drop:${id}:overlap`);
      continue;
    }
    const previous = kept.at(-1);
    if (
      previous &&
      candidate.start < previous.end + DEPTH_OVERLAY_MIN_GAP_SEC
    ) {
      violations.push({
        code: 'depth_overlay_min_gap',
        elementId: id,
        reason: `Needs ${DEPTH_OVERLAY_MIN_GAP_SEC}s gap from the previous overlay`,
      });
      drops.push(`drop:${id}:min_gap`);
      continue;
    }

    const used = kept.reduce((sum, item) => sum + (item.end - item.start), 0);
    if ((used + hold) / durationSec > DEPTH_OVERLAY_MAX_SHARE + 1e-6) {
      violations.push({
        code: 'depth_overlay_share_cap',
        elementId: id,
        reason: `Would exceed ${Math.round(DEPTH_OVERLAY_MAX_SHARE * 100)}% of runtime`,
      });
      drops.push(`drop:${id}:share_cap`);
      continue;
    }

    if (!rangeCoveredBy(candidate, visible) && visible.length > 0) {
      coercions.push(`speaker_visible_unverified:${id}`);
    }

    const width = Number(clip.width ?? 0);
    const height = Number(clip.height ?? 0);
    if ((width > 0 && width < minEdge) || (height > 0 && height < minEdge)) {
      violations.push({
        code: 'depth_overlay_low_res',
        elementId: id,
        reason: `Asset ${Math.round(width)}×${Math.round(height)} is below ${minEdge}px`,
      });
      drops.push(`drop:${id}:low_res`);
      continue;
    }

    let direction: DepthOverlayDirection =
      clip.direction === 'up' ? 'up' : 'down';
    if (previous && previous.direction === direction) {
      const reason = (clip.reason ?? '').toLowerCase();
      const keep =
        reason.includes('direction') ||
        reason.includes('same way') ||
        reason.includes('match previous');
      if (!keep) {
        direction = direction === 'up' ? 'down' : 'up';
        coercions.push(`alternate_direction:${id}`);
      }
    }

    kept.push({
      ...clip,
      start,
      end,
      direction,
        params: clampDepthOverlayParams(
        defaultDepthOverlayParams({
          ...clip.params,
          direction,
          opacity: clip.params?.opacity,
          duration: clip.params?.animation?.duration,
        }),
      ),
    });
  }

  return {clips: kept, violations, coercions, drops};
}

export function overlayLayerMode(maskAvailable: boolean): 'behind' | 'refused' {
  return maskAvailable ? 'behind' : 'refused';
}
