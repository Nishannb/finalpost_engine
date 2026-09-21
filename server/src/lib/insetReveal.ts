/**
 * Inset Scale Reveal (inset_reveal): params, deterministic motion, caption
 * dock restore, and Director guardrails. Separate from B-roll and depth_overlay.
 *
 * The renderer owns compositing; this module is the shared contract for
 * clamp / validate / animate.
 */

export const INSET_REVEAL_TYPE = 'inset_reveal' as const;

export const INSET_REVEAL_VARIANTS = ['simple', 'motion_graphic'] as const;
export type InsetRevealVariant = (typeof INSET_REVEAL_VARIANTS)[number];

export const INSET_BACKGROUND_TYPES = ['solid', 'gradient', 'loop', 'template'] as const;
export type InsetBackgroundType = (typeof INSET_BACKGROUND_TYPES)[number];

export const INSET_EASINGS = [
  'linear',
  'easeInOutCubic',
  'easeOutCubic',
  'easeInCubic',
  'easeOutQuad',
  'spring',
] as const;
export type InsetEasing = (typeof INSET_EASINGS)[number];

export const INSET_GRAPHIC_TEMPLATES = [
  {
    id: 'stat_callout',
    description:
      'Large spoken statistic or number with a short label underneath. Requires text (the number/stat). Optional data.label.',
    requiredFields: ['text'],
  },
  {
    id: 'keyword_title',
    description:
      'Keyword / title card for a named idea, list item, or quotable phrase. Requires text.',
    requiredFields: ['text'],
  },
] as const;

export type InsetGraphicTemplateId = (typeof INSET_GRAPHIC_TEMPLATES)[number]['id'];

export const INSET_REVEAL_MIN_DURATION_SEC = 3.4;
export const INSET_REVEAL_MAX_DURATION_SEC = 8;
export const INSET_REVEAL_MIN_GAP_SEC = 6;
export const INSET_REVEAL_MAX_SHARE = 0.3;
export const INSET_REVEAL_PER_SECONDS = 20;
export const INSET_REVEAL_HOOK_GUARD_SEC = 3;
export const INSET_REVEAL_TAIL_GUARD_SEC = 2;
export const INSET_REVEAL_SNAP_MAX_SHIFT_SEC = 0.4;

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

export type InsetCaptionParams = {
  enabled: boolean;
  position: 'below_video';
  maxLines: number;
};

export type InsetRevealParams = {
  insetScale: number;
  /** Top margin as a fraction of frame height. */
  topMargin: number;
  /** Corner radius at 1080px-wide inset; scaled by frame width in the renderer. */
  cornerRadius: number;
  shadow: boolean;
  transitionIn: {duration: number};
  transitionOut: {duration: number};
  easing: InsetEasing;
  background: InsetBackground;
  captions: InsetCaptionParams;
  variant: InsetRevealVariant;
  graphic?: InsetGraphic;
};

export type InsetRevealDecision = {
  style: typeof INSET_REVEAL_TYPE;
  start: number;
  end: number;
  variant: InsetRevealVariant;
  background: InsetBackground;
  graphic?: {templateId: string; text?: string; data?: Record<string, string | number>};
  captions: boolean;
  reason: string;
};

export type InsetRevealClip = {
  type: typeof INSET_REVEAL_TYPE;
  start: number;
  end: number;
  params: InsetRevealParams;
  reason?: string;
};

export type InsetPhase = 'before' | 'in' | 'hold' | 'out' | 'after';

export type InsetState = {
  scale: number;
  /** TranslateY as a fraction of frame height. */
  y: number;
  /** Corner radius at the clip's design resolution (1080-wide); renderer scales it. */
  cornerRadius: number;
  shadowOpacity: number;
  bgOpacity: number;
  /** 0 = full frame, 1 = fully inset. */
  progress: number;
  phase: InsetPhase;
};

