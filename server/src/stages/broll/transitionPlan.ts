/**
 * Director transitions (v2 `transition` elements) → blueprint transition clips, merged with the
 * engine's own cut-derived transitions without duplicating them.
 *
 * The renderer (`TransitionTrack`) has no style vocabulary beyond a keyword and a blend mode, so a
 * Director style is mapped onto the existing engine keywords when it names one and otherwise recorded
 * and replaced by the engine default. WP12C adds PROCEDURAL styles (hard cut, white / black flash, whip blur, black-and-white grade flip) that the renderer draws from the keyword alone, with no asset.
 */

import type {TransitionClip} from '../../types/blueprint.ts';
import type {DirectedTransition} from './geminiDirector.ts';

export const TRANSITION_DURATION_BOUNDS = {minSec: 0.2, maxSec: 0.8} as const; // the v2 assembler manifest's transition limits
/** An engine and a Director transition this close are the same cut. */
export const TRANSITION_DUPLICATE_WINDOW_SEC = 0.5;

/** Engine keywords (the same list `planTransitions` cycles through). */
export const TRANSITION_KEYWORDS = ['light leak overlay', 'film burn', 'ink splash', 'smoke overlay', 'fire overlay', 'paper wipe', 'glitch overlay'] as const;

/**
 * WP12C: procedural transition keywords (drawn by the renderer from the keyword; no stock asset). Mirrors remotion/src/lib/proceduralTransition.ts `PROCEDURAL_KEYWORDS` (a test asserts parity).
 * They are NOT in the default `TRANSITION_KEYWORDS` rotation: a procedural style is only used when the Director (or the pacing planner) names it.
 */
export const PROCEDURAL_TRANSITION_KEYWORDS = ['hard cut', 'flash white', 'flash black', 'whip blur', 'grade bw hold', 'whip blur left', 'whip blur right', 'smash zoom', 'dip color', 'blur dissolve'] as const;
export type ProceduralTransitionKeyword = (typeof PROCEDURAL_TRANSITION_KEYWORDS)[number];
export const isProceduralKeyword = (keyword: string): boolean => (PROCEDURAL_TRANSITION_KEYWORDS as readonly string[]).includes(keyword);

/**
 * WP13B: the transition at a cut where the PICTURE CHANGES (a B-roll clip, split or cutaway starts). The Metromedia pace changes images with a whip or a hard cut, not a light leak, so on the polish path the
 * engine's cut-derived transitions rotate through these procedural styles (no stock asset to fetch). Pure.
 */
export const CUT_TRANSITION_ROTATION: readonly ProceduralTransitionKeyword[] = [
  'whip blur right',
  'smash zoom',
  'hard cut',
  'whip blur left',
  'dip color',
  'blur dissolve',
  'flash white',
  'whip blur',
];
/** WP16: the polish rotation is the same list (the cut-derived transitions and the density fill draw from one vocabulary). `grade bw hold` and `flash black` are deliberately left to the Director / pacing: they are moods, not cuts. */
export const POLISH_TRANSITION_ROTATION = CUT_TRANSITION_ROTATION;
export const cutTransitionKeyword = (index: number): ProceduralTransitionKeyword => CUT_TRANSITION_ROTATION[((index % CUT_TRANSITION_ROTATION.length) + CUT_TRANSITION_ROTATION.length) % CUT_TRANSITION_ROTATION.length]!;

/** Director phrases -> procedural keywords. Checked BEFORE the engine hints, so "white flash" is a flash, not a light leak. */
const PROCEDURAL_HINTS: Array<[RegExp, ProceduralTransitionKeyword]> = [
  [/black.?(and|&|n).?white|\bb\s?&?\s?w\b|\bbw\b|monochrome|greyscale|grayscale|desaturat/i, 'grade bw hold'],
  // WP16: the directional / zoom / colour / dissolve vocabulary comes BEFORE the generic whip and flash hints
  [/smash.?zoom|zoom.?(cut|punch|smash|in)\b|punch.?in|push.?in/i, 'smash zoom'],
  [/blur.?dissolve|soft.?dissolve|lens.?blur|cross.?blur|\bdissolve/i, 'blur dissolve'],
  [/(whip|swish|smear|pan).{0,8}left|left.{0,8}(whip|swish|smear|pan)/i, 'whip blur left'],
  [/(whip|swish|smear|pan).{0,8}right|right.{0,8}(whip|swish|smear|pan)/i, 'whip blur right'],
  [/dip.{0,10}colou?r|colou?r.{0,6}(flash|dip|pop|burst)|orange.{0,6}(flash|dip)|warm.{0,6}(flash|dip)/i, 'dip color'],
  [/whip|swish|smear|motion.?blur/i, 'whip blur'],
  [/(dip|flash|fade).{0,6}black|black.{0,6}(dip|flash|fade)/i, 'flash black'],
  [/flash|strobe|white.?out|pop/i, 'flash white'],
  [/hard.?cut|jump.?cut|smash.?cut|straight.?cut|\bcut\b/i, 'hard cut'],
];
/** A "frame" / "window" phrase asks for a framed talking-head beat (a media container), not a transition. */
export const FRAMED_WINDOW_HINT = /\bframe(d)?\b|window|picture.?in.?picture/i;

