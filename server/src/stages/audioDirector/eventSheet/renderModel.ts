/**
 * Server-side mirror of the Remotion render rules the Event Sheet depends on. Pure. Every function names the renderer code it mirrors;
 * the server cannot import Remotion source (tsconfig rootDir), so `renderModel.parity.test.ts` imports the real renderer functions and
 * checks these copies against them. Change the renderer, and that test fails until this file follows.
 *
 * Nothing here decides anything about audio.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Render style
// ---------------------------------------------------------------------------------------------------------------------------------

/** The render-style switches that change WHAT is drawn (remotion/src/blueprintSchema.ts renderStyleSchema). Other style fields (caption template, layout style, LUT) change appearance only. */
export type RenderStyleFlags = {trimEnabled: boolean; brollEnabled: boolean; zoomEnabled: boolean; generatedGraphicsEnabled: boolean};

export type RenderStyleInput = {trimEnabled?: boolean; brollEnabled?: boolean; zoomEnabled?: boolean; generatedGraphicsEnabled?: boolean};

/**
 * The full-edit render defaults: server/src/http/schemas.ts:122-126 (`brollEnabled`, `zoomEnabled`, `trimEnabled` default true; `generatedGraphicsEnabled`
 * optional, and ShortVideo.tsx:104 draws graphics unless it is exactly false). The captions-only path renders with B-roll and zoom OFF
 * (pipeline/captionsEditRunner.ts:270-273), so a caller that knows the real style should pass it.
 */
export const DEFAULT_EDIT_RENDER_STYLE: Readonly<RenderStyleFlags> = Object.freeze({trimEnabled: true, brollEnabled: true, zoomEnabled: true, generatedGraphicsEnabled: true});

export type ResolvedRenderStyle = RenderStyleFlags & {source: 'provided' | 'assumed_edit_default'; assumedFlags: Array<keyof RenderStyleFlags>};