export type CaptionLayoutState = {
  /** 0 = original caption dock, 1 = fully in the below-video zone. */
  progress: number;
  dockMode: 'default' | 'below_video';
  position: 'bottom' | 'lower_third' | 'center' | 'top';
  bottomFrac: number;
  /** Top of the caption frame as a fraction of composition height. */
  frameTopFrac: number;
  /** Height of the caption frame as a fraction of composition height. */
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

const DEFAULT_GRAPHIC: InsetGraphic = {
  templateId: 'keyword_title',
  text: '',
  enterOffset: -0.12,
  exitOffset: 0.12,
};

export type InsetRevealViolation = {
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

export function isInsetGraphicTemplateId(value: string): value is InsetGraphicTemplateId {
  return INSET_GRAPHIC_TEMPLATES.some(item => item.id === value);
}

export function insetGraphicTemplatesForDirector(): string {
  return INSET_GRAPHIC_TEMPLATES.map(
    item => `- ${item.id}: ${item.description} Required: ${item.requiredFields.join(', ')}.`,
  ).join('\n');
}

export function defaultInsetRevealParams(
  partial?: Partial<InsetRevealParams> & {
    variant?: InsetRevealVariant;
    insetScale?: number;
    backgroundType?: InsetBackgroundType;
    backgroundValue?: string;
    graphicTemplateId?: string;
    graphicText?: string;
    enterOffset?: number;
    exitOffset?: number;
    captionsEnabled?: boolean;
    easing?: InsetEasing;
    shadow?: boolean;
    themeColor?: string;
  },
): InsetRevealParams {
  const base = DEFAULT_INSET_REVEAL_PARAMS;
  const theme = captionSafePlate(partial?.themeColor) || base.background.value;
  const variant: InsetRevealVariant =
    partial?.variant === 'motion_graphic' ? 'motion_graphic' : 'simple';
  const graphicId = String(
    partial?.graphic?.templateId ?? partial?.graphicTemplateId ?? '',
  );
  const graphic: InsetGraphic | undefined =
    variant === 'motion_graphic'
      ? {
          templateId: isInsetGraphicTemplateId(graphicId) ? graphicId : 'keyword_title',
          text: String(partial?.graphic?.text ?? partial?.graphicText ?? '').trim(),
          data: partial?.graphic?.data,
          enterOffset: partial?.graphic?.enterOffset ?? partial?.enterOffset ?? DEFAULT_GRAPHIC.enterOffset,
          exitOffset: partial?.graphic?.exitOffset ?? partial?.exitOffset ?? DEFAULT_GRAPHIC.exitOffset,
        }
      : undefined;
  return clampInsetRevealParams({
    insetScale: partial?.insetScale ?? base.insetScale,
    topMargin: partial?.topMargin ?? base.topMargin,
    cornerRadius: partial?.cornerRadius ?? base.cornerRadius,
    shadow: partial?.shadow ?? base.shadow,
    transitionIn: {
      duration: partial?.transitionIn?.duration ?? base.transitionIn.duration,
    },
    transitionOut: {
      duration: partial?.transitionOut?.duration ?? base.transitionOut.duration,
    },
    easing: partial?.easing ?? base.easing,
    background: {
      type: partial?.background?.type ?? partial?.backgroundType ?? base.background.type,
      value:
        partial?.background?.value ??
        partial?.backgroundValue ??
        theme,
    },
    captions: {
      enabled: partial?.captionsEnabled ?? partial?.captions?.enabled ?? true,
      position: 'below_video',
      maxLines: partial?.captions?.maxLines ?? base.captions.maxLines,
    },
    variant,
    graphic,
  });
}

export function clampInsetRevealParams(params: InsetRevealParams): InsetRevealParams {
  const easing = (INSET_EASINGS as readonly string[]).includes(params.easing)
    ? params.easing
    : 'easeInOutCubic';
  const bgType = (INSET_BACKGROUND_TYPES as readonly string[]).includes(params.background.type)
    ? params.background.type
    : 'solid';
  const variant: InsetRevealVariant =
    params.variant === 'motion_graphic' ? 'motion_graphic' : 'simple';
  const inDur = clampRange(params.transitionIn.duration, 0.55, 1.2, 0.9);
  const outDur = clampRange(params.transitionOut.duration, 0.55, 1.2, 0.9);
  const graphic = params.graphic
    ? {
        templateId: isInsetGraphicTemplateId(params.graphic.templateId)
          ? params.graphic.templateId
          : 'keyword_title',
        text: String(params.graphic.text ?? '').trim(),
        data: params.graphic.data,
        enterOffset: clampRange(params.graphic.enterOffset, -0.35, 0.35, -0.12),
        exitOffset: clampRange(params.graphic.exitOffset, -0.35, 0.35, 0.12),
      }
    : variant === 'motion_graphic'
      ? {...DEFAULT_GRAPHIC}
      : undefined;
  return {
    insetScale: clampRange(params.insetScale, 0.55, 0.85, 0.68),
    topMargin: clampRange(params.topMargin, 0.03, 0.12, 0.06),
    cornerRadius: clampRange(params.cornerRadius, 12, 56, 32),
    shadow: Boolean(params.shadow),
    transitionIn: {duration: inDur},
    transitionOut: {duration: outDur},
    easing,
    background: {
      type: bgType,
      value: sanitizeBackgroundValue(params.background.value, bgType),
    },
    captions: {
      enabled: params.captions?.enabled !== false,
      position: 'below_video',
      maxLines: Math.round(clampRange(params.captions?.maxLines ?? 3, 1, 4, 3)),
    },
    variant,
    graphic: variant === 'motion_graphic' ? graphic : undefined,
  };
}

/**
 * Pure function of local time. Seeking and export share this path.
 * `localTime` is `currentTime - clip.startTime`.
 */
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
    const raw = (hold - t) / Math.max(0.001, outDur);
    progress = applyInsetEasing(raw, clamped.easing, 'out');
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
      return easeOutBack(x);
    }
    return easeInOutCubic(x);
  }
  return easeInOutCubic(x);
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

