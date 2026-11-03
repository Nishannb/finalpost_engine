/**
 * WP42: Skill B (Explainer) production mount, PURE helpers (no React, no imports beyond types, so the server, the renderer and the tests share them). ShortVideo reads `blueprint.explainerLayoutTrack`
 * (hard-cut spans that tile the runtime) and `blueprint.explainerClaimBeats`; the media that fills layout B (top half), C (white + dot grid) and D (dark cutaway) rides the existing `visualOverlays` array,
 * tagged by `intent` (`explainer_b` / `explainer_c` / `explainer_d`) so the renderer draws it INSIDE the layout and never as a free overlay.
 */
export type ExplainerMountLayout = 'explainer_a' | 'explainer_b' | 'explainer_c' | 'explainer_d';
export type ExplainerMountSpan = {start: number; end: number; layout: ExplainerMountLayout};
export type ExplainerMountBeat = {start: number; end: number; phrase: string; phraseStart: number; phraseEnd: number; kind?: string; context?: string};
export type ExplainerMountOverlay = {start: number; end: number; intent?: string};

/** Layouts that carry planned media (A is the speaker only). */
export const EXPLAINER_MEDIA_LAYOUTS = ['explainer_b', 'explainer_c', 'explainer_d'] as const;
/** The `intent` tag of an overlay that is the media of a layout span. */
export const explainerMediaIntent = (layout: ExplainerMountLayout): string | null => (layout === 'explainer_a' ? null : layout);
export const isExplainerMedia = (overlay: {intent?: string}): boolean => overlay.intent === 'explainer_b' || overlay.intent === 'explainer_c' || overlay.intent === 'explainer_d';

/** Overlay layouts that cover (part of) the picture on their own: in an explainer edit the layout track owns the picture, so the renderer does not draw them. */
export const EXPLAINER_PICTURE_OWNING_OVERLAYS = ['cutaway', 'composite', 'split', 'cutout'] as const;

const frameOf = (sec: number, fps: number) => Math.round(sec * fps);

/**
 * The span on screen at `frame`: a HARD cut (the last span whose first frame is <= `frame`; no blend, no overlap). Before the first span the first one holds; after the last span the last one holds.
 * `track` must be sorted (the planner tiles it).
 */
export function activeExplainerSpanAt<T extends ExplainerMountSpan>(track: readonly T[], frame: number, fps: number): T | null {
  if (track.length === 0) return null;
  let active: T = track[0]!;
  for (const span of track) {
    if (frameOf(span.start, fps) <= frame) active = span;
    else break;
  }
  return active;
}

/** Problems that would make a layout change soft or glitchy: an overlap, or a gap longer than one frame. `[]` = a clean hard-cut tiling. */
export function explainerHardCutProblems(track: readonly ExplainerMountSpan[], fps: number): string[] {
  const problems: string[] = [];
  track.forEach((span, index) => {
    if (span.end <= span.start) problems.push(`empty_span:${index}`);
    if (index === 0) return;
    const prev = track[index - 1]!;
    const gapFrames = frameOf(span.start, fps) - frameOf(prev.end, fps);
    if (gapFrames > 1) problems.push(`gap:${index}:${gapFrames}f`);
    if (span.start < prev.end - 1e-6) problems.push(`overlap:${index}`);
  });
  return problems;
}

/** The claim beat that IS this layout-B span (the planner carves each beat out as its own B span with identical bounds). */
export function claimBeatForSpan<T extends ExplainerMountBeat>(beats: readonly T[] | undefined, span: ExplainerMountSpan): T | undefined {
  if (span.layout !== 'explainer_b') return undefined;
  return (beats ?? []).find(beat => Math.abs(beat.start - span.start) < 0.02 && Math.abs(beat.end - span.end) < 0.05);
}

/** The planned media of a span: the overlay tagged for its layout that overlaps it the most. */
export function explainerMediaForSpan<T extends ExplainerMountOverlay>(overlays: readonly T[], span: ExplainerMountSpan): T | undefined {
  const intent = explainerMediaIntent(span.layout);
  if (!intent) return undefined;
  let best: T | undefined;
  let bestOverlap = 0;
  for (const overlay of overlays) {
    if (overlay.intent !== intent) continue;
    const overlap = Math.min(overlay.end, span.end) - Math.max(overlay.start, span.start);
    if (overlap > bestOverlap + 1e-9) {
      best = overlay;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** Split the plate's spoken line around the key phrase (case-insensitive, first hit). No hit: the whole line, then the phrase on its own so the highlight always has a target. */
export function splitPlateContext(context: string | undefined, phrase: string): {before: string; phrase: string; after: string} {
  const line = (context ?? '').replace(/\s+/g, ' ').trim();
  const at = phrase ? line.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
  if (at >= 0) return {before: line.slice(0, at), phrase: line.slice(at, at + phrase.length), after: line.slice(at + phrase.length)};
  return {before: line ? `${line} ... ` : '', phrase, after: ''};
}

/** Body font px of the article plate by line length (a long line shrinks so it still fits the half-frame plate). */
export function plateFontPx(contextLength: number, plateWidth: number): number {
  const base = contextLength > 150 ? 0.037 : contextLength > 90 ? 0.044 : 0.054;
  return Math.round(plateWidth * base);
}

/** The fallback highlight band (fractions of the plate) when the phrase could not be measured: a centred band over the body text. */
export const EXPLAINER_FALLBACK_RECT = {x: 0.08, y: 0.44, w: 0.84, h: 0.1} as const;
