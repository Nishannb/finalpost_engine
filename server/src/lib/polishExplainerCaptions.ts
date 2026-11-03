/**
 * WP41: the polish caption direction for Explainer Skill B: CHUNK-SWAP captions (`chunk_swap`). PURE (no env, no I/O). NOT the Metromedia accumulate grammar (WP34, Skill A): 1-3 word chunks REPLACE
 * each other (nothing builds up, no karaoke fill), white fill + THICK black stroke + soft shadow, y by the active explainer layout: B (the split seam) 50 %, A / C / D 75 %.
 *
 * Input: the layout track (WP40 segments with the WP41 claim beats carved out, `layoutTrackOf`). The direction carries `yTrack` (one entry per layout span) and `cutTimes` (every layout change, so a chunk never
 * straddles one); the renderer (`ChunkSwapCaptions`) does the 1-3 word chunking from the words. Applied only when POLISH_EXPLAINER_SKILL resolves to the explainer skill (analyzeVideo), AFTER the
 * accumulate step (it replaces the accumulate-only fields); never over a CaptionKit preset, a designed caption style guide or a caller-named template. Idempotent.
 */
import type {CaptionDirection} from '../types/blueprint.ts';
import type {ExplainerLayoutId} from '../stages/broll/explainerPacing.ts';

export const CHUNK_SWAP_CAPTION_MODE = 'chunk_swap' as const;
export const CHUNK_SWAP_MAX_WORDS = 3;
export const CHUNK_SWAP_SIZE_PCT_FRAME_H = 5.6;
export const CHUNK_SWAP_STROKE_COLOR = '#000000';
export const CHUNK_SWAP_STROKE_EM = 0.22;
/** Caption centre y (fraction of the frame height) per explainer layout; mirrors `EXPLAINER_CAPTION_Y_PCT` in remotion/src/lib/explainerLayouts.ts (a test asserts the two tables are equal). */
export const EXPLAINER_CAPTION_Y_FRAC: Readonly<Record<ExplainerLayoutId, number>> = {explainer_a: 0.75, explainer_b: 0.5, explainer_c: 0.75, explainer_d: 0.75};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export type LayoutTrackSpan = {start: number; end: number; layout: ExplainerLayoutId};
export type PolishExplainerCaptionsResult = {caption: CaptionDirection; warnings: string[]};

/** Write the chunk-swap grammar onto a polish caption direction. An empty track returns the input untouched with a warning (nothing to key the y to). */
export function polishExplainerCaptions(caption: CaptionDirection, options: {layoutTrack: readonly LayoutTrackSpan[]}): PolishExplainerCaptionsResult {
  const track = options.layoutTrack.filter(span => span.end > span.start);
  if (track.length === 0) return {caption, warnings: ['polish_explainer_captions:no_layout_skipped']};
  const yTrack = track.map(span => ({start: round3(span.start), end: round3(span.end), yFrac: EXPLAINER_CAPTION_Y_FRAC[span.layout]}));
  const cutTimes = track.slice(1).map(span => round3(span.start));
  // the accumulate-only fields are dropped (centerYFrac's 0.42-0.50 band cannot hold 0.75; capsWords belong to the accumulate case rules)
  const {centerYFrac: _centerYFrac, capsWords: _capsWords, ...rest} = caption;
  const next: CaptionDirection = {
    ...rest,
    mode: CHUNK_SWAP_CAPTION_MODE,
    maxWords: CHUNK_SWAP_MAX_WORDS,
    sizePctFrameH: CHUNK_SWAP_SIZE_PCT_FRAME_H,
    cutTimes,
    yTrack,
    // white fill + thick black outline, no pill / box / glow; the renderer owns the lowercase / acronym case rules
    textColor: '#FFFFFF',
    strokeColor: CHUNK_SWAP_STROKE_COLOR,
    strokeWidthEm: CHUNK_SWAP_STROKE_EM,
    boxColor: null,
    glow: false,
    uppercase: false,
    fontScale: 1,
  };
  return {caption: next, warnings: [`polish_explainer_captions:${CHUNK_SWAP_CAPTION_MODE}:${yTrack.length}`]};
}