export function rangesOverlap(a: TimeRange, b: TimeRange, gap = 0): boolean {
  return a.start < b.end + gap && b.start < a.end + gap;
}

export function maxInsetRevealCount(durationSec: number): number {
  return Math.max(1, Math.floor(Math.max(0.1, durationSec) / INSET_REVEAL_PER_SECONDS));
}

export function videoBottomFrac(params: InsetRevealParams): number {
  const clamped = clampInsetRevealParams(params);
  return Math.min(0.92, clamped.topMargin + clamped.insetScale);
}

/**
 * Caption dock as a function of inset progress. progress=0 restores the
 * previous position/style; progress=1 parks captions in the below-video zone.
 * Words keep playing — this only moves the dock.
 */
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

export function captionLayoutAtTime(
  timeSec: number,
  clips: Array<{start: number; end: number; params?: InsetRevealParams}>,
  base: {position?: CaptionLayoutState['position']; bottomFrac?: number},
): CaptionLayoutState {
  const clip = clips.find(item => timeSec >= item.start && timeSec < item.end);
  if (!clip) {
    return captionLayoutForInset(0, base);
  }
  const params = clampInsetRevealParams(clip.params ?? DEFAULT_INSET_REVEAL_PARAMS);
  const state = getInsetState(timeSec - clip.start, clip.end - clip.start, params);
  if (!params.captions.enabled) {
    return captionLayoutForInset(0, base, params);
  }
  return captionLayoutForInset(state.progress, base, params);
}

export function snapToTranscriptBoundaries(
  start: number,
  end: number,
  words: Array<{start: number; end: number}>,
  sentences?: Array<{start: number; end: number}>,
  maxShift = INSET_REVEAL_SNAP_MAX_SHIFT_SEC,
): {start: number; end: number; snapped: boolean} {
  const duration = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) {
    return {start, end, snapped: false};
  }
  const edges = (sentences && sentences.length > 0 ? sentences : words).filter(
    item => Number.isFinite(item.start) && Number.isFinite(item.end),
  );
  if (edges.length === 0) {
    return {start, end, snapped: false};
  }
  const snappedStart = nearestEdge(
    start,
    edges.map(item => item.start),
    maxShift,
  );
  const snappedEnd = nearestEdge(
    end,
    edges.map(item => item.end),
    maxShift,
  );
  let nextStart = snappedStart ?? start;
  let nextEnd = snappedEnd ?? end;
  if (nextEnd - nextStart < INSET_REVEAL_MIN_DURATION_SEC) {
    return {start, end, snapped: false};
  }
  if (nextEnd - nextStart > INSET_REVEAL_MAX_DURATION_SEC) {
    nextEnd = nextStart + INSET_REVEAL_MAX_DURATION_SEC;
  }
  return {
    start: nextStart,
    end: nextEnd,
    snapped: nextStart !== start || nextEnd !== end,
  };
}

function nearestEdge(target: number, edges: number[], maxShift: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const edge of edges) {
    const dist = Math.abs(edge - target);
    if (dist <= maxShift && dist < bestDist) {
      best = edge;
      bestDist = dist;
    }
  }
  return best;
}

function sanitizeHex(value?: string): string {
  const raw = String(value ?? '').trim();
  if (/^#([0-9a-f]{6})$/i.test(raw)) {
    return raw.toUpperCase();
  }
  return '';
}

function hexLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    return 0.5;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Captions dock onto this plate — never a washed-out / pastel fill. */
export function captionSafePlate(value?: string): string {
  const hex = sanitizeHex(value) || '#111827';
  return hexLuminance(hex) > 0.38 ? '#111827' : hex;
}

function sanitizeBackgroundValue(value: string, type: InsetBackgroundType): string {
  const raw = String(value ?? '').trim();
  if (type === 'solid') {
    return captionSafePlate(raw);
  }
  if (type === 'gradient') {
    const parts = raw
      .split(/[,|]/)
      .map(part => captionSafePlate(part.trim()))
      .filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]},${parts[1]}`;
    }
    const hex = captionSafePlate(raw);
    return `${hex},#020617`;
  }
  if (type === 'template') {
    const id = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return id === 'grid_pulse' ? 'grid_pulse' : 'soft_orbs';
  }
  return raw.slice(0, 500) || 'soft_orbs';
}

function nearestThemeColor(value: string, palette: string[]): string {
  const hex = sanitizeHex(value) || '#111827';
  if (palette.length === 0) {
    return hex;
  }
  const normalized = palette
    .map(item => sanitizeHex(item))
    .filter(Boolean);
  if (normalized.includes(hex) || normalized.length === 0) {
    return hex;
  }
  const rgb = hexToRgb(hex);
  let best = normalized[0]!;
  let bestDist = Infinity;
  for (const candidate of normalized) {
    const other = hexToRgb(candidate);
    const dist =
      (rgb.r - other.r) ** 2 + (rgb.g - other.g) ** 2 + (rgb.b - other.b) ** 2;
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function hexToRgb(hex: string): {r: number; g: number; b: number} {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export type InsetRevealValidateInput = {
  clips: Array<{
    id?: string;
    start: number;
    end: number;
    variant?: InsetRevealVariant;
    reason?: string;
    params?: InsetRevealParams;
    background?: InsetBackground;
    graphic?: InsetGraphic;
    captions?: boolean;
  }>;
  outputDurationSec: number;
  blockedRanges?: TimeRange[];
  words?: Array<{start: number; end: number}>;
  sentences?: Array<{start: number; end: number}>;
  themeColors?: string[];
};

export type InsetRevealValidateResult = {
  clips: Array<{
    id?: string;
    start: number;
    end: number;
    variant: InsetRevealVariant;
    reason?: string;
    params: InsetRevealParams;
  }>;
  violations: InsetRevealViolation[];
  coercions: string[];
  drops: string[];
};

/**
 * Hard guardrails for Director output. Invalid clips are dropped (no effect).
 * Params are clamped rather than rejected.
 */
export function validateInsetReveals(
  input: InsetRevealValidateInput,
): InsetRevealValidateResult {
  const violations: InsetRevealViolation[] = [];
  const coercions: string[] = [];
  const drops: string[] = [];
  const kept: InsetRevealValidateResult['clips'] = [];
  const durationSec = Math.max(0.1, input.outputDurationSec);
  const blocked = input.blockedRanges ?? [];
  const theme = (input.themeColors ?? []).map(item => sanitizeHex(item)).filter(Boolean);
  const maxCount = maxInsetRevealCount(durationSec);

  const ordered = [...input.clips].sort((a, b) => a.start - b.start);
  for (const clip of ordered) {
    const id = clip.id ?? 'inset_reveal';
    let start = Number(clip.start);
    let end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      violations.push({
        code: 'inset_reveal_invalid_window',
        elementId: id,
        reason: `Invalid window ${clip.start}–${clip.end}`,
      });
      drops.push(`drop:${id}:invalid_window`);
      continue;
    }

    const snapped = snapToTranscriptBoundaries(
      start,
      end,
      input.words ?? [],
      input.sentences,
    );
    if (snapped.snapped) {
      start = snapped.start;
      end = snapped.end;
      coercions.push(`snap_boundary:${id}`);
    }

    start = Math.max(INSET_REVEAL_HOOK_GUARD_SEC, start);
    end = Math.min(Math.max(0, durationSec - INSET_REVEAL_TAIL_GUARD_SEC), end);
    let hold = end - start;
    if (hold < INSET_REVEAL_MIN_DURATION_SEC) {
      const latest = Math.max(0, durationSec - INSET_REVEAL_TAIL_GUARD_SEC);
      const earliest = INSET_REVEAL_HOOK_GUARD_SEC;
      if (start + INSET_REVEAL_MIN_DURATION_SEC <= latest) {
        end = start + INSET_REVEAL_MIN_DURATION_SEC;
        hold = INSET_REVEAL_MIN_DURATION_SEC;
        coercions.push(`expand_duration:${id}`);
      } else if (end - INSET_REVEAL_MIN_DURATION_SEC >= earliest) {
        start = end - INSET_REVEAL_MIN_DURATION_SEC;
        hold = INSET_REVEAL_MIN_DURATION_SEC;
        coercions.push(`expand_duration:${id}`);
      } else if (hold >= 1.6) {
        coercions.push(`keep_short:${id}`);
      } else {
        violations.push({
          code: 'inset_reveal_too_short',
          elementId: id,
          reason: `Hold ${hold.toFixed(2)}s is under ${INSET_REVEAL_MIN_DURATION_SEC}s (or sits in the hook/tail guard)`,
        });
        drops.push(`drop:${id}:too_short`);
        continue;
      }
    }
    if (hold > INSET_REVEAL_MAX_DURATION_SEC) {
      end = start + INSET_REVEAL_MAX_DURATION_SEC;
      hold = INSET_REVEAL_MAX_DURATION_SEC;
      coercions.push(`clamp_duration:${id}`);
    }

    const candidate = {start, end};
    if (blocked.some(range => rangesOverlap(candidate, range))) {
      violations.push({
        code: 'inset_reveal_overlap',
        elementId: id,
        reason: 'Overlaps B-roll, depth_overlay, or another layout-changing clip',
      });
      drops.push(`drop:${id}:overlap`);
      continue;
    }
    if (kept.some(other => rangesOverlap(candidate, other))) {
      violations.push({
        code: 'inset_reveal_overlap',
        elementId: id,
        reason: 'Overlaps another inset_reveal clip',
      });
      drops.push(`drop:${id}:self_overlap`);
      continue;
    }
    const previous = kept.at(-1);
    if (previous && candidate.start < previous.end + INSET_REVEAL_MIN_GAP_SEC) {
      violations.push({
        code: 'inset_reveal_min_gap',
        elementId: id,
        reason: `Needs ${INSET_REVEAL_MIN_GAP_SEC}s gap from the previous inset`,
      });
      drops.push(`drop:${id}:min_gap`);
      continue;
    }
    if (kept.length >= maxCount) {
      violations.push({
        code: 'inset_reveal_max_count',
        elementId: id,
        reason: `Cap is ${maxCount} inset_reveal clip(s) for ${durationSec.toFixed(0)}s`,
      });
      drops.push(`drop:${id}:max_count`);
      continue;
    }

    const used = kept.reduce((sum, item) => sum + (item.end - item.start), 0);
    if ((used + hold) / durationSec > INSET_REVEAL_MAX_SHARE + 1e-6) {
      violations.push({
        code: 'inset_reveal_share_cap',
        elementId: id,
        reason: `Would exceed ${Math.round(INSET_REVEAL_MAX_SHARE * 100)}% of runtime`,
      });
      drops.push(`drop:${id}:share_cap`);
      continue;
    }

    const variant: InsetRevealVariant =
      clip.variant === 'motion_graphic' || clip.params?.variant === 'motion_graphic'
        ? 'motion_graphic'
        : 'simple';
    let params = clampInsetRevealParams(
      defaultInsetRevealParams({
        ...clip.params,
        variant,
        background: clip.background ?? clip.params?.background,
        graphic: clip.graphic ?? clip.params?.graphic,
        captionsEnabled: clip.captions ?? clip.params?.captions.enabled,
        themeColor: theme[0],
      }),
    );
    if (theme.length > 0 && (params.background.type === 'solid' || params.background.type === 'gradient')) {
      const nextValue =
        params.background.type === 'solid'
          ? captionSafePlate(nearestThemeColor(params.background.value, theme))
          : params.background.value
              .split(',')
              .map(part => captionSafePlate(nearestThemeColor(part, theme)))
              .join(',');
      if (nextValue !== params.background.value) {
        params = {...params, background: {...params.background, value: nextValue}};
        coercions.push(`theme_palette:${id}`);
      }
    }

    kept.push({
      ...clip,
      start,
      end,
      variant: params.variant,
      params,
    });
  }

  return {clips: kept, violations, coercions, drops};
}