export function resolveRenderStyle(input?: RenderStyleInput): ResolvedRenderStyle {
  const assumedFlags: Array<keyof RenderStyleFlags> = [];
  const pick = (key: keyof RenderStyleFlags): boolean => {
    const value = input?.[key];
    if (typeof value === 'boolean') return value;
    assumedFlags.push(key);
    return DEFAULT_EDIT_RENDER_STYLE[key];
  };
  const flags: RenderStyleFlags = {trimEnabled: pick('trimEnabled'), brollEnabled: pick('brollEnabled'), zoomEnabled: pick('zoomEnabled'), generatedGraphicsEnabled: pick('generatedGraphicsEnabled')};
  return {...flags, source: assumedFlags.length === 4 ? 'assumed_edit_default' : 'provided', assumedFlags};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Frame maths (remotion/src/lib/timeline.ts)
// ---------------------------------------------------------------------------------------------------------------------------------

/** timeline.ts secToFrame. */
export const secToFrame = (seconds: number, fps: number): number => Math.round(Math.max(0, seconds) * fps);

/** timeline.ts framesBetween. */
export const framesBetween = (startSec: number, endSec: number, fps: number): number => Math.max(1, Math.round((endSec - startSec) * fps));

export type KeepSegmentLike = {sourceStart: number; sourceEnd: number; outputStart: number};

/** timeline.ts segmentFrames (the `from + durationInFrames` it yields is all compositionFrames needs). */
function segmentEnds(segments: readonly KeepSegmentLike[], fps: number): number[] {
  return segments.map((segment, index) => {
    const from = secToFrame(segment.outputStart, fps);
    const trimBefore = secToFrame(segment.sourceStart, fps);
    const natural = framesBetween(segment.sourceStart, segment.sourceEnd, fps);
    const next = segments[index + 1];
    let durationInFrames = natural;
    if (!next) {
      const available = Math.ceil(Math.max(0, segment.sourceEnd) * fps - 1e-6) - trimBefore;
      durationInFrames = Math.max(1, Math.min(natural, available));
    } else {
      const toNext = secToFrame(next.outputStart, fps) - from;
      if (toNext >= 1 && Math.abs(toNext - natural) <= 1) durationInFrames = toNext;
    }
    return from + durationInFrames;
  });
}

/** timeline.ts compositionFrames, with resolveSegments for a trimmed render (ShortVideo.tsx durationInFramesFor). */
export function compositionFrames(segments: readonly KeepSegmentLike[], seconds: number, fps: number): number {
  const legacy = Math.max(1, Math.ceil(seconds * fps));
  if (segments.length === 0) return legacy;
  return Math.max(1, Math.min(legacy, Math.max(...segmentEnds(segments, fps))));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Transitions (remotion/src/lib/timeline.ts, lib/proceduralTransition.ts, components/TransitionTrack.tsx)
// ---------------------------------------------------------------------------------------------------------------------------------

export type ProceduralStyle = 'hard_cut' | 'flash_white' | 'flash_black' | 'whip_blur' | 'grade_bw_hold' | 'whip_blur_left' | 'whip_blur_right' | 'smash_zoom' | 'dip_color' | 'blur_dissolve';

/** proceduralTransition.ts PROCEDURAL_KEYWORDS. */
export const PROCEDURAL_KEYWORDS: Readonly<Record<ProceduralStyle, string>> = {
  hard_cut: 'hard cut',
  flash_white: 'flash white',
  flash_black: 'flash black',
  whip_blur: 'whip blur',
  grade_bw_hold: 'grade bw hold',
  whip_blur_left: 'whip blur left',
  whip_blur_right: 'whip blur right',
  smash_zoom: 'smash zoom',
  dip_color: 'dip color',
  blur_dissolve: 'blur dissolve',
};

const BY_KEYWORD = new Map<string, ProceduralStyle>(Object.entries(PROCEDURAL_KEYWORDS).map(([style, keyword]) => [keyword, style as ProceduralStyle]));

/** proceduralTransition.ts proceduralStyleOf. */
export function proceduralStyleOf(keyword: string | undefined): ProceduralStyle | null {
  return BY_KEYWORD.get((keyword ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')) ?? null;
}

/** timeline.ts TRANSITION_SAME_CUT_SEC. */
export const TRANSITION_SAME_CUT_SEC = 0.5;

export type TransitionLike = {at: number; duration: number; assetUrl?: string; renderGenerated?: boolean; keyword?: string};

/** timeline.ts transitionIsDrawable. */
export const transitionIsDrawable = (clip: TransitionLike): boolean => Boolean(clip.assetUrl) || clip.renderGenerated === true || proceduralStyleOf(clip.keyword) !== null;

/** timeline.ts transitionWindow. */
export function transitionWindow(clip: {at: number; duration: number}, fps: number, totalFrames: number): {from: number; durationInFrames: number} | null {
  if (!Number.isFinite(clip.at) || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.at < 0) return null;
  const from = secToFrame(Math.max(0, clip.at - clip.duration * 0.35), fps);
  if (from >= totalFrames) return null;
  return {from, durationInFrames: Math.min(framesBetween(0, clip.duration, fps), totalFrames - from)};
}

export type TransitionDrawStatus =
  | {drawn: true; from: number; durationInFrames: number}
  | {drawn: false; reason: 'not_drawable' | 'invalid_window' | 'same_cut_as_earlier_generated'};

/**
 * timeline.ts drawableTransitions, reporting a status per INPUT index (the renderer returns only the drawn ones).
 * Order: stable sort by `at` (Array.prototype.sort is stable), as the renderer does.
 */
export function transitionDrawStatus(clips: readonly TransitionLike[], fps: number, totalFrames: number): TransitionDrawStatus[] {
  const status: TransitionDrawStatus[] = clips.map(() => ({drawn: false, reason: 'not_drawable'}));
  const drawn: TransitionLike[] = [];
  const order = clips.map((clip, index) => ({clip, index})).sort((a, b) => a.clip.at - b.clip.at);
  for (const {clip, index} of order) {
    if (!transitionIsDrawable(clip)) continue;
    const window = transitionWindow(clip, fps, totalFrames);
    if (!window) {
      status[index] = {drawn: false, reason: 'invalid_window'};
      continue;
    }
    const generated = !clip.assetUrl;
    if (generated && drawn.some(item => !item.assetUrl && Math.abs(item.at - clip.at) < TRANSITION_SAME_CUT_SEC)) {
      status[index] = {drawn: false, reason: 'same_cut_as_earlier_generated'};
      continue;
    }
    drawn.push(clip);
    status[index] = {drawn: true, ...window};
  }
  return status;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const tent = (t: number, peak = 0.5) => (t <= peak ? clamp01(t / Math.max(1e-6, peak)) : clamp01((1 - t) / Math.max(1e-6, 1 - peak)));

/**
 * The scalar strength of a procedural layer at `frame` (proceduralTransition.ts proceduralLayer): the flash / dip opacity, the whip opacity,
 * the smash edge opacity, the dissolve veil, the grade ramp. `null` for `hard_cut` (it draws nothing).
 */
export function proceduralStrength(style: ProceduralStyle, frame: number, durationInFrames: number): number | null {
  const t = clamp01(frame / Math.max(1, durationInFrames - 1));
  switch (style) {
    case 'hard_cut':
      return null;
    case 'flash_white':
    case 'flash_black':
      return 0.95 * tent(t, 0.4);
    case 'whip_blur':
    case 'whip_blur_right':
    case 'whip_blur_left':
      return tent(t, 0.45);
    case 'smash_zoom':
      return Math.round(1 * tent(t, 0.5) * 1000) / 1000;
    case 'dip_color':
      return 0.95 * clamp01(tent(t, 0.4) * 1.6);
    case 'blur_dissolve':
      return Math.round(0.22 * tent(t, 0.5) * 1000) / 1000;
    case 'grade_bw_hold':
      return clamp01(t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1);
  }
}

/** Remotion `interpolate` with clamped extrapolation, for a strictly increasing input range (piecewise linear). */
function interpolateClamped(x: number, input: readonly number[], output: readonly number[]): number {
  if (x <= input[0]!) return output[0]!;
  for (let i = 1; i < input.length; i += 1) {
    if (x <= input[i]!) {
      const a = input[i - 1]!;
      const b = input[i]!;
      return output[i - 1]! + ((output[i]! - output[i - 1]!) * (x - a)) / (b - a);
    }
  }
  return output[output.length - 1]!;
}

/**
 * The generated light sweep (no asset, not procedural, `renderGenerated`): TransitionTake draws the gradient with
 * opacity = interpolate([0, 2, max(3, D-3), D] -> [0, 1, 1, 0]) and gradient strength flash = interpolate([0, max(1, D/2), D] -> [0.15, 0.85, 0.1]).
 * Returns null when the renderer's input range would not be strictly increasing (D <= 3: Remotion's interpolate rejects it).
 */
export function generatedSweepStrength(frame: number, durationInFrames: number): number | null {
  const d = durationInFrames;
  const opacityRange = [0, 2, Math.max(3, d - 3), d];
  const flashRange = [0, Math.max(1, d / 2), d];
  const increasing = (range: number[]) => range.every((value, index) => index === 0 || value > range[index - 1]!);
  if (!increasing(opacityRange) || !increasing(flashRange)) return null;
  return interpolateClamped(frame, opacityRange, [0, 1, 1, 0]) * interpolateClamped(frame, flashRange, [0.15, 0.85, 0.1]);
}

/** The first local frame (0-based, inside the window) at which `strength` is greatest; null when nothing is drawn. */
export function firstPeakFrame(durationInFrames: number, strength: (frame: number) => number | null): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (let frame = 0; frame < durationInFrames; frame += 1) {
    const value = strength(frame);
    if (value === null) return null;
    if (value > bestValue + 1e-12) {
      best = frame;
      bestValue = value;
    }
  }
  return bestValue > 0 ? best : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Subject Stage (remotion/src/ShortVideo.tsx:96-205, components/SubjectStage/stageMotion.ts stageCompositing)
// ---------------------------------------------------------------------------------------------------------------------------------

/** stageMotion.ts usableMatteUrl. */
export function usableMatteUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || /\s/.test(u) || u.startsWith('//')) return false;
  const path = (u.split(/[?#]/)[0] ?? '').toLowerCase();
  if (!/\.(webm|mov)$/.test(path)) return false;
  return /^https?:\/\/[^/\s]+\/\S+$/i.test(u) || /^(staticFile:)?\/?[\w.-]+(\/[\w.-]+)*$/.test(u);
}

/**
 * What the renderer will do with `blueprint.subjectStage`, as far as the STORED blueprint can tell.
 *  - not_owner:*      ShortVideo.tsx:199 ignores the stage entirely when `kinetic` or `subjectForeground` is present.
 *  - inactive:*       stageCompositing returns active=false, degraded unset: nothing of the stage is drawn (no_matte, invalid_matte, no_spans).
 *  - degraded         `matteMissing` is set: stageCompositing returns degraded (only matte-independent front elements are drawn).
 *  - active           stageCompositing will return active=true (no matteIntervals: every stage that passes the checks above is active).
 *  - active_unless_no_matte_coverage   matteIntervals are present: active unless the person-dependent spans miss every interval (decided per span
 *                     design inside foregroundFromStage, which is not mirrored here). Reported as a condition, never guessed.
 * Every non-inactive state also depends on render time: the prefetch sets `matteMissing` when the cutout cannot be fetched (prefetchAssets.ts).
 */
export type StageStatus =
  | {kind: 'absent'}
  | {kind: 'not_owner'; reason: 'kinetic_owns_person_layer' | 'subject_foreground_owns_person_layer'}
  | {kind: 'inactive'; reason: 'no_matte' | 'invalid_matte' | 'no_spans'}
  | {kind: 'degraded'}
  | {kind: 'active'}
  | {kind: 'active_unless_no_matte_coverage'};

type StageLike = {matteUrl?: unknown; matteMissing?: unknown; spans?: unknown; matteIntervals?: unknown};

export function subjectStageStatus(blueprint: {kinetic?: unknown; subjectForeground?: unknown; subjectStage?: unknown}): StageStatus {
  const stage = blueprint.subjectStage;
  if (stage === undefined || stage === null || typeof stage !== 'object') return {kind: 'absent'};
  if (blueprint.kinetic) return {kind: 'not_owner', reason: 'kinetic_owns_person_layer'};
  if (blueprint.subjectForeground) return {kind: 'not_owner', reason: 'subject_foreground_owns_person_layer'};
  const s = stage as StageLike;
  if (s.matteMissing) return {kind: 'degraded'};
  const raw = typeof s.matteUrl === 'string' ? s.matteUrl.trim() : '';
  if (!raw) return {kind: 'inactive', reason: 'no_matte'};
  if (!usableMatteUrl(raw)) return {kind: 'inactive', reason: 'invalid_matte'};
  const spans = Array.isArray(s.spans) ? (s.spans as Array<{start?: unknown; end?: unknown}>) : [];
  const valid = spans.filter(span => typeof span?.start === 'number' && typeof span?.end === 'number' && Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start && span.start >= 0);
  if (valid.length === 0) return {kind: 'inactive', reason: 'no_spans'};
  return s.matteIntervals ? {kind: 'active_unless_no_matte_coverage'} : {kind: 'active'};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Overlays (components/VisualOverlayTrack.tsx, lib/explainerMount.ts)
// ---------------------------------------------------------------------------------------------------------------------------------

/** explainerMount.ts EXPLAINER_PICTURE_OWNING_OVERLAYS. */
export const EXPLAINER_PICTURE_OWNING_OVERLAYS: readonly string[] = ['cutaway', 'composite', 'split', 'cutout'];

/** explainerMount.ts isExplainerMedia. */
export const isExplainerMedia = (overlay: {intent?: unknown}): boolean => overlay.intent === 'explainer_b' || overlay.intent === 'explainer_c' || overlay.intent === 'explainer_d';

/** VisualOverlayTrack.tsx activeOverlayLayoutAt('split') needs an asset; activeCutoutAt does not. Both are half-open [start, end). */
export const hidesBroll = (overlay: {layout?: unknown; assetUrl?: unknown}): boolean => (overlay.layout === 'split' && Boolean(overlay.assetUrl)) || overlay.layout === 'cutout';
