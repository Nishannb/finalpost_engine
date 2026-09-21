/**
 * Keep in sync with server/src/lib/insetReveal.ts getInsetState /
 * captionLayoutForInset. Remotion cannot import the server package.
 */

export type InsetRevealVariant = 'simple' | 'motion_graphic';
export type InsetBackgroundType = 'solid' | 'gradient' | 'loop' | 'template';
export type InsetEasing =
  | 'linear'
  | 'easeInOutCubic'
  | 'easeOutCubic'
  | 'easeInCubic'
  | 'easeOutQuad'
  | 'spring';
export type InsetGraphicTemplateId = 'stat_callout' | 'keyword_title';
export type InsetPhase = 'before' | 'in' | 'hold' | 'out' | 'after';

export type InsetBackground = {
  type: InsetBackgroundType;
  value: string;
};

export type InsetGraphic = {
  templateId: InsetGraphicTemplateId;
  text?: string;
  data?: Record<string, string | number>;
  enterOffset: number;
  exitOffset: number;
};

export type InsetRevealParams = {
  insetScale: number;
  topMargin: number;
  cornerRadius: number;
  shadow: boolean;
  transitionIn: {duration: number};
  transitionOut: {duration: number};
  easing: InsetEasing;
  background: InsetBackground;
  captions: {enabled: boolean; position: 'below_video'; maxLines: number};
  variant: InsetRevealVariant;
  graphic?: InsetGraphic;
};

export type InsetState = {
  scale: number;
  y: number;
  cornerRadius: number;
  shadowOpacity: number;
  bgOpacity: number;
  progress: number;
  phase: InsetPhase;
};

export type CaptionLayoutState = {
  progress: number;
  dockMode: 'default' | 'below_video';
  position: 'bottom' | 'lower_third' | 'center' | 'top';
  bottomFrac: number;
  frameTopFrac: number;
  frameHeightFrac: number;
  maxLines: number;
};

export const DEFAULT_INSET_REVEAL_PARAMS: InsetRevealParams = {
  insetScale: 0.68,
  topMargin: 0.06,
  cornerRadius: 32,
  shadow: true,
  transitionIn: {duration: 0.9},
  transitionOut: {duration: 0.9},
  easing: 'easeInOutCubic',
  background: {type: 'solid', value: '#111827'},
  captions: {enabled: true, position: 'below_video', maxLines: 3},
  variant: 'simple',
};