const STYLE_HINTS: Array<[RegExp, (typeof TRANSITION_KEYWORDS)[number]]> = [
  [/light.?leak|leak/i, 'light leak overlay'],
  [/film.?burn|burn/i, 'film burn'],
  [/ink/i, 'ink splash'],
  [/smoke/i, 'smoke overlay'],
  [/fire|flame/i, 'fire overlay'],
  [/paper|wipe/i, 'paper wipe'],
  [/glitch/i, 'glitch overlay'],
];

export type DirectedTransitionOutcome = {
  source: DirectedTransition;
  clip?: TransitionClip;
  /** Why the Director's transition was refused. */
  rejected?: string;
  /** Set when the style was not recognised and the engine default keyword was used. */
  note?: string;
  /** WP12C: the Director's style asked for a framed window beat; recorded, no transition clip is made. */
  framedWindow?: {start: number; end: number};
};

export type TransitionMerge = {
  transitions: TransitionClip[];
  directed: DirectedTransitionOutcome[];
  /** Engine transitions removed because a Director transition covers the same cut. */
  superseded: Array<{engine: TransitionClip; by: TransitionClip}>;
};

export function mergeDirectedTransitions(input: {
  engine: TransitionClip[];
  directed: DirectedTransition[] | undefined;
  outputDurationSec: number;
}): TransitionMerge {
  const outcomes: DirectedTransitionOutcome[] = [];
  const accepted: TransitionClip[] = [];
  const round = (value: number) => Math.round(value * 100) / 100;

  for (const [index, source] of (input.directed ?? []).entries()) {
    if (!Number.isFinite(source.start) || !Number.isFinite(source.end) || source.end <= source.start) {
      outcomes.push({source, rejected: 'transition_invalid_interval'});
      continue;
    }
    if (source.start < 0 || source.start > input.outputDurationSec - TRANSITION_DURATION_BOUNDS.minSec) {
      outcomes.push({source, rejected: 'transition_outside_video'});
      continue;
    }
    const duration = source.end - source.start;
    if (duration < TRANSITION_DURATION_BOUNDS.minSec || duration > TRANSITION_DURATION_BOUNDS.maxSec) {
      outcomes.push({source, rejected: `transition_duration_${round(duration)}s_outside_${TRANSITION_DURATION_BOUNDS.minSec}_${TRANSITION_DURATION_BOUNDS.maxSec}s`});
      continue;
    }
    const earlier = accepted.find(clip => Math.abs(clip.at - source.start) < TRANSITION_DUPLICATE_WINDOW_SEC);
    if (earlier) {
      outcomes.push({source, rejected: 'duplicate_director_transition'});
      continue;
    }
    if (source.style && FRAMED_WINDOW_HINT.test(source.style) && !PROCEDURAL_HINTS.some(([pattern]) => pattern.test(source.style!))) {
      outcomes.push({source, framedWindow: {start: round(source.start), end: round(source.end)}, note: 'style_frame_is_a_framed_window_beat_not_a_transition'});
      continue;
    }
    const procedural = source.style ? PROCEDURAL_HINTS.find(([pattern]) => pattern.test(source.style!))?.[1] : undefined;
    const hinted = procedural ?? (source.style ? STYLE_HINTS.find(([pattern]) => pattern.test(source.style!))?.[1] : undefined);
    const clip: TransitionClip = {
      at: round(source.start),
      duration: round(duration),
      keyword: hinted ?? TRANSITION_KEYWORDS[index % TRANSITION_KEYWORDS.length]!,
      assetUrl: '',
      blend: index % 2 === 0 ? 'screen' : 'lighten',
      provider: 'generated',
      providerId: 0,
      width: 1080,
      height: 1920,
      credit: '',
      creditUrl: '',
      ...(procedural ? {renderGenerated: true} : {}),
    };
    accepted.push(clip);
    outcomes.push({source, clip, ...(source.style && !hinted ? {note: `style_${source.style.slice(0, 40)}_not_recognised_default_keyword_used`} : {})});
  }

  const superseded: TransitionMerge['superseded'] = [];
  const engine = input.engine.filter(candidate => {
    // The engine places its transition AT the cut. A Director transition covers a span around/before the cut, so an
    // engine transition anywhere inside that span (plus the window) is the same transition.
    const by = accepted.find(clip => candidate.at > clip.at - TRANSITION_DUPLICATE_WINDOW_SEC - 1e-6 && candidate.at < clip.at + clip.duration + TRANSITION_DUPLICATE_WINDOW_SEC + 1e-6);
    if (by) {
      superseded.push({engine: candidate, by});
    }
    return !by;
  });
  return {transitions: [...engine, ...accepted].sort((a, b) => a.at - b.at), directed: outcomes, superseded};
}
