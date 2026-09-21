/**
 * Keep in sync with server/src/lib/depthOverlay.ts getOverlayTransform.
 * Remotion cannot import the server package, so the renderer copies the
 * deterministic motion helper.
 */

export type DepthOverlayDirection = 'up' | 'down';
export type DepthOverlayFit = 'fit' | 'fill';
export type DepthOverlayEasing =
  | 'linear'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutQuad'
  | 'easeInCubic';

export type DepthOverlayParams = {
  region: {y: number; height: number; fit: DepthOverlayFit};
  opacity: number;
  edgeMask: {feather: number; rounded: boolean};
  blendMode: 'normal';
  animation: {
    direction: DepthOverlayDirection;
    duration: number;
    easing: DepthOverlayEasing;
    exit: boolean;
  };
};

export type OverlayTransform = {y: number; opacity: number};

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

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampDepthOverlayParams(params: DepthOverlayParams): DepthOverlayParams {
  const height = clampRange(params.region.height, 0.45, 0.7, 0.58);
  return {
    region: {
      y: clampRange(params.region.y, 0, Math.max(0, 1 - height), 0),
      height,
      fit: params.region.fit === 'fit' ? 'fit' : 'fill',
    },
    opacity: clampRange(params.opacity, 0.88, 1, 1),
    edgeMask: {
      feather: clampRange(params.edgeMask.feather, 0.15, 0.25, 0.2),
      rounded: Boolean(params.edgeMask.rounded),
    },
    blendMode: 'normal',
    animation: {
      direction: params.animation.direction === 'up' ? 'up' : 'down',
      duration: clampRange(params.animation.duration, 0.5, 1.15, 0.75),
      easing: params.animation.easing || 'easeOutCubic',
      exit: Boolean(params.animation.exit),
    },
  };
}

function applyEasing(t: number, easing: DepthOverlayEasing): number {
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

function startState(params: DepthOverlayParams): OverlayTransform {
  return {
    y: params.animation.direction === 'down' ? -1 : 1,
    opacity: 0,
  };
}

function parkedState(params: DepthOverlayParams): OverlayTransform {
  return {y: 0, opacity: params.opacity};
}

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
    return {y: travel * (1 - p), opacity: clamped.opacity * p};
  }
  if (exitDur > 0 && t > hold - exitDur) {
    const p = applyEasing(
      (hold - t) / Math.max(0.001, exitDur),
      clamped.animation.easing,
    );
    return {y: travel * (1 - p), opacity: clamped.opacity * p};
  }
  return parkedState(clamped);
}

export function overlayLayerMode(maskAvailable: boolean): 'behind' | 'refused' {
  return maskAvailable ? 'behind' : 'refused';
}