function clamp01(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function clampInsetRevealParams(params: InsetRevealParams): InsetRevealParams {
  const easing: InsetEasing = (
    [
      'linear',
      'easeInOutCubic',
      'easeOutCubic',
      'easeInCubic',
      'easeOutQuad',
      'spring',
    ] as const
  ).includes(params.easing)
    ? params.easing
    : 'easeInOutCubic';
  const variant: InsetRevealVariant =
    params.variant === 'motion_graphic' ? 'motion_graphic' : 'simple';
  return {
    insetScale: clampRange(params.insetScale, 0.55, 0.85, 0.68),
    topMargin: clampRange(params.topMargin, 0.03, 0.12, 0.06),
    cornerRadius: clampRange(params.cornerRadius, 12, 56, 32),
    shadow: Boolean(params.shadow),
    transitionIn: {duration: clampRange(params.transitionIn.duration, 0.55, 1.2, 0.9)},
    transitionOut: {duration: clampRange(params.transitionOut.duration, 0.55, 1.2, 0.9)},
    easing,
    background: {
      type: ['solid', 'gradient', 'loop', 'template'].includes(params.background.type)
        ? params.background.type
        : 'solid',
      value: params.background.value || '#111827',
    },
    captions: {
      enabled: params.captions?.enabled !== false,
      position: 'below_video',
      maxLines: Math.round(clampRange(params.captions?.maxLines ?? 3, 1, 4, 3)),
    },
    variant,
    graphic:
      variant === 'motion_graphic'
        ? {
            templateId:
              params.graphic?.templateId === 'stat_callout' ? 'stat_callout' : 'keyword_title',
            text: String(params.graphic?.text ?? '').trim(),
            data: params.graphic?.data,
            enterOffset: clampRange(params.graphic?.enterOffset ?? -0.12, -0.35, 0.35, -0.12),
            exitOffset: clampRange(params.graphic?.exitOffset ?? 0.12, -0.35, 0.35, 0.12),
          }
        : undefined,
  };
}

export function getInsetState(
  localTime: number,
  clipDuration: number,
  params: InsetRevealParams = DEFAULT_INSET_REVEAL_PARAMS,
): InsetState {
  const clamped = clampInsetRevealParams(params);
  const hold = Math.max(
    clamped.transitionIn.duration + clamped.transitionOut.duration,
    Number.isFinite(clipDuration) ? clipDuration : 0,
  );
  const t = Number.isFinite(localTime) ? localTime : 0;
  if (t <= 0) {
    return fullFrameState('before');
  }
  if (t >= hold) {
    return fullFrameState('after');
  }

  const inDur = Math.min(clamped.transitionIn.duration, hold);
  const outDur = Math.min(clamped.transitionOut.duration, Math.max(0, hold - inDur));
  const holdEnd = hold - outDur;

  let progress = 0;
  let phase: InsetPhase = 'hold';
  if (t < inDur) {
    phase = 'in';
    progress = applyInsetEasing(t / Math.max(0.001, inDur), clamped.easing, 'in');
  } else if (outDur > 0 && t > holdEnd) {
    phase = 'out';
    progress = applyInsetEasing(
      (hold - t) / Math.max(0.001, outDur),
      clamped.easing,
      'out',
    );
  } else {
    progress = 1;
  }

  return {
    scale: 1 + (clamped.insetScale - 1) * progress,
    y: clamped.topMargin * progress,
    cornerRadius: clamped.cornerRadius * progress,
    shadowOpacity: clamped.shadow ? progress : 0,
    bgOpacity: progress,
    progress,
    phase,
  };
}

function fullFrameState(phase: InsetPhase): InsetState {
  return {
    scale: 1,
    y: 0,
    cornerRadius: 0,
    shadowOpacity: 0,
    bgOpacity: 0,
    progress: 0,
    phase,
  };
}

export function applyInsetEasing(
  t: number,
  easing: InsetEasing,
  direction: 'in' | 'out' = 'in',
): number {
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
  if (easing === 'easeOutCubic') {
    return 1 - (1 - x) ** 3;
  }
  if (easing === 'spring') {
    if (direction === 'out') {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    }
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function videoBottomFrac(params: InsetRevealParams): number {
  const clamped = clampInsetRevealParams(params);
  return Math.min(0.92, clamped.topMargin + clamped.insetScale);
}

export function captionLayoutForInset(
  progress: number,
  base: {position?: CaptionLayoutState['position']; bottomFrac?: number},
  params: InsetRevealParams = DEFAULT_INSET_REVEAL_PARAMS,
): CaptionLayoutState {
  const p = clamp01(progress);
  const clamped = clampInsetRevealParams(params);
  const insetTop = videoBottomFrac(clamped);
  const basePosition = base.position ?? 'bottom';
  const baseBottom = clampRange(base.bottomFrac ?? 0.14, 0.06, 0.34, 0.14);
  if (p <= 0.04) {
    return {
      progress: 0,
      dockMode: 'default',
      position: basePosition,
      bottomFrac: baseBottom,
      frameTopFrac: 0,
      frameHeightFrac: 1,
      maxLines: clamped.captions.maxLines,
    };
  }
  return {
    progress: p,
    dockMode: p > 0.18 ? 'below_video' : 'default',
    position: p > 0.35 ? 'bottom' : basePosition,
    bottomFrac: baseBottom + (0.08 - baseBottom) * p,
    frameTopFrac: insetTop * p,
    frameHeightFrac: 1 - insetTop * p,
    maxLines: clamped.captions.maxLines,
  };
}

export function graphicLocalProgress(
  localTime: number,
  clipDuration: number,
  params: InsetRevealParams,
): number {
  const clamped = clampInsetRevealParams(params);
  const graphic = clamped.graphic;
  if (!graphic || clamped.variant !== 'motion_graphic') {
    return 0;
  }
  const enterAt = Math.max(0, clamped.transitionIn.duration + graphic.enterOffset);
  const exitAt = Math.max(
    enterAt + 0.4,
    clipDuration - clamped.transitionOut.duration + graphic.exitOffset,
  );
  const enterDur = 0.35;
  const exitDur = 0.3;
  if (localTime < enterAt) {
    return 0;
  }
  if (localTime < enterAt + enterDur) {
    return applyInsetEasing((localTime - enterAt) / enterDur, 'easeOutCubic', 'in');
  }
  if (localTime < exitAt) {
    return 1;
  }
  if (localTime < exitAt + exitDur) {
    return applyInsetEasing(1 - (localTime - exitAt) / exitDur, 'easeInCubic', 'out');
  }
  return 0;
}
